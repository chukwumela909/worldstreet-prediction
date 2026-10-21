"use client";

import {
  ArrowPathIcon as RefreshCw,
  CheckCircleIcon as Check,
} from "@heroicons/react/24/outline";
import { formatNaira } from "@/lib/format";
import { fetchPausedRefunds, useAdminResource } from "@/lib/admin-api";

/**
 * What the paused topics have refunded over the last three days: every
 * market voided (when, by the automatic pause or by whom) and every
 * customer paid back — how much, on what, and whether they've had the
 * apology email. Read-only: the pause emails each customer as it refunds
 * them. (A desk button to email the rest once lived here; on 21 Oct it
 * told customers whose bets were reversed that they'd been refunded, so
 * it's gone — Recovery sends the emails for reversed bets.)
 */
export function PausedRefundsReport() {
  const resource = useAdminResource(fetchPausedRefunds, true);
  const report = resource.data;

  // an API without the report: nothing to show yet
  if (resource.errorCode === "NOT_FOUND") return null;

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Refunds from paused markets</h2>
          <p className="mt-0.5 text-sm text-secondary">
            Last 3 days · who was refunded, how much, and who has had the apology email.
          </p>
        </div>
        <button
          type="button"
          onClick={resource.refresh}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
        >
          <RefreshCw className={`size-3.5 ${resource.loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {!report ? (
        <p className="py-6 text-center text-sm text-secondary">
          {resource.error ? `Couldn't load: ${resource.error}` : "Loading…"}
        </p>
      ) : report.totals.bets === 0 ? (
        <p className="py-6 text-center text-sm text-secondary">
          No refunds from paused markets in the last 3 days.
        </p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Customers refunded" value={String(report.totals.customers)} />
            <Stat label="Bets refunded" value={String(report.totals.bets)} />
            <Stat label="Total refunded" value={formatNaira(report.totals.refundKobo)} />
            <Stat
              label="Apology email"
              value={`${report.totals.emailed} of ${report.totals.customers}`}
            />
          </dl>

          {!report.mailConfigured && (
            <p className="mt-3 rounded-md bg-warning-tint px-3 py-2.5 text-sm font-semibold text-warning">
              Customer email isn&rsquo;t set up on the API, so refunded customers aren&rsquo;t
              emailed. Set RESEND_API_KEY and a sender (CUSTOMER_EMAIL_FROM) in the API&rsquo;s env
              and redeploy.
            </p>
          )}


          <h3 className="mt-5 text-sm font-semibold">Customers refunded</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs text-secondary">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 pr-3 text-right font-medium">Bets</th>
                  <th className="py-2 pr-3 text-right font-medium">Refunded</th>
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 font-medium">Apology email</th>
                </tr>
              </thead>
              <tbody>
                {report.customers.map((c) => (
                  <tr key={c.authUserId} className="border-b border-border last:border-0 align-top">
                    <td className="py-2 pr-3">
                      <p className="font-semibold">{c.username || "—"}</p>
                      <p className="break-all text-xs text-secondary">{c.email || "no email on file"}</p>
                      <p className="mt-0.5 text-xs text-tertiary">{c.events.join(" · ")}</p>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.bets}</td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums">
                      {formatNaira(c.refundKobo)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-secondary">
                      {c.refundedAt ? fmtDateTime(c.refundedAt) : "—"}
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
          </div>

          <h3 className="mt-5 text-sm font-semibold">Markets voided</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs text-secondary">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Market</th>
                  <th className="py-2 pr-3 text-right font-medium">Bets</th>
                  <th className="py-2 pr-3 text-right font-medium">Refunded</th>
                  <th className="py-2 pr-3 font-medium">Voided</th>
                  <th className="py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {report.markets.map((m) => (
                  <tr key={m.marketId} className="border-b border-border last:border-0 align-top">
                    <td className="py-2 pr-3">
                      <p className="font-semibold">{m.eventTitle}</p>
                      {m.marketTitle && m.marketTitle !== m.eventTitle && (
                        <p className="text-xs text-secondary">{m.marketTitle}</p>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.bets}</td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums">
                      {formatNaira(m.refundKobo)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-secondary">
                      {m.voidedAt ? fmtDateTime(m.voidedAt) : "—"}
                    </td>
                    <td className="py-2 text-secondary">
                      {m.voidedBy === "auto" ? "Automatic pause" : m.voidedBy}
                      {m.reason && <p className="text-xs text-tertiary">{m.reason}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-element-2 px-3 py-2">
      <dt className="text-xs font-medium text-secondary">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
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
