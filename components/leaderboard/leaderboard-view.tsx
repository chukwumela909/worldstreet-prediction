"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Search } from "lucide-react";
import {
  avatarHue,
  fetchLeaderboard,
  type LeaderboardSort,
  type LeaderboardTrader,
  type LeaderboardWindow,
} from "@/lib/leaderboard";
import { formatNaira, formatNairaCompact } from "@/lib/format";

const PERIODS = ["Today", "Weekly", "Monthly", "All"] as const;
type Period = (typeof PERIODS)[number];

const PERIOD_WINDOW: Record<Period, LeaderboardWindow> = {
  Today: "1d",
  Weekly: "1w",
  Monthly: "30d",
  All: "all",
};

/** "+₩12,500" / "−₩900" — formatNaira has no sign of its own. */
const signed = (kobo: number) =>
  `${kobo >= 0 ? "+" : "−"}${formatNaira(Math.abs(kobo))}`;

interface Loaded {
  key: string;
  traders: LeaderboardTrader[] | null; // null = fetch failed
}

/**
 * Leaderboard over the Local book: period pills, name search, Profit/Loss
 * vs Volume sort, ranked rows, and a "Top profits today" rail.
 *
 * Every row is one of this platform's own traders, ranked on realized
 * credit P&L from settled positions. An empty board is a real and
 * expected answer while the book is young — it is reported as such rather
 * than papered over, which is the whole reason this page no longer
 * mirrors Polymarket's rankings.
 */
export function LeaderboardView() {
  const [period, setPeriod] = useState<Period>("Monthly");
  const [sort, setSort] = useState<LeaderboardSort>("pnl");
  const [query, setQuery] = useState("");

  const key = `${PERIOD_WINDOW[period]}|${sort}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLeaderboard(PERIOD_WINDOW[period], sort)
      .then((traders) => {
        if (!cancelled) setLoaded({ key, traders });
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
    return traders.filter(
      (t) =>
        t.displayName.toLowerCase().includes(q) ||
        t.username.toLowerCase().includes(q),
    );
  }, [traders, query]);

  // right rail: today's top profits — its own window, independent of pills
  const [topToday, setTopToday] = useState<LeaderboardTrader[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchLeaderboard("1d", "pnl", 7)
      .then((t) => {
        if (!cancelled) setTopToday(t.filter((x) => x.profitKobo > 0));
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
        <p className="mt-1 text-sm text-secondary">
          Realized profit on settled Local market positions.
        </p>

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
            Loading rankings…
          </p>
        ) : failed ? (
          <p className="py-10 text-center text-sm text-secondary">
            Rankings are unavailable right now.
          </p>
        ) : traders!.length === 0 ? (
          <p className="py-10 text-center text-sm leading-6 text-secondary">
            Nobody has {sort === "pnl" ? "settled a position" : "staked"} in this
            period yet.
            <br />
            Rankings fill in as Local markets resolve.
          </p>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-secondary">
            No traders match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ol>
            {rows.map((t, i) => (
              <li
                key={t.username}
                className="flex items-center gap-4 border-b border-border py-4 last:border-0"
              >
                <span className="w-5 shrink-0 text-sm font-medium text-tertiary">
                  {query ? i + 1 : t.rank}
                </span>
                <TraderAvatar trader={t} className="size-10" px={40} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                  {t.displayName}
                </span>
                <span
                  className={`w-28 shrink-0 text-right text-sm font-semibold sm:w-32 ${
                    t.profitKobo < 0
                      ? "text-no"
                      : sort === "pnl"
                        ? "text-primary"
                        : "text-secondary"
                  }`}
                >
                  {signed(t.profitKobo)}
                </span>
                <span className="hidden w-32 shrink-0 text-right text-sm font-medium text-secondary sm:block">
                  {formatNaira(t.volumeKobo)}
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
              No profits settled today yet.
            </p>
          ) : (
            <ol className="mt-3">
              {topToday.map((t, i) => (
                <li
                  key={t.username}
                  className="flex items-center gap-3 border-b border-border py-3.5 last:border-0 last:pb-0"
                >
                  <span className="w-4 shrink-0 text-xs font-medium text-tertiary">
                    {i + 1}
                  </span>
                  <TraderAvatar trader={t} className="size-8" px={32} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {t.displayName}
                  </span>
                  <span className="text-sm font-semibold text-yes">
                    +{formatNairaCompact(t.profitKobo / 100)}
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
  if (trader.avatar) {
    return (
      <Image
        src={trader.avatar}
        alt=""
        width={px}
        height={px}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  const hue = avatarHue(trader.username);
  return (
    <span
      className={`shrink-0 rounded-full ${className}`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 60% 55%), hsl(${hue + 60} 60% 45%))`,
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
