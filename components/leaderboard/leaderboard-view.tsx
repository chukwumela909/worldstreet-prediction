"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  avatarGradient,
  LEADERBOARD_PERIODS,
  MOCK_BIG_WINS,
  MOCK_TRADERS,
  type LeaderboardPeriod,
} from "@/lib/mock-leaderboard";

type SortKey = "profit" | "volume";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Leaderboard — modeled on polymarket.com/leaderboard: period pills,
 * name search, Profit/Loss vs Volume sort, ranked rows with gradient
 * avatars, and a "Biggest wins this month" right rail.
 */
export function LeaderboardView() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("Monthly");
  const [sort, setSort] = useState<SortKey>("profit");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MOCK_TRADERS.filter((t) => t.name.toLowerCase().includes(q)).sort(
      (a, b) => b[sort][period] - a[sort][period],
    );
  }, [period, sort, query]);

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <section className="min-w-0 flex-1">
        <h1 className="text-[32px] font-semibold tracking-tight">Leaderboard</h1>

        {/* period pills */}
        <div className="mt-5 inline-flex rounded-md border border-border p-0.5">
          {LEADERBOARD_PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`h-9 rounded-[7.2px] px-4 text-sm font-semibold transition-colors ${
                period === p
                  ? "bg-element-2 text-primary"
                  : "text-secondary hover:text-primary"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* search + column headers */}
        <div className="mt-4 flex items-center gap-4 border-b border-border pb-0">
          <div className="flex min-w-0 flex-1 items-center gap-2 pb-3">
            <Search className="size-4 shrink-0 text-secondary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name"
              className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-tertiary"
            />
          </div>
          <ColumnHeader
            label="Profit/Loss"
            active={sort === "profit"}
            onClick={() => setSort("profit")}
          />
          <ColumnHeader
            label="Volume"
            active={sort === "volume"}
            onClick={() => setSort("volume")}
          />
        </div>

        {/* ranked rows */}
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-secondary">
            No traders match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ol>
            {rows.map((t, i) => (
              <li
                key={t.name}
                className="flex items-center gap-4 border-b border-border py-4 last:border-0"
              >
                <span className="w-5 shrink-0 text-sm font-medium text-tertiary">
                  {i + 1}
                </span>
                <span
                  className="size-10 shrink-0 rounded-full"
                  style={{ background: avatarGradient(t.name) }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                  {t.name}
                </span>
                <span
                  className={`w-28 shrink-0 text-right text-sm font-semibold sm:w-32 ${
                    sort === "profit" ? "text-primary" : "text-secondary"
                  }`}
                >
                  +{usd(t.profit[period])}
                </span>
                <span className="hidden w-32 shrink-0 text-right text-sm font-medium text-secondary sm:block">
                  {usd(t.volume[period])}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* biggest wins rail */}
      <aside className="w-full lg:w-[380px] lg:shrink-0">
        <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold">Biggest wins this month</h2>
          <ol className="mt-3">
            {MOCK_BIG_WINS.map((w, i) => (
              <li
                key={`${w.trader}-${w.market}`}
                className="flex items-start gap-3 border-b border-border py-3.5 last:border-0 last:pb-0"
              >
                <span className="w-4 shrink-0 pt-2 text-xs font-medium text-tertiary">
                  {i + 1}
                </span>
                <span
                  className="mt-0.5 size-8 shrink-0 rounded-full"
                  style={{ background: avatarGradient(w.trader) }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    <span className="font-semibold">{w.trader}</span>
                    <span className="text-tertiary"> | </span>
                    <span className="text-secondary">{w.market}</span>
                  </p>
                  <p className="mt-0.5 text-[13px] font-medium">
                    <span className="text-secondary">{usd(w.stake)}</span>
                    <span className="text-tertiary"> → </span>
                    <span className="text-yes">{usd(w.payout)}</span>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}

function ColumnHeader({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 border-b-2 pb-3 text-sm font-semibold transition-colors ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-secondary hover:text-primary"
      }`}
    >
      {label}
    </button>
  );
}
