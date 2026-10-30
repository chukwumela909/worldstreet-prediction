"use client";

import { Fragment, useEffect, useState } from "react";
import { ArrowPathIcon as RefreshCw } from "@heroicons/react/24/outline";
import { ApiError, isApiConfigured } from "@/lib/api-client";
import { fetchBetReview, type BetReview } from "@/lib/admin-api";
import { useAdminMoney } from "@/lib/admin-money";
import { FLAG_TONE } from "@/components/admin/risk-flags";
import { blockedNotice, when } from "@/components/admin/watch-parts";

/**
 * Suspended bets: for each suspended customer, how many of their bets need a
 * decision and how much money is on them, counted from all their bets
 * (trading/bet-review.ts). Opening a customer lists the markets with the
 * exact times. Read-only: nothing here changes a balance. A high price alone
 * isn't proof, and the page says so.
 */

const price = (kobo: number) => `₦${(kobo / 100).toFixed(2)}`;

export function BetReviewDesk() {
  const money = useAdminMoney();
  const [reloads, setReloads] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{
    key: number;
    data: BetReview | null;
    error: string | null;
    errorCode: string | null;
  } | null>(null);
  const configured = isApiConfigured();

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    fetchBetReview()
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
  const review = fresh?.data ?? loaded?.data ?? null;
  const rows = review?.rows ?? [];

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Suspended bets</h1>
          <p className="mt-1 text-sm text-secondary">
            For each suspended customer: how many of their settled bets were at ₦90 or more a share, buying a result
            that was all but decided, and how much money is on them. This counts all their bets and can&rsquo;t change
            any balance.
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
        These are the bets to review, not proof. A high price alone doesn&rsquo;t show the Terms were broken, and bets
        before 21 October came before the Terms went live. Get legal&rsquo;s view before taking any of this money.
      </p>

      {fresh?.error && <p className="mt-4 text-sm font-semibold text-no">Couldn&rsquo;t load: {fresh.error}</p>}
      {!review ? (
        <div className="mt-4 h-64 animate-pulse rounded-xl bg-element-2" aria-busy="true" aria-label="Counting the bets" />
      ) : rows.length === 0 ? (
        <p className="mt-4 rounded-xl border border-border bg-surface py-12 text-center text-sm text-secondary shadow-card">
          No customer is suspended.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-secondary">
                <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">₦90+ bets</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Won / lost</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Staked on them</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Profit on them</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Before 21 Oct</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">From 21 Oct</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Balance now</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Balance covers</th>
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
                        {open === r.authUserId ? "▾" : "▸"} {r.displayName || r.username}
                      </button>
                      <span className="block select-all text-xs text-secondary">{r.email}</span>
                      <span className="block text-xs text-tertiary">{r.allBets.toLocaleString("en-US")} bets in all</span>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{r.high.bets.toLocaleString("en-US")}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {r.high.won} / {r.high.lost}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{money.format(r.high.stakedKobo)}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{money.formatSigned(r.high.profitKobo)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {r.beforeTerms.bets}
                      <span className="block text-xs text-tertiary">{money.formatSigned(r.beforeTerms.profitKobo)}</span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {r.afterTerms.bets}
                      <span className="block text-xs text-tertiary">{money.formatSigned(r.afterTerms.profitKobo)}</span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{money.format(r.balanceKobo)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money.format(r.balanceCoversKobo)}</td>
                  </tr>
                  {open === r.authUserId && (
                    <tr>
                      <td colSpan={9} className="bg-page px-4 py-4">
                        <p className="text-sm text-primary">
                          {r.highReversed} more ₦90+ bets were already reversed and {r.highRefunded} were refunded, so
                          they aren&rsquo;t counted in the money above.
                        </p>
                        {r.markets.length === 0 ? (
                          <p className="mt-2 text-sm text-secondary">No settled bets at ₦90 or more.</p>
                        ) : (
                          <table className="mt-3 w-full text-left text-[13px]">
                            <thead>
                              <tr className="border-b border-border text-xs text-secondary">
                                <th scope="col" className="py-2 pr-3 font-medium">Market and side</th>
                                <th scope="col" className="py-2 pr-3 font-medium">Exact bet times</th>
                                <th scope="col" className="py-2 pr-3 text-right font-medium">Bets</th>
                                <th scope="col" className="py-2 pr-3 text-right font-medium">Avg price</th>
                                <th scope="col" className="py-2 pr-3 text-right font-medium">Staked</th>
                                <th scope="col" className="py-2 text-right font-medium">Profit</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {r.markets.map((m) => (
                                <tr key={`${m.title}|${m.outcome}`}>
                                  <td className="py-2 pr-3">
                                    {m.title}
                                    <span className="block text-xs text-secondary">{m.outcome}</span>
                                  </td>
                                  <td className="whitespace-nowrap py-2 pr-3 text-secondary">
                                    {when(m.firstAt)}
                                    {m.lastAt !== m.firstAt && <span className="block text-xs text-tertiary">to {when(m.lastAt)}</span>}
                                  </td>
                                  <td className="py-2 pr-3 text-right tabular-nums">
                                    {m.bets}
                                    {m.lost > 0 && <span className="block text-xs text-tertiary">{m.lost} lost</span>}
                                  </td>
                                  <td className="py-2 pr-3 text-right tabular-nums">{price(m.avgPriceKobo)}</td>
                                  <td className="py-2 pr-3 text-right tabular-nums">{money.format(m.stakedKobo)}</td>
                                  <td className="py-2 text-right tabular-nums">{money.formatSigned(m.profitKobo)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
