"use client";

import { useState } from "react";
import { CheckCircleIcon as Check, XCircleIcon as Cross } from "@heroicons/react/24/outline";
import {
  fetchBookSettings,
  fetchTraders,
  notifyReversals,
  previewReversal,
  runReversalBatch,
  updateBookSettings,
  voidPausedMarkets,
  type ReversalPreview,
  type Shortfall,
  type TraderRow,
} from "@/lib/admin-api";
import { isApiConfigured } from "@/lib/api-client";
import { useAdminMoney, type AdminMoney } from "@/lib/admin-money";
import { FLAG_TONE } from "@/components/admin/risk-flags";

/**
 * Take action: one card for "close these markets, take back what this
 * customer won on them, and tell them why". Two presses.
 *
 * Check: who the customer is, their settled bets on the markets (what
 * taking back would recover), and how many open bets everyone holds on
 * them. Nothing moves.
 *
 * Do it, in order, each step skipped once it's done so pressing again
 * after a failure finishes the job without doing anything twice:
 *   1. close the markets for everyone: the topics go on the paused list
 *      (no new bets) and every open bet on them is refunded now, rather
 *      than at the next minute's pass;
 *   2. reverse the customer's settled bets on them, in batches (winnings
 *      back, stakes on lost bets returned), with the reason kept;
 *   3. email the reversal, which quotes the reason word for word.
 */

const DAY_MS = 86_400_000;
const MIN_REASON = 10;

const DEFAULT_REASON =
  "This is a violation of our Terms and Conditions (sections 4b and 4c). You placed bets on X post count markets when the result was already all but decided, which our rules don't allow. We have taken back the winnings from those bets. Any further violation may lead to your account being suspended.";

type StepKey = "close" | "takeBack" | "email";

interface Checked {
  /** The customer as typed, so a later edit can't change who the run hits. */
  customer: string;
  topics: string[];
  sinceDays: number | null;
  person: TraderRow | null;
  /** Their settled bets on these markets. */
  mine: ReversalPreview;
  /** Everyone's, for the open bets the close refunds. */
  all: ReversalPreview;
}

interface StepResult {
  key: StepKey;
  ok: boolean;
  text: string;
}

export function BreachDesk() {
  const money = useAdminMoney();
  const [customer, setCustomer] = useState("");
  const [marketsText, setMarketsText] = useState("x posts");
  const [sinceDate, setSinceDate] = useState("");
  const [reason, setReason] = useState(DEFAULT_REASON);
  const [steps, setSteps] = useState<Record<StepKey, boolean>>({ close: true, takeBack: true, email: true });
  const [shortfall, setShortfall] = useState<Shortfall>("negative");
  const [checked, setChecked] = useState<Checked | null>(null);
  const [busy, setBusy] = useState<"check" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<StepResult[]>([]);
  const [finished, setFinished] = useState(false);

  if (!isApiConfigured()) {
    return <p className="text-sm text-secondary">This page needs the prediction API (NEXT_PUBLIC_API_URL).</p>;
  }

  const topics = marketsText
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const who = customer.trim().replace(/^@/, "");

  const reset = () => {
    setChecked(null);
    setResults([]);
    setFinished(false);
    setError(null);
  };

  const check = async () => {
    setBusy("check");
    reset();
    // worked out on the press, so rendering stays pure
    const sinceDays = sinceDate
      ? Math.max(Math.ceil((Date.now() - new Date(`${sinceDate}T00:00:00`).getTime()) / DAY_MS), 1)
      : null;
    try {
      const [mine, all, people] = await Promise.all([
        previewReversal({ topics, sinceDays, customer: who }),
        previewReversal({ topics, sinceDays: null }),
        fetchTraders({ search: who, limit: 10 }).catch(() => null),
      ]);
      const lower = who.toLowerCase();
      const person =
        people?.traders.find((t) => t.username.toLowerCase() === lower || t.email.toLowerCase() === lower) ?? null;
      setChecked({ customer: who, topics, sinceDays, person, mine, all });
      setSteps({ close: !all.paused, takeBack: mine.bets > 0, email: mine.bets > 0 });
      const balance = mine.customerRows?.[0]?.balanceKobo ?? person?.balanceKobo ?? 0;
      setShortfall(balance >= mine.netKobo ? "cap" : "negative");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't check. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const name = checked
    ? checked.person?.displayName || checked.person?.username || checked.mine.customerRows?.[0]?.username || checked.customer
    : who;
  const balanceBefore = checked ? (checked.person?.balanceKobo ?? checked.mine.customerRows?.[0]?.balanceKobo ?? 0) : 0;
  const covers = checked ? balanceBefore >= checked.mine.netKobo : true;
  // a take-back waits while they hold open bets on markets still taking bets
  const blockedByOpenBets = checked ? checked.mine.openBets > 0 && !checked.all.paused && !steps.close : false;
  const done = (key: StepKey) => results.some((r) => r.key === key && r.ok);
  const chosen = (["close", "takeBack", "email"] as const).filter(
    (k) => steps[k] && !(k === "takeBack" && blockedByOpenBets) && !(k === "email" && !steps.takeBack && !done("takeBack")),
  );

  const run = async () => {
    if (!checked) return;
    setBusy("run");
    setError(null);
    const p = { topics: checked.topics, sinceDays: checked.sinceDays, customer: checked.customer };
    const out = results.filter((r) => r.ok);
    const record = (r: StepResult) => {
      out.push(r);
      setResults([...out]);
    };
    try {
      if (chosen.includes("close") && !done("close")) {
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

      if (chosen.includes("takeBack") && !done("takeBack")) {
        let reversed = 0;
        let changeKobo = 0;
        for (let guard = 0; guard < 1_000; guard++) {
          const batch = await runReversalBatch({ ...p, shortfall, reason: reason.trim() });
          reversed += batch.reversed;
          changeKobo += batch.changeKobo;
          if (batch.remaining === 0 || batch.reversed === 0) break;
        }
        // read back, since the close may have refunded an open bet of theirs too
        const now = await fetchTraders({ search: checked.customer, limit: 10 })
          .then((l) => l.traders.find((t) => t.authUserId === (checked.person?.authUserId ?? checked.mine.customerRows?.[0]?.authUserId)))
          .catch(() => undefined);
        if (now) setChecked({ ...checked, person: now });
        record({
          key: "takeBack",
          ok: true,
          text: `${reversed} bet${reversed === 1 ? "" : "s"} reversed: their balance went down by ${money.format(-changeKobo)}.${now ? ` It is now ${money.format(now.balanceKobo)}.` : ""}`,
        });
      }

      if (chosen.includes("email") && !done("email")) {
        const res = await notifyReversals(false);
        record({
          key: "email",
          ok: res.mailConfigured,
          text: res.mailConfigured
            ? `Email sent with the reason. (${res.emailed} email${res.emailed === 1 ? "" : "s"} went out.)`
            : "Email isn't set up on the API, so nothing was sent. Message them from Support.",
        });
      }
      setFinished(true);
    } catch (err) {
      setError(
        `${err instanceof Error && err.message ? err.message : "Something failed."} Press the button again to finish. Steps already done are skipped.`,
      );
    } finally {
      setBusy(null);
    }
  };

  const toggle = (key: StepKey) => setSteps((s) => ({ ...s, [key]: !s[key] }));

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Take action</h1>
      <p className="mt-1 text-sm text-secondary">
        Close a type of market, take back what one customer won on it, and email them about the violation. Check
        first, then one press does it all.
      </p>

      <section className="mt-5 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="min-w-0">
            <span className="block text-xs font-medium text-secondary">Customer: username or email</span>
            <input
              value={customer}
              onChange={(e) => {
                setCustomer(e.target.value);
                reset();
              }}
              placeholder="e.g. wisdomlotsu"
              className="mt-1 h-9 w-full rounded-md border border-border bg-sunken px-3 text-sm outline-none placeholder:text-tertiary focus:border-accent"
            />
          </label>
          <label className="min-w-0">
            <span className="block text-xs font-medium text-secondary">Markets: words in their titles</span>
            <input
              value={marketsText}
              onChange={(e) => {
                setMarketsText(e.target.value);
                reset();
              }}
              className="mt-1 h-9 w-full rounded-md border border-border bg-sunken px-3 text-sm outline-none focus:border-accent"
            />
          </label>
          <label>
            <span className="block text-xs font-medium text-secondary">Their bets since (optional)</span>
            <input
              type="date"
              value={sinceDate}
              onChange={(e) => {
                setSinceDate(e.target.value);
                reset();
              }}
              className="mt-1 h-9 rounded-md border border-border bg-sunken px-3 text-sm outline-none focus:border-accent"
            />
          </label>
        </div>

        {!checked && (
          <button
            type="button"
            onClick={check}
            disabled={busy !== null || !who || topics.length === 0}
            className="pressable mt-4 h-10 rounded-sm bg-accent px-5 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
          >
            {busy === "check" ? "Checking…" : "1. Check"}
          </button>
        )}

        {checked && (
          <>
            <Person checked={checked} balanceKobo={balanceBefore} money={money} />

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
                  : `No one can place a new bet on them. ${checked.all.openBets} open bet${checked.all.openBets === 1 ? "" : "s"} on them (all customers) get${checked.all.openBets === 1 ? "s" : ""} the stake back.`}
              </Step>

              <Step
                n={2}
                on={steps.takeBack && !blockedByOpenBets}
                onToggle={() => toggle("takeBack")}
                locked={checked.mine.bets === 0 || done("takeBack")}
                result={results.find((r) => r.key === "takeBack")}
                title={
                  checked.mine.bets === 0
                    ? `${name} has nothing to take back on these markets${checked.sinceDays ? " since that date" : ""}`
                    : `Take back ${name}’s winnings: we recover ${money.format(checked.mine.netKobo)}`
                }
              >
                {checked.mine.bets === 0 ? (
                  "Nothing to take back."
                ) : (
                  <>
                    {checked.mine.bets} bet{checked.mine.bets === 1 ? "" : "s"} ({checked.mine.won} won,{" "}
                    {checked.mine.lost} lost) on {checked.mine.events.length} market
                    {checked.mine.events.length === 1 ? "" : "s"}. {money.format(checked.mine.takeBackKobo)} of winnings
                    come back and {money.format(checked.mine.returnKobo)} of stakes on lost bets is returned, as if the
                    bets never happened. Their balance is {money.format(balanceBefore)}
                    {covers ? ", which covers it." : ", which doesn't cover it."}
                    {blockedByOpenBets && (
                      <span className={`mt-2 block rounded-md px-2 py-1 font-semibold ${FLAG_TONE.caution.chip}`}>
                        They still have {checked.mine.openBets} open bet{checked.mine.openBets === 1 ? "" : "s"} here, so
                        step 1 has to close the markets first.
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

              <Step
                n={3}
                on={steps.email && steps.takeBack && !blockedByOpenBets}
                onToggle={() => toggle("email")}
                locked={checked.mine.bets === 0 || !steps.takeBack || done("email")}
                result={results.find((r) => r.key === "email")}
                title={`Email ${name} about the violation`}
              >
                {checked.mine.bets === 0 ? (
                  "Sent only with a take-back. With nothing to take back, write to them from Support."
                ) : (
                  <>
                    The email lists the bets reversed and their new balance, and gives this reason word for word
                    {checked.person?.email ? ` (to ${checked.person.email})` : ""}:
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      disabled={done("takeBack")}
                      rows={4}
                      maxLength={1000}
                      className="mt-2 block w-full rounded-md border border-border bg-sunken px-3 py-2 text-sm text-primary outline-none focus:border-accent disabled:opacity-60"
                    />
                  </>
                )}
              </Step>
            </ol>

            {!finished && chosen.length === 0 && results.length === 0 ? (
              <p className="mt-4 rounded-md bg-element-2 px-3 py-2 text-sm">
                Nothing left to do for {name} on these markets.
              </p>
            ) : !finished ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={run}
                  disabled={busy !== null || chosen.length === 0 || (steps.takeBack && reason.trim().length < MIN_REASON)}
                  className="pressable h-10 rounded-sm bg-no-solid px-5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {busy === "run"
                    ? "Working…"
                    : chosen.length === 3
                      ? "2. Do all 3 now"
                      : `2. Do ${chosen.length === 1 ? "this step" : `these ${chosen.length} steps`} now`}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  disabled={busy !== null}
                  className="h-10 rounded-sm border border-border px-4 text-sm font-semibold text-secondary hover:text-primary"
                >
                  Change
                </button>
                <span className="text-xs text-tertiary">This can&rsquo;t be undone.</span>
              </div>
            ) : (
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
                  Act on another customer
                </button>
              </div>
            )}
          </>
        )}

        {error && <p className={`mt-3 rounded-md px-3 py-2 text-sm font-semibold ${FLAG_TONE.danger.chip}`}>{error}</p>}
      </section>
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
  on,
  onToggle,
  locked,
  already = false,
  result,
  title,
  children,
}: {
  n: number;
  on: boolean;
  onToggle: () => void;
  /** Nothing to choose: already done, or nothing to do. */
  locked: boolean;
  /** Already the case before anything ran: shown ticked. */
  already?: boolean;
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
