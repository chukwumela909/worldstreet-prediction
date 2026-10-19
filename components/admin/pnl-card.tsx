"use client";

import { useState } from "react";
import { formatNaira, formatNairaSigned } from "@/lib/format";
import { fetchProfitAndLoss, useAdminResource, type PnlWindow } from "@/lib/admin-api";
import { Stat } from "@/components/admin/book-risk";

/**
 * Profit / loss so far — the other half of the risk strip above it.
 *
 * The strip is about open bets: what COULD be owed. This is what HAS
 * happened on finished markets: stakes kept on losing bets minus what
 * winners were paid (refunds on voided markets move nothing). Read from
 * GET /v1/admin/pnl (services/api/src/trading/pnl.ts); admins only.
 *
 * Like the strip, it reads its own endpoint — `reloadKey` is the desk
 * saying it changed something (a settlement) worth re-reading for.
 */

const WINDOWS = [
  { key: "last7Days", label: "7 days" },
  { key: "last30Days", label: "30 days" },
  { key: "allTime", label: "All time" },
] as const;
type WindowKey = (typeof WINDOWS)[number]["key"];

export function PnlCard({ reloadKey = 0 }: { reloadKey?: number }) {
  const pnl = useAdminResource(fetchProfitAndLoss, true, reloadKey);
  const [windowKey, setWindowKey] = useState<WindowKey>("allTime");

  // a non-admin (403) is already explained by the desk; an older API
  // without the endpoint simply shows no card
  if (pnl.errorCode === "FORBIDDEN" || (!pnl.data && !pnl.loading)) return null;
  if (!pnl.data) {
    return (
      <section className="mt-6 h-[132px] animate-pulse rounded-xl border border-border bg-surface" />
    );
  }

  const w: PnlWindow = pnl.data[windowKey];
  const tone = (kobo: number) => (kobo < 0 ? "text-no" : kobo > 0 ? "text-yes" : "");
  const winLabel = WINDOWS.find((x) => x.key === windowKey)!.label.toLowerCase();

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Profit / loss so far</h2>
          <p className="mt-0.5 text-[13px] text-secondary">
            Finished markets only — what we kept minus what we paid out.
          </p>
        </div>
        <div role="group" aria-label="Period" className="flex rounded-md bg-element-2 p-0.5">
          {WINDOWS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              aria-pressed={windowKey === opt.key}
              onClick={() => setWindowKey(opt.key)}
              className={`h-8 rounded-sm px-3 text-xs font-semibold transition-colors ${
                windowKey === opt.key
                  ? "bg-surface text-primary shadow-card"
                  : "text-secondary hover:text-primary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {w.positions === 0 ? (
        <p className="mt-4 rounded-md border border-border bg-page px-3 py-3 text-sm text-secondary">
          No markets finished {windowKey === "allTime" ? "yet" : `in the last ${winLabel}`}.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label={w.profitKobo < 0 ? "Loss" : "Profit"}
            value={formatNairaSigned(w.profitKobo)}
            valueClass={tone(w.profitKobo)}
            note={`${w.markets} finished market${w.markets === 1 ? "" : "s"}, ${w.positions} bet${w.positions === 1 ? "" : "s"}`}
          />
          <Stat
            label="Money in"
            value={formatNaira(w.stakesKobo)}
            note={`Paid out to winners ${formatNaira(w.payoutsKobo)}`}
          />
          <Stat
            label="By book"
            value={`Local ${formatNairaSigned(w.local.profitKobo)}`}
            valueClass={tone(w.local.profitKobo)}
            note={`International ${formatNairaSigned(w.international.profitKobo)}${
              w.refundsKobo > 0 ? ` · refunded ${formatNaira(w.refundsKobo)}` : ""
            }`}
          />
        </div>
      )}
    </section>
  );
}
