"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowPathIcon as RefreshCw } from "@heroicons/react/24/outline";
import { ApiError, isApiConfigured } from "@/lib/api-client";
import { fetchWrittenOff, type WrittenOffList } from "@/lib/admin-api";
import { useAdminMoney } from "@/lib/admin-money";
import { showToast } from "@/lib/toast-store";
import { FLAG_TONE } from "@/components/admin/risk-flags";
import { blockedNotice, when } from "@/components/admin/watch-parts";

/**
 * Written off: every customer whose debt was cleared, with the exact amount
 * from the ledger, and what they hold now on Predict and in their dollar
 * wallet (trading/written-off.ts). Read-only: nothing here charges anyone.
 */

const usd = (minor: number | null) => (minor === null ? "Unknown" : `$${(minor / 100).toFixed(2)}`);

export function WrittenOffDesk() {
  const money = useAdminMoney();
  const [reloads, setReloads] = useState(0);
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

  const copyEmails = async () => {
    const emails = (list?.rows ?? []).map((r) => r.email).filter(Boolean);
    try {
      await navigator.clipboard.writeText(emails.join("\n"));
      showToast(`${emails.length} email${emails.length === 1 ? "" : "s"} copied`, "success");
    } catch {
      showToast("Couldn't copy. Select them from the table instead.", "error");
    }
  };

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Written off</h1>
          <p className="mt-1 text-sm text-secondary">
            Every customer whose debt we cleared, taken directly from the money records. This page only shows
            information and can&rsquo;t charge anyone.
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

      {fresh?.error && <p className="mt-4 text-sm font-semibold text-no">Couldn&rsquo;t load: {fresh.error}</p>}
      {!list ? (
        <div className="mt-4 h-64 animate-pulse rounded-xl bg-element-2" aria-busy="true" aria-label="Loading the list" />
      ) : list.rows.length === 0 ? (
        <p className="mt-4 rounded-xl border border-border bg-surface py-12 text-center text-sm text-secondary shadow-card">
          No debt has been written off.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <dl className="grid grid-cols-2 gap-2">
              <Total label="Customers" value={list.customers.toLocaleString("en-US")} />
              <Total label="Written off in all" value={money.format(list.totalKobo)} />
            </dl>
            <button
              type="button"
              onClick={copyEmails}
              className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-primary hover:border-border-hover"
            >
              Copy all emails
            </button>
          </div>

          <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-secondary">
                  <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Written off</th>
                  <th scope="col" className="px-4 py-3 font-medium">When</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Predict balance now</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Dollar wallet now</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Locked dollars</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.rows.map((r) => (
                  <tr key={r.authUserId}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/traders?search=${encodeURIComponent(r.username)}`}
                        className="font-semibold hover:underline"
                      >
                        {r.displayName || r.username || r.authUserId}
                      </Link>
                      {r.suspendedAt && (
                        <span className={`ml-2 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${FLAG_TONE.danger.chip}`}>
                          Suspended
                        </span>
                      )}
                      <span className="block text-xs text-tertiary">@{r.username}</span>
                      <span className="block select-all text-xs text-secondary">{r.email || "No email"}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {money.format(r.writtenOffKobo)}
                      {r.times > 1 && <span className="block text-xs font-normal text-tertiary">{r.times} times</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-secondary">
                      {when(r.lastAt)}
                      {r.by && <span className="block text-tertiary">by {r.by}</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{money.format(r.balanceKobo)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{usd(r.walletUsdMinor)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{usd(r.walletLockedMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
