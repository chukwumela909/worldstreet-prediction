"use client";

import { useState } from "react";
import {
  ArrowPathIcon as RefreshCw,
  CheckCircleIcon as Check,
  EnvelopeIcon as Mail,
} from "@heroicons/react/24/outline";
import { isApiConfigured } from "@/lib/api-client";
import { useAdminMoney, type AdminMoney } from "@/lib/admin-money";
import { showToast } from "@/lib/toast-store";
import {
  clearDebts,
  fetchBookSettings,
  fetchRecovery,
  notifyReversals,
  previewReversal,
  runReversalBatch,
  updateBookSettings,
  useAdminResource,
  type DebtClearing,
  type RecoveryIncident,
  type RecoveryReport,
  type ReversalNotice,
  type ReversalPreview,
  type Shortfall,
} from "@/lib/admin-api";
import { FLAG_TONE } from "@/components/admin/risk-flags";

/**
 * Recovery: undoing the bets on a market after an incident — a pricing
 * glitch someone exploited, a result that was public before the market
 * closed — and what that got back.
 *
 * Top: what's been recovered — winnings taken back, stakes returned, the
 * net, and what's still owed by customers left below zero — then each
 * incident on its own line. Then the steps, in order: 1) reverse the bets
 * (name the markets by words or a pasted link, say why, preview → type
 * REVERSE → it runs in batches), 2) email the customers, who read the
 * reason as written, 3) clear what's owed. Then everyone affected.
 * Amounts follow the desk's ₦/$ switch.
 */

const MIN_REASON = 10;
/** The first reversals carried no reason; this is what they were for. */
const UNRECORDED_REASON = "15-minute crypto pricing glitch (before reasons were recorded)";

/**
 * The comma-separated box: words in market titles, or a market's link —
 * a pasted link is reduced to its last path segment, the market's slug.
 */
function parseTopics(text: string): string[] {
  return text
    .split(",")
    .map((raw) => {
      const t = raw.trim();
      if (!t.includes("/")) return t.toLowerCase();
      const path = t.split(/[?#]/)[0]!.replace(/\/+$/, "");
      return (path.split("/").pop() ?? "").toLowerCase();
    })
    .filter(Boolean);
}
const PERIODS: { key: string; label: string; days: number | null }[] = [
  { key: "all", label: "All time", days: null },
  { key: "98", label: "14 weeks", days: 98 },
  { key: "30", label: "30 days", days: 30 },
  { key: "7", label: "7 days", days: 7 },
];
const CUSTOMERS_PAGE = 20;

export function RecoveryDesk() {
  const money = useAdminMoney();
  const [version, setVersion] = useState(0);
  const summary = useAdminResource(fetchRecovery, true, version);
  const reload = () => setVersion((v) => v + 1);

  if (!isApiConfigured()) {
    return <Notice>This desk needs the prediction API (NEXT_PUBLIC_API_URL).</Notice>;
  }
  if (summary.errorCode === "FORBIDDEN") {
    return <Notice>Your account isn&rsquo;t an admin of the Local book.</Notice>;
  }
  if (summary.errorCode === "NOT_FOUND") {
    return <Notice>The API answering is older than this page — redeploy the API.</Notice>;
  }

  const report = summary.data;
  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Recovery</h1>
          <p className="mt-1 text-sm text-secondary">
            Reverse the bets on any market after an incident, tell the customers why, and see what
            it got back.
          </p>
        </div>
        <button
          type="button"
          onClick={summary.refresh}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
        >
          <RefreshCw className={`size-3.5 ${summary.loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {report && report.totals.bets > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Recovered for us"
            value={money.formatHeadline(report.totals.netKobo, { signed: true })}
            valueClass={report.totals.netKobo > 0 ? "text-yes" : report.totals.netKobo < 0 ? "text-no" : ""}
            note={`${report.totals.bets} bets reversed · ${report.totals.customers} customers`}
          />
          <Stat
            label="Winnings taken back"
            value={money.formatHeadline(report.totals.takenBackKobo)}
            note={`${money.format(report.totals.returnedKobo)} in stakes returned`}
          />
          <Stat
            label="Still owed to us"
            value={money.formatHeadline(report.totals.owedKobo)}
            valueClass={report.totals.owedKobo > 0 ? "text-warning" : ""}
            note={[
              report.totals.owingCustomers > 0
                ? `${report.totals.owingCustomers} customer${report.totals.owingCustomers === 1 ? "" : "s"} below zero`
                : "nobody below zero",
              report.totals.writtenOffKobo > 0 ? `${money.format(report.totals.writtenOffKobo)} written off` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          />
          <Stat
            label="Customers emailed"
            value={`${report.totals.emailed} of ${report.totals.customers}`}
            note={report.totals.notEmailed > 0 ? `${report.totals.notEmailed} not told yet` : "everyone told"}
          />
        </dl>
      )}
      {summary.error && !report && (
        <p className="mt-4 text-sm font-semibold text-no">Couldn&rsquo;t load: {summary.error}</p>
      )}
      {report?.incidents && report.incidents.length > 0 && (
        <IncidentsCard incidents={report.incidents} money={money} />
      )}

      <ReverseStep money={money} onDone={reload} />
      <EmailStep
        mailConfigured={report?.mailConfigured ?? true}
        waiting={report?.totals.notEmailed ?? 0}
        onDone={reload}
      />
      {report && (report.totals.owedKobo > 0 || report.totals.writtenOffKobo > 0) && (
        <DebtStep
          owedKobo={report.totals.owedKobo}
          owing={report.totals.owingCustomers}
          writtenOffKobo={report.totals.writtenOffKobo}
          money={money}
          onDone={reload}
        />
      )}
      {report && report.customers.length > 0 && <CustomersCard report={report} money={money} />}
    </div>
  );
}

/* ---------- step 1: reverse ---------- */

function ReverseStep({ money, onDone }: { money: AdminMoney; onDone: () => void }) {
  const [topicsText, setTopicsText] = useState("");
  const [reason, setReason] = useState("");
  const [period, setPeriod] = useState("all");
  const [shortfall, setShortfall] = useState<Shortfall>("negative");
  const [preview, setPreview] = useState<ReversalPreview | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState<"preview" | "pause" | "run" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const topics = parseTopics(topicsText);
  const reasonReady = reason.trim().length >= MIN_REASON;
  const sinceDays = PERIODS.find((p) => p.key === period)?.days ?? null;
  const reset = () => {
    setPreview(null);
    setConfirmText("");
  };

  const doPreview = async () => {
    setBusy("preview");
    setError(null);
    try {
      setPreview(await previewReversal({ topics, sinceDays }));
      setConfirmText("");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  const pause = async () => {
    setBusy("pause");
    setError(null);
    try {
      const state = await fetchBookSettings();
      const next = [...new Set([...(state.settings.pausedTopics ?? []), ...topics])];
      await updateBookSettings({ pausedTopics: next });
      showToast("Paused — these markets take no bets and leave the site", "success");
      setPreview(await previewReversal({ topics, sinceDays }));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    if (!preview || confirmText !== "REVERSE") return;
    setBusy("run");
    setError(null);
    let done = 0;
    setProgress({ done, total: preview.bets });
    try {
      for (let guard = 0; guard < 1_000; guard++) {
        const batch = await runReversalBatch({ topics, sinceDays, shortfall, reason: reason.trim() });
        done += batch.reversed;
        setProgress({ done, total: Math.max(preview.bets, done + batch.remaining) });
        if (batch.remaining === 0 || batch.reversed === 0) break;
      }
      showToast(`Reversed ${done} bet${done === 1 ? "" : "s"} — now email the customers below`, "success");
      reset();
      setReason("");
      onDone();
    } catch (err) {
      setError(`${message(err)} — ${done} reversed so far; run it again to finish.`);
      onDone();
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <h2 className="text-lg font-semibold">1 · Reverse the bets</h2>
      <p className="mt-0.5 text-sm text-secondary">
        Every settled bet on these markets is undone: winners give back their winnings and keep
        their stake, losers get their stake back. Preview first — nothing moves until you confirm.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="min-w-0">
          <span className="block text-xs font-medium text-secondary">
            Which markets — words in their titles, or paste a market&rsquo;s link (comma-separated)
          </span>
          <input
            value={topicsText}
            onChange={(e) => {
              setTopicsText(e.target.value);
              reset();
            }}
            placeholder="e.g. up or down 15 minutes, or https://…/local/channels-tv-number-of-x-posts-…"
            className="mt-1 h-10 w-full rounded-md border border-border bg-sunken px-3 text-sm outline-none placeholder:text-tertiary focus:border-accent"
          />
        </label>
        <div>
          <span className="block text-xs font-medium text-secondary">Bets placed</span>
          <Segmented
            label="Bets placed"
            options={PERIODS.map((p) => ({ key: p.key, label: p.label }))}
            value={period}
            onChange={(k) => {
              setPeriod(k);
              reset();
            }}
          />
        </div>
      </div>

      <fieldset className="mt-3">
        <legend className="text-xs font-medium text-secondary">
          If a winner&rsquo;s balance can&rsquo;t cover what&rsquo;s taken back
        </legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {(
            [
              ["negative", "Take it all — they owe the rest", "Their balance goes below zero; they can't bet or withdraw until new credit covers it."],
              ["cap", "Take only what's there", "Stop at zero and write off the rest."],
            ] as const
          ).map(([key, label, hint]) => (
            <label
              key={key}
              className={`flex min-w-0 flex-1 basis-60 cursor-pointer gap-2 rounded-md border px-3 py-2 text-sm ${
                shortfall === key ? "border-accent bg-element-2" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="shortfall"
                checked={shortfall === key}
                onChange={() => {
                  setShortfall(key);
                  setConfirmText("");
                }}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span>
                <span className="block font-semibold">{label}</span>
                <span className="block text-xs text-secondary">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-3 block">
        <span className="block text-xs font-medium text-secondary">
          Why — the customers&rsquo; email gives this reason, word for word
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="e.g. The post count was public before the market closed, so the result was already known."
          className="mt-1 w-full resize-y rounded-md border border-border bg-sunken px-3 py-2 text-sm outline-none placeholder:text-tertiary focus:border-accent"
        />
      </label>

      {!preview ? (
        <button
          type="button"
          onClick={doPreview}
          disabled={busy !== null || topics.length === 0}
          className="pressable mt-4 h-10 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
        >
          {busy === "preview" ? "Checking…" : "Preview"}
        </button>
      ) : preview.bets === 0 ? (
        <div className="mt-4 rounded-md bg-element-2 px-3 py-3 text-sm">
          <p className="font-semibold">No settled bets left to reverse on these markets.</p>
          <button type="button" onClick={reset} className="mt-2 text-sm font-semibold text-secondary hover:text-primary">
            Change and preview again
          </button>
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-border bg-sunken p-3 text-sm sm:p-4">
          <p className="font-semibold">
            {preview.bets} bets ({preview.won} won · {preview.lost} lost) from {preview.customers} customers
            on {preview.events.length}
            {preview.events.length === 30 ? "+" : ""} market{preview.events.length === 1 ? "" : "s"}.
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Stat label="Winnings taken back" value={money.format(preview.takeBackKobo)} />
            <Stat label="Stakes returned to losers" value={money.format(preview.returnKobo)} />
            <Stat
              label="Net for us"
              value={money.formatSigned(preview.netKobo)}
              valueClass={preview.netKobo > 0 ? "text-yes" : preview.netKobo < 0 ? "text-no" : ""}
            />
          </dl>
          {preview.shortCustomers > 0 && (
            <p className="mt-3 rounded-md bg-warning-tint px-3 py-2 font-semibold text-warning">
              {preview.shortCustomers} customer{preview.shortCustomers === 1 ? "" : "s"} can&rsquo;t cover{" "}
              {money.format(preview.shortKobo)} —{" "}
              {shortfall === "negative" ? "they'll go below zero and owe it." : "it will be written off."}
            </p>
          )}
          {preview.openBets > 0 && preview.paused && (
            <p className="mt-2 text-xs text-secondary">
              {preview.openBets} open bet{preview.openBets === 1 ? "" : "s"} on these markets are refunded by the
              pause instead, within a minute.
            </p>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold text-secondary">Markets matched</summary>
            <ul className="mt-1 text-xs text-secondary">
              {preview.events.map((e) => (
                <li key={e.title}>
                  {e.title} · {e.bets} bet{e.bets === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          </details>

          {!preview.paused && preview.openBets > 0 ? (
            <div className={`mt-4 rounded-md border px-3 py-3 ${FLAG_TONE.caution.banner}`}>
              <p className="font-semibold">
                {preview.openBets} bet{preview.openBets === 1 ? " is" : "s are"} still open on these markets — pause
                them first, so they&rsquo;re refunded and nothing new lands while reversing.
              </p>
              <button
                type="button"
                onClick={pause}
                disabled={busy !== null}
                className="pressable mt-2 h-9 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
              >
                {busy === "pause" ? "Pausing…" : "Pause these markets now"}
              </button>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {!reasonReady && (
                <p className="w-full text-xs font-semibold text-warning">
                  Write why above (at least {MIN_REASON} characters) — the customers&rsquo; email gives it.
                </p>
              )}
              <input
                aria-label="Type REVERSE to confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                placeholder="Type REVERSE to confirm"
                className="h-10 w-56 rounded-md border border-border bg-surface px-3 text-sm outline-none focus:border-no"
              />
              <button
                type="button"
                onClick={run}
                disabled={busy !== null || confirmText !== "REVERSE" || !reasonReady}
                className="pressable h-10 rounded-sm bg-no-solid px-4 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy === "run" && progress
                  ? `Reversing… ${progress.done} of ${progress.total}`
                  : `Reverse ${preview.bets} bets`}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={busy !== null}
                className="h-10 rounded-sm border border-border px-4 text-sm font-semibold text-secondary hover:text-primary"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-sm font-semibold text-no">{error}</p>}
    </section>
  );
}

/* ---------- step 2: email ---------- */

function EmailStep({
  mailConfigured,
  waiting,
  onDone,
}: {
  mailConfigured: boolean;
  waiting: number;
  onDone: () => void;
}) {
  const [preview, setPreview] = useState<ReversalNotice | null>(null);
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (dryRun: boolean) => {
    setBusy(dryRun ? "preview" : "send");
    setError(null);
    try {
      const result = await notifyReversals(dryRun);
      if (dryRun) setPreview(result);
      else {
        setPreview(null);
        showToast(`Email sent to ${result.emailed} customer${result.emailed === 1 ? "" : "s"}`, result.emailed > 0 ? "success" : "error");
        onDone();
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <h2 className="text-lg font-semibold">2 · Email the customers</h2>
      <p className="mt-0.5 text-sm text-secondary">
        One email per customer for each incident: the reason you wrote, the markets, the stakes
        returned and payouts taken back, and their new balance. Nobody is told twice.
      </p>
      {!mailConfigured && (
        <p className="mt-3 rounded-md bg-warning-tint px-3 py-2 text-sm font-semibold text-warning">
          Customer email isn&rsquo;t set up on the API (RESEND_API_KEY and a sender), so nothing can be sent yet.
        </p>
      )}
      {preview ? (
        <div className="mt-3 rounded-md bg-element-2 px-3 py-3 text-sm">
          <p className="font-semibold">
            {preview.customers === 0
              ? "Everyone with reversed bets has been told."
              : `${preview.customers} customer${preview.customers === 1 ? "" : "s"} will get the email.`}
          </p>
          <div className="mt-2 flex gap-2">
            {preview.customers > 0 && (
              <button
                type="button"
                onClick={() => go(false)}
                disabled={busy !== null || !mailConfigured}
                className="pressable flex h-9 items-center gap-1.5 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
              >
                <Mail className="size-4" aria-hidden />
                {busy === "send" ? "Sending…" : `Send ${preview.customers} email${preview.customers === 1 ? "" : "s"}`}
              </button>
            )}
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-secondary hover:text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => go(true)}
          disabled={busy !== null || waiting === 0}
          className="mt-3 flex h-9 items-center gap-1.5 rounded-sm border border-border px-4 text-sm font-semibold hover:border-border-hover disabled:opacity-40"
        >
          <Mail className="size-4" aria-hidden />
          {busy === "preview"
            ? "Checking…"
            : waiting > 0
              ? `Email ${waiting} customer${waiting === 1 ? "" : "s"} not yet told…`
              : "Everyone has been told"}
        </button>
      )}
      {error && <p className="mt-3 text-sm font-semibold text-no">{error}</p>}
    </section>
  );
}

/* ---------- step 3: clear what's owed ---------- */

function DebtStep({
  owedKobo,
  owing,
  writtenOffKobo,
  money,
  onDone,
}: {
  owedKobo: number;
  owing: number;
  writtenOffKobo: number;
  money: AdminMoney;
  onDone: () => void;
}) {
  const [preview, setPreview] = useState<DebtClearing | null>(null);
  const [busy, setBusy] = useState<"preview" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (dryRun: boolean) => {
    setBusy(dryRun ? "preview" : "clear");
    setError(null);
    try {
      const result = await clearDebts(dryRun);
      if (dryRun) setPreview(result);
      else {
        setPreview(null);
        showToast(
          `Cleared ${money.format(result.owedKobo)} owed by ${result.customers} customer${result.customers === 1 ? "" : "s"}`,
          "success",
        );
        onDone();
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <h2 className="text-lg font-semibold">3 · Clear what&rsquo;s owed</h2>
      <p className="mt-0.5 text-sm text-secondary">
        Customers left below zero are brought back to exactly zero, so they can use their accounts
        again. Everything already recovered stays recovered.
      </p>
      {owedKobo === 0 ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-yes">
          <Check className="size-4" aria-hidden />
          Nothing owed{writtenOffKobo > 0 ? ` — ${money.format(writtenOffKobo)} written off` : ""}.
        </p>
      ) : preview ? (
        <div className="mt-3 rounded-md bg-element-2 px-3 py-3 text-sm">
          <p className="font-semibold">
            {preview.customers} customer{preview.customers === 1 ? "" : "s"} owing{" "}
            {money.format(preview.owedKobo)}{" "}
            will be set back to ₦0. This is written off and can&rsquo;t be undone.
          </p>
          <div className="mt-2 flex gap-2">
            {preview.customers > 0 && (
              <button
                type="button"
                onClick={() => go(false)}
                disabled={busy !== null}
                className="pressable h-9 rounded-sm bg-no-solid px-4 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy === "clear" ? "Clearing…" : `Clear ${money.format(preview.owedKobo)}`}
              </button>
            )}
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-secondary hover:text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => go(true)}
          disabled={busy !== null}
          className="mt-3 h-9 rounded-sm border border-border px-4 text-sm font-semibold hover:border-border-hover disabled:opacity-40"
        >
          {busy === "preview"
            ? "Checking…"
            : `Clear ${money.format(owedKobo)} owed by ${owing} customer${owing === 1 ? "" : "s"}…`}
        </button>
      )}
      {error && <p className="mt-3 text-sm font-semibold text-no">{error}</p>}
    </section>
  );
}

/* ---------- each incident ---------- */

function IncidentsCard({ incidents, money }: { incidents: RecoveryIncident[]; money: AdminMoney }) {
  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <h2 className="text-lg font-semibold">Incidents</h2>
      <p className="mt-0.5 text-sm text-secondary">Each reason you reversed bets for, newest first.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {incidents.map((i) => (
          <li key={i.reason || "unrecorded"} className="rounded-md border border-border bg-page px-3 py-2.5">
            <p className="text-sm font-semibold">{i.reason || UNRECORDED_REASON}</p>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-secondary">
              <span>{i.lastAt ? fmtDateTime(i.lastAt) : "—"}</span>
              <span>
                {i.bets} bet{i.bets === 1 ? "" : "s"} · {i.customers} customer{i.customers === 1 ? "" : "s"}
              </span>
              <span>
                Net for us{" "}
                <span className={`font-semibold ${i.netKobo > 0 ? "text-yes" : i.netKobo < 0 ? "text-no" : ""}`}>
                  {money.formatSigned(i.netKobo)}
                </span>
              </span>
              <span className={i.untoldBets > 0 ? "font-semibold text-warning" : "text-yes"}>
                {i.untoldBets > 0 ? `${i.untoldBets} bet${i.untoldBets === 1 ? "" : "s"} not emailed yet` : "everyone told"}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- who was affected ---------- */

function CustomersCard({
  report,
  money,
}: {
  report: RecoveryReport;
  money: AdminMoney;
}) {
  const [shown, setShown] = useState(CUSTOMERS_PAGE);
  const rows = report.customers;
  return (
    <section className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <h2 className="text-lg font-semibold">Customers affected</h2>
      <table className="mt-2 w-full min-w-[680px] text-left text-sm">
        <thead className="text-xs text-secondary">
          <tr className="border-b border-border">
            <th className="py-2 pr-3 font-medium">Customer</th>
            <th className="py-2 pr-3 text-right font-medium">Bets</th>
            <th className="py-2 pr-3 text-right font-medium">Taken back</th>
            <th className="py-2 pr-3 text-right font-medium">Returned</th>
            <th className="py-2 pr-3 text-right font-medium">Balance now</th>
            <th className="py-2 font-medium">Email</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, shown).map((c) => (
            <tr key={c.authUserId} className="border-b border-border last:border-0">
              <td className="py-2 pr-3">
                <p className="font-semibold">{c.username || "—"}</p>
                <p className="break-all text-xs text-secondary">{c.email}</p>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{c.bets}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {c.takenBackKobo > 0 ? money.format(c.takenBackKobo) : "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {c.returnedKobo > 0 ? money.format(c.returnedKobo) : "—"}
              </td>
              <td
                className={`whitespace-nowrap py-2 pr-3 text-right font-semibold tabular-nums ${
                  c.balanceKobo < 0 ? "text-no" : ""
                }`}
              >
                {c.balanceKobo < 0 ? `owes ${money.format(-c.balanceKobo)}` : money.format(c.balanceKobo)}
              </td>
              <td className="whitespace-nowrap py-2">
                {c.emailedAt ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-yes">
                    <Check className="size-4" aria-hidden />
                    {fmtDateTime(c.emailedAt)}
                  </span>
                ) : (
                  <span className="font-semibold text-warning">Not yet</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown < rows.length && (
        <div className="mt-2 flex items-center justify-between text-xs text-secondary">
          <span>
            Showing {shown} of {rows.length}
          </span>
          <button
            type="button"
            onClick={() => setShown(shown + CUSTOMERS_PAGE)}
            className="h-8 rounded-sm border border-border px-3 font-semibold text-primary hover:border-border-hover"
          >
            Show {Math.min(CUSTOMERS_PAGE, rows.length - shown)} more
          </button>
        </div>
      )}
    </section>
  );
}

/* ---------- small pieces ---------- */

function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="mt-1 flex rounded-md bg-element-2 p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`h-9 rounded-sm px-3 text-sm font-semibold ${
            value === o.key ? "bg-surface text-primary shadow-card" : "text-secondary hover:text-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  valueClass = "",
}: {
  label: string;
  value: string;
  note?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 shadow-card">
      <dt className="text-xs font-medium text-secondary">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${valueClass}`}>{value}</dd>
      {note && <dd className="text-[11px] leading-4 text-tertiary">{note}</dd>}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl rounded-xl border border-border bg-surface p-6 text-sm leading-6 text-secondary shadow-card">
      {children}
    </div>
  );
}

function message(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Request failed. Try again.";
}

function fmtDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
