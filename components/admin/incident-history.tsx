"use client";

import { useState } from "react";
import {
  ArrowPathIcon as RefreshCw,
  CheckCircleIcon as Check,
  EnvelopeIcon as Mail,
} from "@heroicons/react/24/outline";
import { type AdminMoney } from "@/lib/admin-money";
import { showToast } from "@/lib/toast-store";
import {
  clearDebts,
  notifyReversals,
  type DebtClearing,
  type DebtEmail,
  type RecoveryIncident,
  type RecoveryReport,
  type ReversalNotice,
} from "@/lib/admin-api";

/**
 * Every incident so far, under Take action: what reversing bets has got
 * back (winnings taken back, stakes returned, the net, what's still owed
 * by customers left below zero), each incident on its own line, the
 * emails not sent yet (for every incident, in one press), clearing what's
 * owed, and everyone affected. Amounts follow the desk's ₦/$ switch.
 */

/** The first reversals carried no reason; this is what they were for. */
const UNRECORDED_REASON = "15-minute crypto pricing glitch (before reasons were recorded)";

/**
 * The comma-separated box: words in market titles, or a market's link —
 * a pasted link is reduced to its last path segment, the market's slug.
 */
export function parseTopics(text: string): string[] {
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
const CUSTOMERS_PAGE = 20;

export function IncidentHistory({
  report,
  loading,
  error,
  money,
  hideEmails = false,
  onRefresh,
  onChanged,
}: {
  report: RecoveryReport | null;
  loading: boolean;
  error: string | null;
  money: AdminMoney;
  /** The card above is offering the same send (Take action for everyone). */
  hideEmails?: boolean;
  onRefresh: () => void;
  /** Something here changed money or emails: re-read. */
  onChanged: () => void;
}) {
  if (!report && !error) return null;
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Every incident so far</h2>
          <p className="mt-0.5 text-sm text-secondary">
            What taking back has recovered, who was affected, and what&rsquo;s left to do.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>
      {error && !report && <p className="mt-3 text-sm font-semibold text-no">Couldn&rsquo;t load: {error}</p>}
      {report && report.totals.bets === 0 && (
        <p className="mt-3 rounded-md bg-element-2 px-3 py-3 text-sm text-secondary">No bets have been reversed yet.</p>
      )}
      {report && report.totals.bets > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
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
      {report && report.totals.notEmailed > 0 && !hideEmails && (
        <EmailStep mailConfigured={report.mailConfigured} waiting={report.totals.notEmailed} onDone={onChanged} />
      )}
      {report && (report.totals.owedKobo > 0 || report.totals.writtenOffKobo > 0) && (
        <DebtStep
          owedKobo={report.totals.owedKobo}
          owing={report.totals.owingCustomers}
          writtenOffKobo={report.totals.writtenOffKobo}
          money={money}
          onDone={onChanged}
        />
      )}
      {report && report.incidents && report.incidents.length > 0 && (
        <IncidentsCard incidents={report.incidents} money={money} />
      )}
      {report && report.customers.length > 0 && <CustomersCard report={report} money={money} />}
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
      <h3 className="text-base font-semibold">Emails not sent yet</h3>
      <p className="mt-0.5 text-sm text-secondary">
        Customers whose bets were reversed and who haven&rsquo;t been told. One email per customer
        for each incident: the reason written for it, the markets, the stakes returned and payouts
        taken back, and their new balance. Nobody is told twice.
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
  // the warm note: on by default, worded by the API, reworded here
  const [sendNote, setSendNote] = useState(true);
  const [note, setNote] = useState<DebtEmail | null>(null);

  const canEmail = preview?.mailConfigured !== false && note !== null;
  const emailing = sendNote && canEmail;
  const noteReady = !emailing || (note!.subject.trim().length >= 3 && note!.text.trim().length >= 20);

  const go = async (dryRun: boolean) => {
    setBusy(dryRun ? "preview" : "clear");
    setError(null);
    try {
      const result = await clearDebts(dryRun, !dryRun && emailing ? note! : undefined);
      if (dryRun) {
        setPreview(result);
        setNote(result.template ?? null);
      } else {
        setPreview(null);
        const people = `${result.customers} customer${result.customers === 1 ? "" : "s"}`;
        showToast(
          `Cleared ${money.formatForConfirm(result.owedKobo)} owed by ${people}${
            emailing ? ` — ${result.emailed ?? 0} emailed` : ""
          }`,
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
      <h3 className="text-base font-semibold">Clear what&rsquo;s owed</h3>
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
            {money.formatForConfirm(preview.owedKobo)}{" "}
            will be set back to ₦0. This is written off and can&rsquo;t be undone.
          </p>

          {preview.customers > 0 && (
            <div className="mt-3 rounded-md border border-border bg-surface px-3 py-3">
              <label className="flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={emailing}
                  disabled={!canEmail}
                  onChange={(e) => setSendNote(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                <Mail className="size-4 text-secondary" aria-hidden />
                Email each of them a note
              </label>
              {!canEmail ? (
                <p className="mt-1 text-xs text-warning">
                  Customer email isn&rsquo;t set up on the API (RESEND_API_KEY and a sender), so no note can go out.
                </p>
              ) : emailing ? (
                <>
                  <p className="mt-1 text-xs text-tertiary">
                    Sent only once their balance is back to ₦0. <code className="font-mono">{"{name}"}</code> and{" "}
                    <code className="font-mono">{"{amount}"}</code> (what they owed) are filled in for each customer.
                  </p>
                  <input
                    value={note!.subject}
                    onChange={(e) => setNote({ ...note!, subject: e.target.value })}
                    aria-label="Email subject"
                    maxLength={200}
                    className="mt-2 h-9 w-full rounded-md border border-border bg-page px-3 text-sm font-semibold outline-none focus:border-accent"
                  />
                  <textarea
                    value={note!.text}
                    onChange={(e) => setNote({ ...note!, text: e.target.value })}
                    aria-label="Email message"
                    rows={12}
                    maxLength={10_000}
                    className="mt-2 w-full resize-y rounded-md border border-border bg-page px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </>
              ) : null}
            </div>
          )}

          <div className="mt-3 flex gap-2">
            {preview.customers > 0 && (
              <button
                type="button"
                onClick={() => go(false)}
                disabled={busy !== null || !noteReady}
                className="pressable h-9 rounded-sm bg-no-solid px-4 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy === "clear"
                  ? "Clearing…"
                  : `Clear ${money.formatForConfirm(preview.owedKobo)}${
                      emailing ? ` and email ${preview.customers}` : ""
                    }`}
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
      <h3 className="text-base font-semibold">Incidents</h3>
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
      <h3 className="text-base font-semibold">Customers affected</h3>
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
