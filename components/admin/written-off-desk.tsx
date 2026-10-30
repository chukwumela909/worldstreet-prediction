"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowPathIcon as RefreshCw } from "@heroicons/react/24/outline";
import { ApiError, isApiConfigured } from "@/lib/api-client";
import {
  fetchMoneyFlow,
  fetchWrittenOff,
  type FlowStep,
  type WrittenOffList,
  type WrittenOffRow,
} from "@/lib/admin-api";
import { useAdminMoney, type AdminMoney } from "@/lib/admin-money";
import { showToast } from "@/lib/toast-store";
import { FLAG_TONE } from "@/components/admin/risk-flags";
import { blockedNotice, when } from "@/components/admin/watch-parts";

/**
 * Written off: every customer whose debt was cleared, with the exact amount
 * from the ledger, how money moved between Predict and their dollar wallet,
 * and what they hold now (trading/written-off.ts). Opening a customer shows
 * their whole money flow, oldest first. Read-only: nothing here charges
 * anyone. We only see Predict's side of the wallet, so the page says so.
 */

const usd = (minor: number | null) => (minor === null ? "Unknown" : `$${(Math.abs(minor) / 100).toFixed(2)}`);

const STEP_LABEL: Record<FlowStep["kind"], string> = {
  added: "Added from dollar wallet",
  betting: "Betting",
  sent: "Sent to dollar wallet",
  failed: "Withdrawal failed, money came back",
  waiting: "Withdrawal waiting, not sent yet",
  reversed: "Winnings reversed",
  written_off: "Debt written off",
  other: "Other",
};

export function WrittenOffDesk() {
  const money = useAdminMoney();
  const [reloads, setReloads] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{
    key: number;
    data: WrittenOffList | null;
    error: string | null;
    errorCode: string | null;
  } | null>(null);
  const configured = isApiConfigured();

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    fetchWrittenOff()
      .then((data) => {
        if (!cancelled) setLoaded({ key: reloads, data, error: null, errorCode: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoaded({
          key: reloads,
          data: null,
          error: err instanceof Error ? err.message : "Request failed",
          errorCode: err instanceof ApiError ? err.code : null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [configured, reloads]);

  const fresh = loaded?.key === reloads ? loaded : null;
  const blocked = blockedNotice(configured, fresh?.errorCode ?? null);
  if (blocked) return blocked;
  const list = fresh?.data ?? loaded?.data ?? null;
  const rows = list?.rows ?? [];

  const copyEmails = async () => {
    const emails = rows.map((r) => r.email).filter(Boolean);
    try {
      await navigator.clipboard.writeText(emails.join("\n"));
      showToast(`${emails.length} email${emails.length === 1 ? "" : "s"} copied`, "success");
    } catch {
      showToast("Couldn't copy. Select them from the table instead.", "error");
    }
  };

  const totalSent = rows.reduce((s, r) => s + r.sentUsdMinor, 0);
  const totalNet = rows.reduce((s, r) => s + Math.max(r.netUsdMinor, 0), 0);
  const totalAtMost = rows.reduce((s, r) => s + (r.fromPredictAtMostUsdMinor ?? 0), 0);

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Written off</h1>
          <p className="mt-1 text-sm text-secondary">
            Every customer whose debt we cleared, and how their money moved between Predict and their WorldStreet
            wallet, taken directly from the money records. This page only shows information and can&rsquo;t charge anyone.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReloads((n) => n + 1)}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
        >
          <RefreshCw className={`size-3.5 ${fresh === null ? "animate-spin" : ""}`} aria-hidden />
          Refresh
        </button>
      </div>

      <p className={`mt-4 rounded-md px-3 py-2 text-sm font-semibold ${FLAG_TONE.caution.chip}`}>
        Customers in the October write-off were emailed that this debt was waived and they owe nothing.
      </p>
      <p className="mt-2 rounded-md bg-element-2 px-3 py-2 text-sm text-secondary">
        <b className="text-primary">What this can and can&rsquo;t prove:</b> we can see money leaving Predict for their
        wallet, but not what happened inside the wallet. Their dollars could have come from elsewhere, and dollars from
        Predict may already have left. Only the wallet team&rsquo;s history can show if they&rsquo;re the same money, so
        &ldquo;Could be from Predict&rdquo; is the most it could be, not proof.
      </p>

      {fresh?.error && <p className="mt-4 text-sm font-semibold text-no">Couldn&rsquo;t load: {fresh.error}</p>}
      {!list ? (
        <div className="mt-4 h-64 animate-pulse rounded-xl bg-element-2" aria-busy="true" aria-label="Loading the list" />
      ) : rows.length === 0 ? (
        <p className="mt-4 rounded-xl border border-border bg-surface py-12 text-center text-sm text-secondary shadow-card">
          No debt has been written off.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Total label="Customers" value={list.customers.toLocaleString("en-US")} />
              <Total label="Written off in all" value={money.format(list.totalKobo)} />
              <Total label="Sent from Predict to wallets" value={usd(totalSent)} />
              <Total label="Could be from Predict, at most" value={usd(totalAtMost)} />
            </dl>
            <button
              type="button"
              onClick={copyEmails}
              className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-primary hover:border-border-hover"
            >
              Copy all emails
            </button>
          </div>
          <p className="mt-2 text-xs text-tertiary">
            Across these customers, Predict sent {usd(totalNet)} more to wallets than it took from them, counting only
            customers who came out ahead. Click a customer to see their money flow.
          </p>

          <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-secondary">
                  <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Written off</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Added from wallet</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Sent to wallet</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Dollar wallet now</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Locked</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Could be from Predict</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Predict balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <Fragment key={r.authUserId}>
                    <tr>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setOpen(open === r.authUserId ? null : r.authUserId)}
                          aria-expanded={open === r.authUserId}
                          className="text-left font-semibold text-accent-ink hover:underline"
                        >
                          {open === r.authUserId ? "▾" : "▸"} {r.displayName || r.username || r.authUserId}
                        </button>
                        {r.suspendedAt && (
                          <span className={`ml-2 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${FLAG_TONE.danger.chip}`}>
                            Suspended
                          </span>
                        )}
                        <span className="block select-all text-xs text-secondary">{r.email || "No email"}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{money.format(r.writtenOffKobo)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{usd(r.addedUsdMinor)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{usd(r.sentUsdMinor)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{usd(r.walletUsdMinor)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{usd(r.walletLockedMinor)}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{usd(r.fromPredictAtMostUsdMinor)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{money.format(r.balanceKobo)}</td>
                    </tr>
                    {open === r.authUserId && (
                      <tr>
                        <td colSpan={8} className="bg-page px-4 py-4">
                          <Flow row={r} money={money} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- one customer's money flow ---------- */

function Flow({ row: r, money }: { row: WrittenOffRow; money: AdminMoney }) {
  const [steps, setSteps] = useState<FlowStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMoneyFlow(r.authUserId)
      .then((res) => {
        if (!cancelled) setSteps(res.steps);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Request failed");
      });
    return () => {
      cancelled = true;
    };
  }, [r.authUserId]);

  return (
    <div className="max-w-4xl">
      <p className="text-sm text-primary">
        <b>In plain terms:</b> {r.displayName || r.username} brought in {usd(r.addedUsdMinor)} from their wallet, and
        Predict sent {usd(r.sentUsdMinor)} back to it
        {r.netUsdMinor > 0
          ? `, so Predict gave their wallet ${usd(r.netUsdMinor)} more than it took.`
          : r.netUsdMinor < 0
            ? `, so they put in ${usd(r.netUsdMinor)} more than they took out.`
            : ", which comes out even."}{" "}
        {usd(r.sentBeforeUsdMinor)} of what was sent left before the write-off on {when(r.firstAt)}.
        {r.waitingKobo > 0 && ` Another ${money.format(r.waitingKobo)} is waiting and hasn't been sent.`}
      </p>
      <p className="mt-1 text-sm text-secondary">
        Their wallet holds {usd(r.walletUsdMinor)} now, so at most {usd(r.fromPredictAtMostUsdMinor)} of it could be from
        Predict. Written off by {r.by || "unknown"}.{" "}
        <Link href={`/admin/traders?search=${encodeURIComponent(r.username)}`} className="font-semibold text-accent-ink hover:underline">
          See every bet in Traders
        </Link>
      </p>

      {error && <p className="mt-3 text-sm font-semibold text-no">Couldn&rsquo;t load: {error}</p>}
      {!steps && !error && <div className="mt-3 h-24 animate-pulse rounded-md bg-element-2" aria-busy="true" />}
      {steps && (
        <table className="mt-3 w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-border text-xs text-secondary">
              <th scope="col" className="py-2 pr-3 font-medium">When</th>
              <th scope="col" className="py-2 pr-3 font-medium">What happened</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Predict balance change</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Dollars</th>
              <th scope="col" className="py-2 text-right font-medium">Balance after</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {steps.map((s, i) => (
              <tr key={i} className={s.kind === "sent" ? "font-semibold" : ""}>
                <td className="whitespace-nowrap py-2 pr-3 text-secondary">
                  {when(s.at)}
                  {s.until !== s.at && <span className="block text-xs text-tertiary">to {when(s.until)}</span>}
                </td>
                <td className="py-2 pr-3">
                  {STEP_LABEL[s.kind]}
                  {s.kind === "betting" && s.count > 0 && <span className="text-secondary"> ({s.count} bets)</span>}
                  {s.kind === "failed" && s.count > 1 && <span className="text-secondary"> ({s.count} tries)</span>}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{money.formatSigned(s.amountKobo)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{s.usdMinor === null ? "" : usd(s.usdMinor)}</td>
                <td className="py-2 text-right tabular-nums">{money.format(s.balanceAfterKobo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 shadow-card">
      <dt className="text-xs font-medium text-secondary">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
