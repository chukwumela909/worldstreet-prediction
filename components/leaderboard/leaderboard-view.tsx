"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  ArrowDownIcon as ArrowDown,
  SignalSlashIcon as CloudOff,
  MagnifyingGlassIcon as Search,
  MagnifyingGlassMinusIcon as SearchX,
  ArrowTrendingUpIcon as TrendingUp,
  TrophyIcon as Trophy,
  UsersIcon as Users,
} from "@heroicons/react/24/outline";
import type { HeroIcon } from "@/components/icons";
import {
  avatarHue,
  fetchLeaderboard,
  type LeaderboardSort,
  type LeaderboardTrader,
  type LeaderboardWindow,
} from "@/lib/leaderboard";
import {
  formatNaira,
  formatNairaCompact,
  formatNairaSigned,
} from "@/lib/format";

const PERIODS = ["Today", "Weekly", "Monthly", "All"] as const;
type Period = (typeof PERIODS)[number];

const PERIOD_WINDOW: Record<Period, LeaderboardWindow> = {
  Today: "1d",
  Weekly: "1w",
  Monthly: "30d",
  All: "all",
};

const PERIOD_LABEL: Record<Period, string> = {
  Today: "Today",
  Weekly: "Weekly",
  Monthly: "Monthly",
  All: "All time",
};

const METRICS: { value: LeaderboardSort; label: string }[] = [
  { value: "pnl", label: "Profit/Loss" },
  { value: "vol", label: "Volume" },
];

/** Shared card language with the home board. */
const CARD = "rounded-xl border border-border bg-surface shadow-card";
const LABEL = "text-[11px] font-semibold uppercase tracking-wider text-secondary";

interface Loaded {
  key: string;
  traders: LeaderboardTrader[] | null; // null = fetch failed
}

/**
 * Leaderboard over the Local book: period tabs, name search, Profit/Loss
 * vs Volume ranking, a ranked table, and a "Top profits today" rail.
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

  // right rail: today's top profits — its own window, independent of tabs
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
    <div className="flex flex-col gap-6">
      <header className="border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Leaderboard
          </h1>
          <span className="inline-flex h-6 items-center rounded-full bg-accent/15 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-accent-ink">
            Local book
          </span>
        </div>
        <p className="mt-1 text-sm text-secondary">
          Realized profit on settled Local market positions.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="rankings-title" className={`${CARD} min-w-0 p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              id="rankings-title"
              className="flex items-center gap-2 text-[19px] font-semibold tracking-tight"
            >
              <Trophy className="size-5 text-accent-ink" aria-hidden />
              Top traders
            </h2>
            <SegmentedTabs
              label="Leaderboard period"
              options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
              value={period}
              onChange={setPeriod}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-md border border-border bg-page px-3 transition-colors focus-within:border-border-active">
              <Search className="size-4 shrink-0 text-tertiary" aria-hidden />
              <span className="sr-only">Search traders</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name"
                className="w-full min-w-0 bg-transparent text-[13.5px] font-medium text-primary outline-none placeholder:text-tertiary"
              />
            </label>
            <div className="flex items-center gap-2">
              <span className={`${LABEL} hidden sm:inline`}>Rank by</span>
              <SegmentedTabs
                label="Rank traders by"
                options={METRICS}
                value={sort}
                onChange={setSort}
              />
            </div>
          </div>

          <div className="mt-4">
            {loading ? (
              <RankingSkeleton />
            ) : failed ? (
              <EmptyState icon={CloudOff} title="Rankings are unavailable right now." />
            ) : traders!.length === 0 ? (
              <EmptyState
                icon={Users}
                title={`Nobody has ${sort === "pnl" ? "settled a position" : "staked"} in this period yet.`}
                description="Rankings fill in as Local markets resolve."
              />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title={`No traders match “${query}”.`}
              />
            ) : (
              <table className="w-full table-fixed border-collapse text-left text-[13.5px]">
                <caption className="sr-only">
                  Trader rankings, {PERIOD_LABEL[period].toLowerCase()}, by{" "}
                  {sort === "pnl" ? "profit/loss" : "volume"}
                </caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className={`${LABEL} h-10 w-12 pr-2`}>
                      #
                    </th>
                    <th scope="col" className={`${LABEL} h-10 px-2`}>
                      Trader
                    </th>
                    <MetricHeader
                      label="Profit/Loss"
                      active={sort === "pnl"}
                      onClick={() => setSort("pnl")}
                    />
                    <MetricHeader
                      label="Volume"
                      active={sort === "vol"}
                      onClick={() => setSort("vol")}
                    />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t, i) => {
                    const shown = query ? i + 1 : t.rank;
                    // a medal only where the number is the trader's real
                    // place — a filtered list renumbers from 1
                    const podium = !query && t.rank <= 3 ? t.rank : null;
                    const handle =
                      t.username.toLowerCase() !== t.displayName.toLowerCase();
                    return (
                      <tr
                        key={t.username}
                        className="h-[60px] border-b border-border last:border-0"
                      >
                        <td className="pr-2">
                          <RankBadge rank={shown} podium={podium} />
                        </td>
                        <th scope="row" className="px-2 text-left font-normal">
                          <span className="flex min-w-0 items-center gap-3">
                            <TraderAvatar trader={t} className="size-8 text-[11px]" px={32} />
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-primary">
                                {t.displayName}
                              </span>
                              {handle && (
                                <span className="block truncate text-xs text-secondary">
                                  @{t.username}
                                </span>
                              )}
                            </span>
                          </span>
                        </th>
                        <td
                          className={`w-32 pl-2 text-right tabular-nums whitespace-nowrap sm:w-36 ${
                            sort === "pnl" ? "font-semibold" : "hidden font-medium sm:table-cell"
                          } ${
                            t.profitKobo > 0
                              ? "text-yes"
                              : t.profitKobo < 0
                                ? "text-no"
                                : "text-secondary"
                          }`}
                        >
                          {formatNairaSigned(t.profitKobo)}
                        </td>
                        <td
                          className={`w-32 pl-2 text-right tabular-nums whitespace-nowrap sm:w-36 ${
                            sort === "vol"
                              ? "font-semibold text-primary"
                              : "hidden font-medium text-secondary sm:table-cell"
                          }`}
                        >
                          {formatNaira(t.volumeKobo)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <aside aria-labelledby="top-today-title" className={`${CARD} p-5`}>
          <h2
            id="top-today-title"
            className="flex items-center gap-2 border-b border-border pb-3 text-[15px] font-semibold"
          >
            <TrendingUp className="size-4 text-yes" aria-hidden />
            Top profits today
          </h2>
          {topToday === null ? (
            <div role="status" aria-busy>
              <span className="sr-only">Loading…</span>
              <ul className="animate-pulse" aria-hidden>
                {Array.from({ length: 3 }, (_, i) => (
                  <li key={i} className="flex items-center gap-3 py-3">
                    <span className="size-3 rounded-full bg-element-2" />
                    <span className="size-7 rounded-full bg-element-2" />
                    <span className="h-3 flex-1 rounded-full bg-element-2" />
                    <span className="h-3 w-12 rounded-full bg-element-2" />
                  </li>
                ))}
              </ul>
            </div>
          ) : topToday.length === 0 ? (
            <p className="py-6 text-center text-xs text-secondary">
              No profits settled today yet.
            </p>
          ) : (
            <ol>
              {topToday.map((t, i) => (
                <li
                  key={t.username}
                  className="flex items-center gap-3 border-b border-border py-3 last:border-0 last:pb-0"
                >
                  <span className="w-4 shrink-0 text-xs font-medium tabular-nums text-tertiary">
                    {i + 1}
                  </span>
                  <TraderAvatar trader={t} className="size-7 text-[10px]" px={28} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                    {t.displayName}
                  </span>
                  <strong className="text-[13.5px] font-semibold tabular-nums text-yes">
                    +{formatNairaCompact(t.profitKobo / 100)}
                  </strong>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Track-and-pill tab group, the reference's FilterTabs on our tokens. */
function SegmentedTabs<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex flex-wrap gap-0.5 rounded-md bg-page p-0.5"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`inline-flex h-8 items-center rounded-sm px-3 text-[13.5px] transition-colors duration-150 ${
              on
                ? "bg-surface font-semibold text-primary ring-1 ring-border"
                : "font-medium text-secondary hover:text-primary"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Numeric column header that doubles as the metric switch. Below `sm` only
 * the ranked metric's column is shown, so the inactive one hides there.
 */
function MetricHeader({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <th
      scope="col"
      aria-sort={active ? "descending" : undefined}
      className={`h-10 w-32 pl-2 text-right sm:w-36 ${active ? "" : "hidden sm:table-cell"}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`${LABEL} inline-flex items-center gap-1 transition-colors hover:text-primary ${
          active ? "text-primary" : ""
        }`}
      >
        <ArrowDown
          className={`size-3 ${active ? "opacity-100" : "opacity-0"}`}
          aria-hidden
        />
        {label}
      </button>
    </th>
  );
}

/** Ranks 1–3 get a filled medal; the rest sit in the same box, unfilled. */
function RankBadge({ rank, podium }: { rank: number; podium: number | null }) {
  const tone =
    podium === 1
      ? "bg-accent text-on-accent"
      : podium !== null
        ? "bg-element-3 text-primary"
        : "text-tertiary";
  return (
    <span
      className={`grid size-7 place-items-center rounded-full text-xs font-semibold tabular-nums ${tone}`}
    >
      {rank}
    </span>
  );
}

function initialsOf(trader: LeaderboardTrader): string {
  const parts = (trader.displayName || trader.username)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
        // Clerk photos go through the optimizer (img.clerk.com is in
        // remotePatterns). Anything else — the API's dicebear fallback is
        // an SVG served without an .svg suffix — can't, and next/image
        // would throw on the unlisted host, so it loads as-is.
        unoptimized={!trader.avatar.startsWith("https://img.clerk.com/")}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  // initials on a light wash of the name's hue: the hue identifies the
  // person, the neutral ink keeps the letters legible in either theme
  const hue = avatarHue(trader.username);
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-primary ${className}`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 60% 55% / 0.35), hsl(${hue + 60} 60% 45% / 0.35))`,
      }}
      aria-hidden
    >
      {initialsOf(trader)}
    </span>
  );
}

function RankingSkeleton() {
  return (
    <div aria-busy role="status">
      <span className="sr-only">Loading rankings…</span>
      <ul className="animate-pulse" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <li
            key={i}
            className="flex h-[60px] items-center gap-3 border-b border-border last:border-0"
          >
            <span className="mr-5 size-7 shrink-0 rounded-full bg-element-2" />
            <span className="size-8 shrink-0 rounded-full bg-element-2" />
            <span className="flex-1 space-y-1.5">
              <span
                className="block h-2.5 rounded-full bg-element-2"
                style={{ width: `${[52, 38, 60, 44, 34, 48][i]}%` }}
              />
              <span className="block h-2 w-20 rounded-full bg-element-2" />
            </span>
            <span className="h-2.5 w-20 rounded-full bg-element-2" />
            <span className="hidden h-2.5 w-20 rounded-full bg-element-2 sm:block" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: HeroIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="mx-auto flex max-w-[40ch] flex-col items-center py-14 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-element-2 text-tertiary">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="mt-3 text-[13.5px] font-semibold text-primary">{title}</p>
      {description && (
        <p className="mt-1 text-xs leading-5 text-secondary">{description}</p>
      )}
    </div>
  );
}
