"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { RotateCcw, TrendingDown, TrendingUp } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { MarketCard } from "@/components/market/market-card";
import { DepositModal } from "@/components/nav/deposit-modal";
import { positionPrice, resolveEvent } from "@/lib/market-lookup";
import { useLiveEvents } from "@/lib/use-live-events";
import type { MarketEvent } from "@/types/market";
import { EventIcon } from "@/components/market/event-icon";
import {
  resetPortfolio,
  usePortfolio,
  type Activity,
  type Position,
} from "@/lib/portfolio-store";

const TABS = ["Positions", "History", "Watchlist"] as const;
type Tab = (typeof TABS)[number];

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Signed-in portfolio dashboard: balances + Positions / History / Watchlist. */
export function PortfolioView() {
  const { user, openAuth } = useAuth();
  const portfolio = usePortfolio();
  const [tab, setTab] = useState<Tab>("Positions");
  const [depositOpen, setDepositOpen] = useState(false);

  // Every tab references events by slug; fetch the live ones once for the
  // whole page. Ordered by need — the route caps the list, so history
  // (icons only) yields to positions and watchlist (pricing and rendering).
  const slugs = useMemo(
    () => [
      ...new Set([
        ...portfolio.positions.map((p) => p.eventSlug),
        ...portfolio.watchlist,
        ...portfolio.activity
          .map((a) => a.eventSlug)
          .filter((s): s is string => Boolean(s)),
      ]),
    ],
    [portfolio.positions, portfolio.watchlist, portfolio.activity],
  );
  const { bySlug, loading } = useLiveEvents(slugs);

  const rows = useMemo(
    () =>
      portfolio.positions.map((p) => {
        const price = positionPrice(p, bySlug);
        // fall back to entry price while live prices load, so the totals
        // read as "no change yet" rather than a spurious 100% loss
        const marked = price ?? p.avgPrice;
        const value = p.shares * marked;
        const cost = p.shares * p.avgPrice;
        return { p, price, value, pnl: value - cost, cost, pending: price === null };
      }),
    [portfolio.positions, bySlug],
  );
  const positionsValue = rows.reduce((s, r) => s + r.value, 0);
  const totalPnl = rows.reduce((s, r) => s + r.pnl, 0);
  const pricesPending = loading && rows.some((r) => r.pending);

  if (!user) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-card">
        <h1 className="text-xl font-semibold">Portfolio</h1>
        <p className="mt-2 text-sm text-secondary">
          Log in to see your positions, balance, and trade history.
        </p>
        <button
          onClick={openAuth}
          className="mt-5 h-11 w-full rounded-md bg-accent text-base font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          Log In
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
          <p className="mt-1 text-sm text-secondary">{user.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDepositOpen(true)}
            className="h-9 rounded-full bg-blue-400 px-4 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Deposit
          </button>
          <button
            onClick={() => {
              if (window.confirm("Reset demo balance and clear all positions?"))
                resetPortfolio();
            }}
            className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
          >
            <RotateCcw className="size-3.5" />
            Reset demo
          </button>
        </div>
      </div>

      {/* balance cards */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Positions value"
          value={pricesPending ? "—" : usd(positionsValue)}
        />
        <StatCard label="Cash" value={usd(portfolio.cash)} />
        <StatCard
          label="Profit/Loss"
          value={
            pricesPending
              ? "—"
              : `${totalPnl >= 0 ? "+" : "−"}${usd(Math.abs(totalPnl))}`
          }
          tone={totalPnl >= 0 ? "text-yes" : "text-no"}
          icon={
            totalPnl >= 0 ? (
              <TrendingUp className="size-4 text-yes" />
            ) : (
              <TrendingDown className="size-4 text-no" />
            )
          }
        />
      </div>

      {/* tabs */}
      <div className="mt-8 flex gap-6 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 pb-2.5 text-base font-semibold transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-secondary hover:text-primary"
            }`}
          >
            {t}
            {t === "Positions" && rows.length > 0 && (
              <span className="ml-1 text-secondary">({rows.length})</span>
            )}
          </button>
        ))}
      </div>

      <div className="py-4">
        {tab === "Positions" && <Positions rows={rows} bySlug={bySlug} />}
        {tab === "History" && (
          <History activity={portfolio.activity} bySlug={bySlug} />
        )}
        {tab === "Watchlist" && (
          <Watchlist
            slugs={portfolio.watchlist}
            bySlug={bySlug}
            loading={loading}
          />
        )}
      </div>

      {depositOpen && <DepositModal onClose={() => setDepositOpen(false)} />}
    </>
  );
}

function StatCard({
  label,
  value,
  tone = "text-primary",
  icon,
}: {
  label: string;
  value: string;
  tone?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-secondary">
        {label} {icon}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

/* ---------- shared ---------- */

/**
 * Row icon for stored records (positions, activity). Positions capture an
 * emoji at trade time; prefer the event's real image once it resolves, and
 * keep the stored emoji as the fallback for events that no longer resolve.
 */
function RowIcon({
  slug,
  fallback,
  bySlug,
}: {
  slug?: string;
  fallback: string;
  bySlug: Record<string, MarketEvent>;
}) {
  const event = slug ? resolveEvent(slug, bySlug) : undefined;
  return (
    <EventIcon
      event={{ icon: fallback, iconUrl: event?.iconUrl }}
      className="size-10 rounded-md text-xl"
      px={40}
    />
  );
}

/* ---------- positions ---------- */

interface Row {
  p: Position;
  /** null while the live price is still loading */
  price: number | null;
  value: number;
  pnl: number;
  cost: number;
  pending: boolean;
}

function Positions({
  rows,
  bySlug,
}: {
  rows: Row[];
  bySlug: Record<string, MarketEvent>;
}) {
  if (rows.length === 0) {
    return (
      <Empty
        text="No open positions yet."
        cta={{ href: "/", label: "Browse markets" }}
      />
    );
  }
  return (
    <ul className="flex flex-col">
      {rows.map(({ p, price, value, pnl, cost, pending }) => (
        <li
          key={`${p.marketId}-${p.side}`}
          className="flex items-center gap-3 border-b border-border py-3.5 last:border-0"
        >
          <RowIcon slug={p.eventSlug} fallback={p.eventIcon} bySlug={bySlug} />
          <div className="min-w-0 flex-1">
            <Link
              href={`/event/${p.eventSlug}`}
              className="block truncate text-sm font-semibold hover:underline"
            >
              {p.outcomeLabel === p.eventTitle
                ? p.eventTitle
                : `${p.eventTitle} — ${p.outcomeLabel}`}
            </Link>
            <p className="mt-0.5 text-[13px] font-medium text-tertiary">
              <span className={p.side === "yes" ? "text-yes" : "text-no"}>
                {p.side === "yes" ? "Yes" : "No"}
              </span>{" "}
              · {p.shares.toFixed(1)} shares @ {(p.avgPrice * 100).toFixed(1)}¢
              {pending ? "" : ` · now ${((price ?? 0) * 100).toFixed(1)}¢`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold">
              {pending ? "—" : usd(value)}
            </p>
            {!pending && (
              <p
                className={`text-[13px] font-semibold ${pnl >= 0 ? "text-yes" : "text-no"}`}
              >
                {pnl >= 0 ? "+" : "−"}
                {usd(Math.abs(pnl))} (
                {cost > 0 ? ((pnl / cost) * 100).toFixed(1) : "0.0"}%)
              </p>
            )}
          </div>
          <Link
            href={`/event/${p.eventSlug}`}
            className="ml-2 hidden h-8 shrink-0 items-center rounded-sm bg-element-2 px-3 text-sm font-semibold text-secondary hover:bg-element-3 hover:text-primary sm:flex"
          >
            Trade
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ---------- history ---------- */

function History({
  activity,
  bySlug,
}: {
  activity: Activity[];
  bySlug: Record<string, MarketEvent>;
}) {
  if (activity.length === 0) return <Empty text="No activity yet." />;
  return (
    <ul className="flex flex-col">
      {activity.map((a) => (
        <li
          key={a.id}
          className="flex items-center gap-3 border-b border-border py-3.5 last:border-0"
        >
          {a.type === "deposit" ? (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-element-2 text-xl">
              💵
            </span>
          ) : (
            <RowIcon
              slug={a.eventSlug}
              fallback={a.eventIcon ?? "•"}
              bySlug={bySlug}
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {a.type === "deposit" ? (
                "Deposited funds"
              ) : (
                <>
                  <span className="capitalize">{a.type}</span>{" "}
                  <span className={a.side === "yes" ? "text-yes" : "text-no"}>
                    {a.side === "yes" ? "Yes" : "No"}
                  </span>{" "}
                  ·{" "}
                  <Link href={`/event/${a.eventSlug}`} className="hover:underline">
                    {a.outcomeLabel === a.eventTitle
                      ? a.eventTitle
                      : `${a.eventTitle} — ${a.outcomeLabel}`}
                  </Link>
                </>
              )}
            </p>
            <p className="mt-0.5 text-[13px] font-medium text-tertiary">
              {a.type !== "deposit" &&
                `${a.shares!.toFixed(1)} shares @ ${(a.price! * 100).toFixed(1)}¢ · `}
              {timeAgo(a.ts)}
            </p>
          </div>
          <p
            className={`text-sm font-semibold ${
              a.type === "buy" ? "text-primary" : "text-yes"
            }`}
          >
            {a.type === "buy" ? "−" : "+"}
            {usd(a.amount)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ---------- watchlist ---------- */

function Watchlist({
  slugs,
  bySlug,
  loading,
}: {
  slugs: string[];
  bySlug: Record<string, MarketEvent>;
  loading: boolean;
}) {
  const events = slugs
    .map((s) => resolveEvent(s, bySlug))
    .filter((e): e is MarketEvent => Boolean(e));
  // a saved live market resolves only once its event arrives — don't
  // flash "nothing saved" at someone who has bookmarks
  if (events.length === 0 && loading && slugs.length > 0) {
    return <div className="py-10 text-center text-sm text-secondary">Loading…</div>;
  }
  if (events.length === 0) {
    return (
      <Empty
        text="Nothing saved yet — tap the bookmark on any market."
        cta={{ href: "/", label: "Browse markets" }}
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {events.map((e) => (
        <MarketCard key={e.id} event={e} />
      ))}
    </div>
  );
}

function Empty({
  text,
  cta,
}: {
  text: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm text-secondary">{text}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-4 inline-flex h-9 items-center rounded-md bg-element-2 px-4 text-sm font-semibold text-secondary hover:bg-element-3 hover:text-primary"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
