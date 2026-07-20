"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Search } from "lucide-react";
import type { LeaderboardTrader, LeaderboardWindow } from "@/lib/polymarket";
import { formatUsdCompact } from "@/lib/format";

const PERIODS = ["Today", "Weekly", "Monthly", "All"] as const;
type Period = (typeof PERIODS)[number];

const PERIOD_WINDOW: Record<Period, LeaderboardWindow> = {
  Today: "1d",
  Weekly: "1w",
  Monthly: "30d",
  All: "all",
};

type SortKey = "pnl" | "vol";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

interface Loaded {
  key: string;
  traders: LeaderboardTrader[] | null; // null = fetch failed
}

/**
 * Leaderboard — modeled on polymarket.com/leaderboard: period pills,
 * name search, Profit/Loss vs Volume sort, ranked rows, and a "Top
 * profits today" right rail. All rows are live Polymarket rankings
 * (data-api /v1/leaderboard); there is no mock fallback.
 */
export function LeaderboardView() {
  const [period, setPeriod] = useState<Period>("Monthly");
  const [sort, setSort] = useState<SortKey>("pnl");
  const [query, setQuery] = useState("");

  const key = `${PERIOD_WINDOW[period]}|${sort}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/leaderboard?window=${PERIOD_WINDOW[period]}&sort=${sort}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((body: { traders?: LeaderboardTrader[] }) => {
        if (!cancelled) setLoaded({ key, traders: body.traders ?? [] });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, traders: null });
      });
    return () => {
      cancelled = true;
    };
    // key encodes period+sort
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const fresh = loaded?.key === key ? loaded : null;
  const traders = fresh?.traders ?? null;
  const loading = fresh === null;
  const failed = fresh !== null && fresh.traders === null;

  const rows = useMemo(() => {
    if (!traders) return [];
    const q = query.trim().toLowerCase();
    return traders.filter((t) => t.name.toLowerCase().includes(q));
  }, [traders, query]);

  // right rail: today's top profits — its own window, independent of pills
  const [topToday, setTopToday] = useState<LeaderboardTrader[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/leaderboard?window=1d&sort=pnl`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((body: { traders?: LeaderboardTrader[] }) => {
        if (!cancelled) setTopToday((body.traders ?? []).slice(0, 7));
      })
      .catch(() => {
        if (!cancelled) setTopToday([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <section className="min-w-0 flex-1">
        <h1 className="text-[32px] font-semibold tracking-tight">Leaderboard</h1>

        {/* period pills */}
        <div className="mt-5 inline-flex rounded-md border border-border p-0.5">
          {PERIODS.map((p) => (
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
            active={sort === "pnl"}
            onClick={() => setSort("pnl")}
          />
          <ColumnHeader
            label="Volume"
            active={sort === "vol"}
            onClick={() => setSort("vol")}
          />
        </div>

        {/* ranked rows */}
        {loading ? (
          <p className="py-10 text-center text-sm text-secondary">
            Loading live rankings…
          </p>
        ) : failed ? (
          <p className="py-10 text-center text-sm text-secondary">
            Live rankings are unavailable right now.
          </p>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-secondary">
            No traders match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ol>
            {rows.map((t, i) => (
              <li
                key={`${t.rank}-${t.name}`}
                className="flex items-center gap-4 border-b border-border py-4 last:border-0"
              >
                <span className="w-5 shrink-0 text-sm font-medium text-tertiary">
                  {query ? i + 1 : t.rank}
                </span>
                <TraderAvatar trader={t} className="size-10" px={40} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                  {t.name}
                </span>
                <span
                  className={`w-28 shrink-0 text-right text-sm font-semibold sm:w-32 ${
                    sort === "pnl" ? "text-primary" : "text-secondary"
                  } ${t.profit < 0 ? "text-no" : ""}`}
                >
                  {t.profit >= 0 ? "+" : "−"}
                  {usd(Math.abs(t.profit))}
                </span>
                <span className="hidden w-32 shrink-0 text-right text-sm font-medium text-secondary sm:block">
                  {usd(t.volume)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* top profits rail */}
      <aside className="w-full lg:w-[380px] lg:shrink-0">
        <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold">Top profits today</h2>
          {topToday === null ? (
            <p className="py-6 text-center text-sm text-secondary">Loading…</p>
          ) : topToday.length === 0 ? (
            <p className="py-6 text-center text-sm text-secondary">
              Unavailable right now.
            </p>
          ) : (
            <ol className="mt-3">
              {topToday.map((t, i) => (
                <li
                  key={`${t.rank}-${t.name}`}
                  className="flex items-center gap-3 border-b border-border py-3.5 last:border-0 last:pb-0"
                >
                  <span className="w-4 shrink-0 text-xs font-medium text-tertiary">
                    {i + 1}
                  </span>
                  <TraderAvatar trader={t} className="size-8" px={32} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {t.name}
                  </span>
                  <span className="text-sm font-semibold text-yes">
                    +{formatUsdCompact(t.profit)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}

function TraderAvatar({
  trader,
  className,
  px,
}: {
  trader: LeaderboardTrader;
  className: string;
  px: number;
}) {
  if (trader.avatarUrl) {
    return (
      <Image
        src={trader.avatarUrl}
        alt=""
        width={px}
        height={px}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <span
      className={`shrink-0 rounded-full ${className}`}
      style={{
        background: `linear-gradient(135deg, hsl(${trader.hue} 60% 55%), hsl(${trader.hue + 60} 60% 45%))`,
      }}
      aria-hidden
    />
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
