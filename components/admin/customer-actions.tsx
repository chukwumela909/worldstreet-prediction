"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCustomerBetReview, type BetReviewRow, type TraderRow } from "@/lib/admin-api";
import type { AdminMoney } from "@/lib/admin-money";

/**
 * Everything the desk does to one customer's bets, in the opened trader:
 * their high-price bets (what the ₦90 rule flags), and taking back their
 * winnings, which opens Take action filled in with them, the one place
 * bets are reversed and the email is read, edited and sent.
 * Locking and suspending sit just above, in AccountControl.
 */

const price = (kobo: number) => `₦${(kobo / 100).toFixed(2)}`;

export function CustomerActions({ trader, money }: { trader: TraderRow; money: AdminMoney }) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      <HighPriceBets trader={trader} money={money} />
      <Link
        href={`/admin/customers/action?customer=${encodeURIComponent(trader.username)}`}
        className="inline-flex h-9 w-fit items-center rounded-sm border border-no/40 px-3 text-sm font-semibold text-no hover:bg-no-tint"
      >
        Take back winnings…
      </Link>
    </div>
  );
}

/* ---------- their ₦90+ bets ---------- */

function HighPriceBets({ trader, money }: { trader: TraderRow; money: AdminMoney }) {
  const [row, setRow] = useState<BetReviewRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCustomerBetReview(trader.authUserId)
      .then((r) => {
        if (!cancelled) setRow(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load");
      });
    return () => {
      cancelled = true;
    };
  }, [trader.authUserId]);

  return (
    <details className="rounded-md border border-border bg-surface p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        High-price bets (₦90 or more a share)
        {row && (
          <span className="font-normal text-secondary">
            {" "}
            · {row.high.bets} bet{row.high.bets === 1 ? "" : "s"}, won {row.high.won}, lost {row.high.lost}, profit{" "}
            {money.formatSigned(row.high.profitKobo)}
          </span>
        )}
      </summary>
      {error && <p className="mt-2 text-sm font-semibold text-no">{error}</p>}
      {!row && !error && <p className="mt-2 text-sm text-secondary">Loading…</p>}
      {row && (
        <>
          <p className="mt-2 text-sm text-secondary">
            Buying results that were nearly decided. {row.beforeTerms.bets} before the Terms went live on 21 Oct (
            {money.formatSigned(row.beforeTerms.profitKobo)}), {row.afterTerms.bets} after (
            {money.formatSigned(row.afterTerms.profitKobo)}). A high price alone isn&rsquo;t proof; check the times.
          </p>
          {row.markets.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-xs text-secondary">
                    <th scope="col" className="py-2 pr-3 font-medium">Market and side</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Bet times</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Bets</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Avg price</th>
                    <th scope="col" className="py-2 text-right font-medium">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {row.markets.map((m) => (
                    <tr key={`${m.title}|${m.outcome}`}>
                      <td className="py-2 pr-3">
                        {m.title}
                        <span className="block text-xs text-secondary">{m.outcome}</span>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-secondary">
                        {when(m.firstAt)}
                        {m.lastAt !== m.firstAt && <span className="block text-xs text-tertiary">to {when(m.lastAt)}</span>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{m.bets}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{price(m.avgPriceKobo)}</td>
                      <td className="py-2 text-right tabular-nums">{money.formatSigned(m.profitKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </details>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
