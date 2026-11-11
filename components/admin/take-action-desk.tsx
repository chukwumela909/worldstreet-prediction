"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircleIcon as Check,
  EnvelopeIcon as Mail,
  XCircleIcon as Cross,
} from "@heroicons/react/24/outline";
import {
  fetchBookSettings,
  fetchRecovery,
  fetchTraders,
  notifyReversals,
  previewReversal,
  runReversalBatch,
  updateBookSettings,
  useAdminResource,
  voidPausedMarkets,
  type ReversalLetter,
  type ReversalPreview,
  type Shortfall,
  type TraderRow,
} from "@/lib/admin-api";
import { isApiConfigured } from "@/lib/api-client";
import { useAdminMoney, type AdminMoney } from "@/lib/admin-money";
import { showToast } from "@/lib/toast-store";
import { FLAG_TONE } from "@/components/admin/risk-flags";
import { BetsReport } from "@/components/admin/bets-report";
import { IncidentHistory, parseTopics } from "@/components/admin/incident-history";

/**
 * Take action: put a type of market right. One card does it for one
 * customer or, with the customer left empty, for everyone who bet on
 * those markets (what the Recovery desk did on its own).
 *
 * Check: the markets (words in their titles, or a pasted link), the date
 * the bets count from, the customer if any, and the reason the email
 * gives. It reads who they are, their settled bets on the markets (what
 * taking back would recover), the open bets everyone holds on them, and,
 * for one customer, the email it leads to, written by the API exactly as
 * it will go out, to copy and share before anything moves.
 *
 * Do it, in order, each step skipped once it's done so pressing again
 * after a failure finishes the job without doing anything twice:
 *   1. close the markets for everyone: the topics go on the paused list
 *      (no new bets) and every open bet on them is refunded now (each of
 *      those customers is emailed that it was), rather than at the next
 *      minute's pass. Only stopping new bets is Markets → All open;
 *   2. reverse the settled bets on them, in batches (winnings back,
 *      stakes on lost bets returned), with the reason kept. For everyone
 *      it waits for REVERSE to be typed.
 *
 * Send, on its own press: for one customer, the email waiting for them,
 * shown as it goes out and editable; for everyone, every reversal email
 * not yet sent.
 *
 * Below: who bet on these markets (BetsReport, "Act on them" fills the
 * card in) and every incident so far (IncidentHistory: what's been
 * recovered, the emails not sent yet, clearing what's owed, everyone
 * affected).
 *
 * Only bets placed from the day the Terms went live count, by default:
 * bets before it came before the rule. The date is read as midnight in
 * Lagos and sent as that exact moment (`sinceAt`), not a count of days,
 * so not one earlier bet is caught. The customer panel's "Take back"
 * opens this page filled in (?customer=…&markets=…&since=…).
 */

/** The day the Terms went live, as services/api/src/trading/bet-review.ts has it. */
const TERMS_LIVE_DATE = "2026-10-21";
/** Lagos: West Africa Time, UTC+1 all year. */
const LAGOS_OFFSET = "+01:00";
const MIN_REASON = 10;

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });

const DEFAULT_REASON =
  "You placed bets on X post count markets when the result was already all but decided. This breaks our Terms and Conditions (sections 4b and 4c). Any further violation may lead to your account being suspended.";

type StepKey = "close" | "takeBack" | "email";

interface Checked {
  /** The customer as typed, so a later edit can't change who the run hits; "" = everyone. */
  customer: string;
  topics: string[];
  /** Bets from this moment (ISO); null = all time. */
  sinceAt: string | null;
  reason: string;
  person: TraderRow | null;
  /** The settled bets on these markets (theirs, or everyone's), and for one customer the email. */
  mine: ReversalPreview;
  /** Everyone's, for the open bets the close refunds. */
  all: ReversalPreview;
}

interface StepResult {
  key: StepKey;
  ok: boolean;
  text: string;
}

export function TakeActionDesk() {
  const money = useAdminMoney();
  // the customer panel's "Take back" opens this page filled in
  const params = useSearchParams();
  const [customer, setCustomer] = useState(() => params.get("customer") ?? "");
  const [marketsText, setMarketsText] = useState(() => params.get("markets") ?? "x posts");
  const [sinceDate, setSinceDate] = useState(() => {
    const since = params.get("since");
    return since !== null && (since === "" || /^\d{4}-\d{2}-\d{2}$/.test(since)) ? since : TERMS_LIVE_DATE;
  });
  const [reason, setReason] = useState(DEFAULT_REASON);
  const [steps, setSteps] = useState<Record<"close" | "takeBack", boolean>>({ close: true, takeBack: true });
  const [shortfall, setShortfall] = useState<Shortfall>("negative");
  const [checked, setChecked] = useState<Checked | null>(null);
  /** Their reversal emails not yet sent, as written; null on an API too old to say. */
  const [pending, setPending] = useState<ReversalLetter[] | null>(null);
  /** For everyone: how many customers have a reversal email waiting; null = unknown. */
  const [waitingCount, setWaitingCount] = useState<number | null>(null);
  /** The desk's own wording of the one waiting email, while editing it. */
  const [draft, setDraft] = useState<{ subject: string; text: string } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState<"check" | "run" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<StepResult[]>([]);
  // the report below follows the markets and date once they're settled on,
  // not every keystroke
  const [shown, setShown] = useState(() => ({ text: marketsText, date: sinceDate }));
  const [historyVersion, setHistoryVersion] = useState(0);
  const history = useAdminResource(fetchRecovery, isApiConfigured(), historyVersion);
  const reloadHistory = () => setHistoryVersion((v) => v + 1);

  if (!isApiConfigured()) {
    return <p className="text-sm text-secondary">This page needs the prediction API (NEXT_PUBLIC_API_URL).</p>;
  }

  const topics = parseTopics(marketsText);
  const who = customer.trim().replace(/^@/, "");
  const showReport = () => setShown({ text: marketsText, date: sinceDate });

  const reset = () => {
    setChecked(null);
    setPending(null);
    setWaitingCount(null);
    setDraft(null);
    setConfirmText("");
    setResults([]);
    setError(null);
  };

  /** Their emails waiting to go, as written; null when the API can't say. */
  const loadPending = (name: string) =>
    notifyReversals(true, name)
      .then((r) => r.letters ?? null)
      .catch(() => null);
  /** How many customers have a reversal email waiting, any incident; null when it can't say. */
  const countWaiting = () =>
    notifyReversals(true)
      .then((r) => r.customers)
      .catch(() => null);

  const check = async (target: string = who) => {
    setBusy("check");
    reset();
    showReport();
    const sinceAt = sinceAtFor(sinceDate);
    const forAll = target === "";
    try {
      const [mine, all, people, waiting, count] = await Promise.all([
        previewReversal({
          topics,
          sinceDays: null,
          ...(sinceAt ? { sinceAt } : {}),
          ...(forAll ? {} : { customer: target, reason: reason.trim() }),
        }),
        previewReversal({ topics, sinceDays: null }),
        forAll ? null : fetchTraders({ search: target, limit: 10 }).catch(() => null),
        forAll ? null : loadPending(target),
        forAll ? countWaiting() : null,
      ]);
      // an API older than sinceAt ignores it and would count all time
      if (sinceAt && !mine.sinceAt) {
        throw new Error("The API is older than this page, so it can't count from a date. Deploy the API first.");
      }
      const lower = target.toLowerCase();
      const person =
        people?.traders.find((t) => t.username.toLowerCase() === lower || t.email.toLowerCase() === lower) ?? null;
      setChecked({ customer: target, topics, sinceAt, reason: reason.trim(), person, mine, all });
      setPending(waiting);
      setWaitingCount(count);
      setSteps({ close: !all.paused, takeBack: mine.bets > 0 });
      const balance = mine.customerRows?.[0]?.balanceKobo ?? person?.balanceKobo ?? 0;
      setShortfall(forAll || balance < mine.netKobo ? "negative" : "cap");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't check. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const forAll = checked?.customer === "";
  const name = checked
    ? forAll
      ? "everyone"
      : checked.person?.displayName || checked.person?.username || checked.mine.customerRows?.[0]?.username || checked.customer
    : who;
  const balanceBefore = checked ? (checked.person?.balanceKobo ?? checked.mine.customerRows?.[0]?.balanceKobo ?? 0) : 0;
  const covers = checked ? (forAll ? checked.mine.shortCustomers === 0 : balanceBefore >= checked.mine.netKobo) : true;
  // a take-back waits while open bets sit on markets still taking bets
  const blockedByOpenBets = checked ? checked.mine.openBets > 0 && !checked.all.paused && !steps.close : false;
  const done = (key: StepKey) => results.some((r) => r.key === key && r.ok);
  const chosen = (["close", "takeBack"] as const).filter(
    (k) => steps[k] && !done(k) && !(k === "takeBack" && blockedByOpenBets),
  );
  // reversing everyone's bets waits for the word, as the Recovery desk did
  const needsWord = forAll && chosen.includes("takeBack");
  const waiting = pending ?? [];
  const emailsWaiting = forAll ? (waitingCount ?? 0) : waiting.length;

  const record = (r: StepResult) => setResults((prev) => [...prev.filter((x) => x.key !== r.key), r]);

  const run = async () => {
    if (!checked || (needsWord && confirmText !== "REVERSE")) return;
    setBusy("run");
    setError(null);
    const p = {
      topics: checked.topics,
      sinceDays: null,
      ...(checked.sinceAt ? { sinceAt: checked.sinceAt } : {}),
      ...(forAll ? {} : { customer: checked.customer }),
    };
    try {
      if (chosen.includes("close")) {
        const state = await fetchBookSettings();
        await updateBookSettings({
          pausedTopics: [...new Set([...(state.settings.pausedTopics ?? []), ...checked.topics])],
        });
        // refund now; if this call fails the minute-by-minute pass still does it
        const refund = await voidPausedMarkets({
          reason: `Closed by the desk: ${checked.topics.join(", ")}`,
          dryRun: false,
        }).catch(() => null);
        record({
          key: "close",
          ok: true,
          text: refund
            ? `Closed for everyone. ${refund.positions} open bet${refund.positions === 1 ? "" : "s"} refunded (${money.format(refund.refundKobo)}).`
            : "Closed for everyone. Open bets on them are refunded within a minute.",
        });
      }

      if (chosen.includes("takeBack")) {
        let reversed = 0;
        let changeKobo = 0;
        for (let guard = 0; guard < 1_000; guard++) {
          const batch = await runReversalBatch({ ...p, shortfall, reason: checked.reason });
          reversed += batch.reversed;
          changeKobo += batch.changeKobo;
          if (batch.remaining === 0 || batch.reversed === 0) break;
        }
        if (forAll) {
          setWaitingCount(await countWaiting());
          record({
            key: "takeBack",
            ok: true,
            text: `${reversed} bet${reversed === 1 ? "" : "s"} reversed: ${
              changeKobo <= 0
                ? `we recovered ${money.format(-changeKobo)}`
                : `customers got back ${money.format(changeKobo)}`
            }.`,
          });
        } else {
          // read back, since the close may have refunded an open bet of theirs too
          const [now, letters] = await Promise.all([
            fetchTraders({ search: checked.customer, limit: 10 })
              .then((l) =>
                l.traders.find((t) => t.authUserId === (checked.person?.authUserId ?? checked.mine.customerRows?.[0]?.authUserId)),
              )
              .catch(() => undefined),
            loadPending(checked.customer),
          ]);
          if (now) setChecked({ ...checked, person: now });
          setPending(letters);
          record({
            key: "takeBack",
            ok: true,
            text: `${reversed} bet${reversed === 1 ? "" : "s"} reversed: their balance went ${changeKobo > 0 ? "up" : "down"} by ${money.format(Math.abs(changeKobo))}.${now ? ` It is now ${money.format(now.balanceKobo)}.` : ""}`,
          });
        }
        setConfirmText("");
        reloadHistory();
      }
    } catch (err) {
      setError(
        `${err instanceof Error && err.message ? err.message : "Something failed."} Press the button again to finish. Steps already done are skipped.`,
      );
      reloadHistory();
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!checked) return;
    setBusy("send");
    setError(null);
    try {
      const edited = !forAll && draft ? { subject: draft.subject.trim(), text: draft.text.trim() } : undefined;
      const res = forAll ? await notifyReversals(false) : await notifyReversals(false, checked.customer, edited);
      if (res.mailConfigured && res.emailed > 0) {
        record({
          key: "email",
          ok: true,
          text: forAll
            ? `Sent to ${res.emailed} customer${res.emailed === 1 ? "" : "s"}.`
            : `Sent${edited ? " your edited email" : ""} to ${waiting[0]?.to ?? name}.`,
        });
        setPending([]);
        setWaitingCount(0);
        setDraft(null);
        reloadHistory();
      } else {
        // the email stays on screen, so it can be sent again or copied
        setError(
          res.mailConfigured
            ? "The email didn't go out. Try again in a minute."
            : "Email isn't set up on the API, so nothing was sent. Copy the email and send it from Support.",
        );
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't send. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const copy = async (letter: ReversalLetter) => {
    const ok = await copyText(`To: ${letter.to}\nSubject: ${letter.subject}\n\n${letter.text}`);
    showToast(ok ? "Email copied" : "Couldn't copy. Select the text and copy it instead.", ok ? "success" : "error");
  };

  const toggle = (key: "close" | "takeBack") => setSteps((st) => ({ ...st, [key]: !st[key] }));
  const emailResult = results.find((r) => r.key === "email");
  const draftReady = !draft || (draft.subject.trim().length >= 3 && draft.text.trim().length >= 20);
  const allDone = chosen.length === 0 && results.length > 0 && emailsWaiting === 0;
  const placedFrom = checked?.sinceAt ? `placed from ${dayLabel(checked.sinceAt)}` : "of all time";
  const shownTopics = parseTopics(shown.text);

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Take action</h1>
      <p className="mt-1 max-w-3xl text-sm text-secondary">
        Put a type of market right: close it, take back what was won on it, and tell the customers why. Name a
        customer, or leave it empty for everyone who bet on these markets. Check first; nothing moves until you press
        the button, and emails go only when you press Send.
      </p>

      <section className="mt-5 max-w-3xl rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="min-w-0">
            <span className="block text-xs font-medium text-secondary">Markets: words in their titles, or a link</span>
            <input
              value={marketsText}
              onChange={(e) => {
                setMarketsText(e.target.value);
                reset();
              }}
              onBlur={showReport}
              placeholder="e.g. x posts"
              className="mt-1 h-9 w-full rounded-md border border-border bg-sunken px-3 text-sm outline-none placeholder:text-tertiary focus:border-accent"
            />
          </label>
          <label className="min-w-0">
            <span className="block text-xs font-medium text-secondary">Customer (optional): username or email</span>
            <input
              value={customer}
              onChange={(e) => {
                setCustomer(e.target.value);
                reset();
              }}
              placeholder="Empty = everyone"
              className="mt-1 h-9 w-full rounded-md border border-border bg-sunken px-3 text-sm outline-none placeholder:text-tertiary focus:border-accent"
            />
          </label>
          <label>
            <span className="block text-xs font-medium text-secondary">Bets placed from</span>
            <input
              type="date"
              value={sinceDate}
              onChange={(e) => {
                setSinceDate(e.target.value);
                reset();
              }}
              onBlur={showReport}
              className="mt-1 h-9 rounded-md border border-border bg-sunken px-3 text-sm outline-none focus:border-accent"
            />
            <span className="mt-1 block text-xs text-tertiary">
              {sinceDate === TERMS_LIVE_DATE
                ? "The day the Terms went live"
                : sinceDate
                  ? "Not the Terms date (21 Oct 2026)"
                  : "Empty: all time, before the Terms too"}
            </span>
          </label>
        </div>
        <label className="mt-3 block">
          <span className="block text-xs font-medium text-secondary">
            Reason: the email gives this word for word, under &ldquo;Why we did this&rdquo;
          </span>
          <textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (checked && !results.some((r) => r.key === "takeBack")) reset();
            }}
            disabled={results.some((r) => r.key === "takeBack")}
            rows={3}
            maxLength={1000}
            className="mt-1 block w-full rounded-md border border-border bg-sunken px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
          />
        </label>

        {!checked && (
          <button
            type="button"
            onClick={() => void check()}
            disabled={busy !== null || topics.length === 0 || reason.trim().length < MIN_REASON}
            className="pressable mt-4 h-10 rounded-sm bg-accent px-5 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
          >
            {busy === "check" ? "Checking…" : who ? "1. Check" : "1. Check everyone"}
          </button>
        )}

        {checked && (
          <>
            {forAll ? (
              <p className="mt-4 rounded-md bg-element-2 px-3 py-2 text-sm">
                <b>Everyone</b> who bet on &ldquo;{checked.topics.join(", ")}&rdquo; markets:{" "}
                {checked.mine.customers} customer{checked.mine.customers === 1 ? "" : "s"}, {checked.mine.bets} settled bet
                {checked.mine.bets === 1 ? "" : "s"} {placedFrom}.
              </p>
            ) : (
              <Person checked={checked} balanceKobo={balanceBefore} money={money} />
            )}

            <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-secondary">
              {results.length > 0 ? "What happened" : "What will happen"}
            </p>
            <ol className="mt-2 flex flex-col gap-2">
              <Step
                n={1}
                on={steps.close}
                onToggle={() => toggle("close")}
                locked={checked.all.paused || done("close")}
                already={checked.all.paused}
                result={results.find((r) => r.key === "close")}
                title={
                  checked.all.paused
                    ? `“${checked.topics.join(", ")}” markets are already closed for everyone`
                    : `Close every “${checked.topics.join(", ")}” market for everyone`
                }
              >
                {checked.all.paused
                  ? "No one can bet on them, and open bets on them are refunded automatically."
                  : `No one can place a new bet on them. ${checked.all.openBets} open bet${checked.all.openBets === 1 ? "" : "s"} on them (all customers) get${checked.all.openBets === 1 ? "s" : ""} the stake back${checked.all.openBets > 0 ? ", and each of those customers gets an automatic email saying their bet was refunded" : ""}. To only stop new bets, with no refunds or emails, untick this and use Market controls in Markets → All open.`}
              </Step>

              <Step
                n={2}
                on={steps.takeBack && !blockedByOpenBets}
                onToggle={() => toggle("takeBack")}
                locked={checked.mine.bets === 0 || done("takeBack")}
                result={results.find((r) => r.key === "takeBack")}
                title={
                  checked.mine.bets === 0
                    ? `${forAll ? "Nobody has" : `${name} has`} nothing to take back on these markets${checked.sinceAt ? ` since ${dayLabel(checked.sinceAt)}` : ""}`
                    : forAll
                      ? checked.mine.netKobo >= 0
                        ? `Take back winnings from ${checked.mine.customers} customer${checked.mine.customers === 1 ? "" : "s"}: we recover ${money.formatForConfirm(checked.mine.netKobo)}`
                        : `Reverse ${checked.mine.customers} customers’ bets: this gives them back ${money.formatForConfirm(-checked.mine.netKobo)}, as their losses were bigger than their winnings`
                      : checked.mine.netKobo >= 0
                        ? `Take back ${name}’s winnings: we recover ${money.formatForConfirm(checked.mine.netKobo)}`
                        : `Reverse ${name}’s bets: this gives them back ${money.formatForConfirm(-checked.mine.netKobo)}, as their losses were bigger than their winnings`
                }
              >
                {checked.mine.bets === 0 ? (
                  "Nothing to take back."
                ) : (
                  <>
                    {checked.mine.bets} bet{checked.mine.bets === 1 ? "" : "s"} ({checked.mine.won} won,{" "}
                    {checked.mine.lost} lost) on {checked.mine.events.length}
                    {checked.mine.events.length === 30 ? "+" : ""} market
                    {checked.mine.events.length === 1 ? "" : "s"}, {placedFrom}.{" "}
                    {money.formatForConfirm(checked.mine.takeBackKobo)} of winnings come back and{" "}
                    {money.formatForConfirm(checked.mine.returnKobo)} of stakes on lost bets is returned, as if the bets never
                    happened.{" "}
                    {forAll
                      ? checked.mine.shortCustomers > 0
                        ? `${checked.mine.shortCustomers} customer${checked.mine.shortCustomers === 1 ? " can't" : "s can't"} cover ${money.formatForConfirm(checked.mine.shortKobo)} of it.`
                        : "Every customer's balance covers it."
                      : `Their balance is ${money.formatForConfirm(balanceBefore)}${covers ? ", which covers it." : ", which doesn't cover it."}`}
                    {blockedByOpenBets && (
                      <span className={`mt-2 block rounded-md px-2 py-1 font-semibold ${FLAG_TONE.caution.chip}`}>
                        {forAll ? "There are" : "They still have"} {checked.mine.openBets} open bet
                        {checked.mine.openBets === 1 ? "" : "s"} here, so step 1 has to close the markets first.
                      </span>
                    )}
                    {!covers && steps.takeBack && !done("takeBack") && (
                      <span className="mt-2 flex flex-wrap gap-2">
                        {(
                          [
                            ["negative", "Take it all", "Their balance goes below zero. They can't bet or withdraw until it's paid back."],
                            ["cap", "Take only what's there", "Stop at zero and write off the rest."],
                          ] as const
                        ).map(([key, label, hint]) => (
                          <label
                            key={key}
                            className={`flex min-w-0 flex-1 basis-52 cursor-pointer gap-2 rounded-md border px-3 py-2 ${
                              shortfall === key ? "border-accent bg-surface" : "border-border"
                            }`}
                          >
                            <input
                              type="radio"
                              checked={shortfall === key}
                              onChange={() => setShortfall(key)}
                              className="mt-0.5 accent-[var(--accent)]"
                            />
                            <span>
                              <span className="block font-semibold text-primary">{label}</span>
                              <span className="block text-xs">{hint}</span>
                            </span>
                          </label>
                        ))}
                      </span>
                    )}
                    {checked.mine.events.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-semibold text-accent-ink">See the markets</summary>
                        <ul className="mt-1 list-disc pl-5 text-xs">
                          {checked.mine.events.map((e) => (
                            <li key={e.title}>
                              {e.title} · {e.bets} bet{e.bets === 1 ? "" : "s"}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </Step>

              {forAll ? (
                <Step n={3} manual result={emailResult} title="Email the customers why">
                  {emailsWaiting > 0 ? (
                    <>
                      <span className="font-semibold text-primary">Ready to send.</span>
                      {` ${emailsWaiting} customer${emailsWaiting === 1 ? " has" : "s have"} a reversal email waiting (this counts any earlier incident not told yet). Each gets their own figures and the reason written for their bets. To read one first, press “Act on them” next to that customer below.`}
                      <button
                        type="button"
                        onClick={send}
                        disabled={busy !== null}
                        className="pressable mt-3 flex h-10 items-center gap-2 rounded-sm bg-accent px-5 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
                      >
                        <Mail className="size-4" />
                        {busy === "send" ? "Sending…" : `3. Send ${emailsWaiting} email${emailsWaiting === 1 ? "" : "s"}`}
                      </button>
                    </>
                  ) : checked.mine.bets > 0 && !done("takeBack") ? (
                    "Each customer gets one email with their own figures and the reason above. To read one before anything moves, press “Act on them” next to that customer below. Nothing is sent until you press Send, which appears here after step 2."
                  ) : waitingCount === null && done("takeBack") ? (
                    "The API couldn't say how many emails are waiting. Send them from Every incident so far below."
                  ) : (
                    "Nothing to email."
                  )}
                </Step>
              ) : (
                <Step n={3} manual result={emailResult} title={`Email ${name} about the violation`}>
                  {waiting.length > 0 ? (
                    <>
                      <span className="font-semibold text-primary">Ready to send.</span>
                      {draft
                        ? ` Your edited email goes to ${name} only, exactly as it reads below. Press Send when you’re happy with it.`
                        : ` This is the email exactly as it will go out, to ${name} only. Edit any of it, or press Send when you’re happy with it.`}
                      {waiting.length === 1 && draft ? (
                        <DraftEditor
                          to={waiting[0]!.to}
                          draft={draft}
                          onChange={setDraft}
                          onCopy={() => void copy({ to: waiting[0]!.to, ...draft })}
                          onUndo={() => setDraft(null)}
                        />
                      ) : (
                        waiting.map((l, i) => (
                          <Letter
                            key={i}
                            letter={l}
                            onCopy={() => void copy(l)}
                            onEdit={waiting.length === 1 ? () => setDraft({ subject: l.subject, text: l.text }) : undefined}
                          />
                        ))
                      )}
                      {waiting.length > 1 && (
                        <span className="mt-2 block text-xs text-tertiary">
                          Several emails are waiting for them (one per reason), so they go as written.
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={send}
                        disabled={busy !== null || !draftReady}
                        className="pressable mt-3 inline-flex h-10 items-center gap-2 rounded-sm bg-accent px-5 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
                      >
                        <Mail className="size-4" />
                        {busy === "send" ? "Sending…" : waiting.length === 1 ? "3. Send this email" : `3. Send these ${waiting.length} emails`}
                      </button>
                    </>
                  ) : checked.mine.letter && !done("takeBack") ? (
                    <>
                      This is the email {name} will get once step 2 is done. Copy it to share with your manager.
                      Nothing is sent until you press Send, which appears here after step 2.
                      {!covers && shortfall === "cap" && " The figures assume the whole amount is taken."}
                      <Letter letter={checked.mine.letter} onCopy={() => void copy(checked.mine.letter!)} />
                    </>
                  ) : checked.mine.bets > 0 && (checked.mine.letter === undefined || pending === null) ? (
                    "The API is older than this page, so it can't show or send the email from here. Deploy the API first."
                  ) : (
                    "Nothing to email: there's nothing to take back."
                  )}
                </Step>
              )}
            </ol>

            {chosen.length > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {needsWord && (
                  <input
                    aria-label="Type REVERSE to confirm"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                    placeholder="Type REVERSE to confirm"
                    className="h-10 w-56 rounded-md border border-border bg-surface px-3 text-sm outline-none focus:border-no"
                  />
                )}
                <button
                  type="button"
                  onClick={run}
                  disabled={busy !== null || (needsWord && confirmText !== "REVERSE")}
                  className="pressable h-10 rounded-sm bg-no-solid px-5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {busy === "run"
                    ? "Working…"
                    : chosen.length === 2
                      ? "2. Do steps 1 and 2 now"
                      : `2. Do step ${chosen[0] === "close" ? 1 : 2} now`}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  disabled={busy !== null}
                  className="h-10 rounded-sm border border-border px-4 text-sm font-semibold text-secondary hover:text-primary"
                >
                  Change
                </button>
                <span className="text-xs text-tertiary">
                  This can&rsquo;t be undone. {forAll ? "The emails wait" : "The email waits"} for you.
                </span>
              </div>
            ) : allDone ? (
              <div
                className={`mt-4 rounded-md px-3 py-2 text-sm ${results.every((r) => r.ok) ? "bg-yes-tint" : FLAG_TONE.caution.chip}`}
              >
                <p className={`font-semibold ${results.every((r) => r.ok) ? "text-yes" : ""}`}>
                  {results.every((r) => r.ok) ? "All done." : "Done, except the step marked with a cross."}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setCustomer("");
                    reset();
                  }}
                  className="mt-1 text-xs font-semibold text-accent-ink hover:underline"
                >
                  Start again
                </button>
              </div>
            ) : results.length === 0 && emailsWaiting === 0 ? (
              <p className="mt-4 rounded-md bg-element-2 px-3 py-2 text-sm">
                Nothing to do for {name} on these markets.
              </p>
            ) : null}
          </>
        )}

        {error && <p className={`mt-3 rounded-md px-3 py-2 text-sm font-semibold ${FLAG_TONE.danger.chip}`}>{error}</p>}
      </section>

      <BetsReport
        // a new market or date starts the report afresh
        key={`${shownTopics.join(",")}|${shown.date}`}
        topics={shownTopics}
        sinceAt={sinceAtFor(shown.date)}
        busy={busy !== null}
        reloadKey={historyVersion}
        onPick={(username) => {
          setCustomer(username);
          window.scrollTo({ top: 0, behavior: "smooth" });
          void check(username);
        }}
      />

      <IncidentHistory
        report={history.data}
        loading={history.loading}
        error={history.error}
        money={money}
        hideEmails={forAll}
        onRefresh={history.refresh}
        onChanged={reloadHistory}
      />
    </div>
  );
}

/** Midnight in Lagos on that day, as the exact moment the API counts from; null = all time. */
function sinceAtFor(date: string): string | null {
  return date ? `${date}T00:00:00${LAGOS_OFFSET}` : null;
}

/**
 * Copy to the clipboard: the modern way, else the older one, which some
 * browsers and embedded views still allow when the first is refused.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

/** One email as it goes out, with a way to copy it whole, and to edit it. */
function Letter({ letter, onCopy, onEdit }: { letter: ReversalLetter; onCopy: () => void; onEdit?: () => void }) {
  return (
    <div className="mt-2 rounded-md border border-border bg-page">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-3 py-2 text-xs">
        <div className="min-w-0">
          <p className="text-secondary">
            To: <span className="text-primary">{letter.to}</span>
          </p>
          <p className="text-secondary">
            Subject: <span className="font-semibold text-primary">{letter.subject}</span>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="h-8 rounded-sm border border-border px-3 text-xs font-semibold text-secondary hover:text-primary"
            >
              Edit email
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            className="h-8 rounded-sm border border-border px-3 text-xs font-semibold text-secondary hover:text-primary"
          >
            Copy email
          </button>
        </div>
      </div>
      <div className="whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-6 text-primary">{letter.text}</div>
    </div>
  );
}

/** The waiting email, open for the desk to rewrite: subject and text. */
function DraftEditor({
  to,
  draft,
  onChange,
  onCopy,
  onUndo,
}: {
  to: string;
  draft: { subject: string; text: string };
  onChange: (d: { subject: string; text: string }) => void;
  onCopy: () => void;
  onUndo: () => void;
}) {
  return (
    <div className="mt-2 rounded-md border border-accent/50 bg-page">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-secondary">
            To: <span className="text-primary">{to}</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onUndo}
              className="h-8 rounded-sm border border-border px-3 text-xs font-semibold text-secondary hover:text-primary"
            >
              Undo my changes
            </button>
            <button
              type="button"
              onClick={onCopy}
              className="h-8 rounded-sm border border-border px-3 text-xs font-semibold text-secondary hover:text-primary"
            >
              Copy email
            </button>
          </div>
        </div>
        <label className="flex items-center gap-2 text-secondary">
          Subject:
          <input
            value={draft.subject}
            onChange={(e) => onChange({ ...draft, subject: e.target.value })}
            maxLength={200}
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-sunken px-2 text-sm font-semibold text-primary outline-none focus:border-accent"
          />
        </label>
      </div>
      <textarea
        value={draft.text}
        onChange={(e) => onChange({ ...draft, text: e.target.value })}
        rows={20}
        maxLength={10_000}
        aria-label="Email text"
        className="block w-full resize-y bg-transparent px-3 py-2.5 text-sm leading-6 text-primary outline-none"
      />
    </div>
  );
}

function Person({ checked, balanceKobo, money }: { checked: Checked; balanceKobo: number; money: AdminMoney }) {
  const p = checked.person;
  const row = checked.mine.customerRows?.[0];
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-element-2 px-3 py-2 text-sm">
      <span className="font-semibold">{p?.displayName || p?.username || row?.username || checked.customer}</span>
      <span className="text-secondary">@{p?.username || row?.username || checked.customer}</span>
      {(p?.email || row?.email) && <span className="text-secondary">{p?.email || row?.email}</span>}
      <span className="text-secondary">
        Balance <b className="text-primary">{money.format(balanceKobo)}</b>
      </span>
      {p?.suspendedAt && <span className={`rounded-sm px-1.5 text-xs font-semibold ${FLAG_TONE.danger.chip}`}>Suspended</span>}
      {p?.withdrawalsLockedAt && (
        <span className={`rounded-sm px-1.5 text-xs font-semibold ${FLAG_TONE.caution.chip}`}>Withdrawals locked</span>
      )}
    </div>
  );
}

function Step({
  n,
  on = false,
  onToggle,
  locked = false,
  already = false,
  manual = false,
  result,
  title,
  children,
}: {
  n: number;
  on?: boolean;
  onToggle?: () => void;
  /** Nothing to choose: already done, or nothing to do. */
  locked?: boolean;
  /** Already the case before anything ran: shown ticked. */
  already?: boolean;
  /** Done on its own press, not by the main button: no tick box. */
  manual?: boolean;
  result?: StepResult;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className={`rounded-md border px-3 py-2.5 ${on && !result ? "border-accent/50" : "border-border"}`}>
      <div className="flex items-start gap-2.5">
        {already && !result ? (
          <Check className="mt-0.5 size-5 shrink-0 text-yes" aria-label="Already done" />
        ) : result ? (
          result.ok ? (
            <Check className="mt-0.5 size-5 shrink-0 text-yes" aria-label="Done" />
          ) : (
            <Cross className="mt-0.5 size-5 shrink-0 text-no" aria-label="Not done" />
          )
        ) : manual ? (
          <Mail className="mt-0.5 size-5 shrink-0 text-secondary" aria-hidden />
        ) : (
          <input
            type="checkbox"
            checked={on}
            onChange={onToggle}
            disabled={locked}
            aria-label={`Step ${n}`}
            className="mt-1 size-4 shrink-0 accent-[var(--accent)] disabled:opacity-40"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {n}. {title}
          </p>
          {result ? (
            <p className={`mt-0.5 text-sm ${result.ok ? "text-secondary" : "font-semibold text-no"}`}>{result.text}</p>
          ) : (
            <div className="mt-0.5 text-sm text-secondary">{children}</div>
          )}
        </div>
      </div>
    </li>
  );
}
