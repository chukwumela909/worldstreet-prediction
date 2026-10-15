"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUpRightIcon as ArrowUpRight,
  BookmarkIcon as Bookmark,
  ArrowPathIcon as LoaderCircle,
  ArrowRightEndOnRectangleIcon as LogIn,
  WalletIcon as Wallet,
} from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/auth-context";
import { MarketCard } from "@/components/market/market-card";
import {
  OpenPositions,
  SettledPositions,
  StaleBookNotice,
  splitLocalBook,
} from "@/components/portfolio/local-positions";
import {
  CARD,
  EmptyState,
  LABEL,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from "@/components/portfolio/portfolio-ui";
import { FundNairaModal } from "@/components/local/fund-naira-modal";
import { resolveEvent } from "@/lib/market-lookup";
import { useLiveEvents } from "@/lib/use-live-events";
import { useWatchlist } from "@/lib/watchlist-store";
import { useWalletBalance } from "@/lib/use-wallet-balance";
import { useNairaWallet } from "@/lib/naira-wallet";
import { useLocalPortfolio } from "@/lib/local-trades";
import { formatNaira } from "@/lib/format";
import type { MarketEvent } from "@/types/market";

/**
 * Signed-in portfolio: the two balances that actually exist and the
 * positions they bought. Both come from the API — dollars from the
 * central WorldStreet wallet, naira from this platform's own ledger.
 *
 * There is deliberately no dollar positions tab. Polymarket-fed markets
 * are mirrored for display only; the sole tradeable book is Local, and
 * the positions that used to sit here were localStorage demo fiction
 * shown beside a real wallet balance.
 */
export type PortfolioTab = "open" | "settled" | "watchlist";

const TABS: { value: PortfolioTab; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "settled", label: "Settled" },
  { value: "watchlist", label: "Watchlist" },
];

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PortfolioView({
  initialTab = null,
}: {
  /** From `?tab=` — e.g. the home sidebar's "View saved markets". */
  initialTab?: PortfolioTab | null;
}) {
  const { user, openAuth } = useAuth();
  // null until someone picks a tab: the landing section depends on the book
  const [chosen, setChosen] = useState<PortfolioTab | null>(initialTab);
  const [funding, setFunding] = useState(false);

  const signedIn = Boolean(user);
  const usdBalance = useWalletBalance(signedIn);
  const { balanceKobo } = useNairaWallet(signedIn);
  const { positions, loading, error } = useLocalPortfolio(signedIn);
  const saved = useWatchlist();

  if (!user) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader subtitle="Your balances, open stakes and settled receipts." />
        <EmptyState
          icon={Wallet}
          tone="text-accent-ink"
          title="Log in to see your portfolio"
          actions={
            <>
              <button type="button" onClick={openAuth} className={PRIMARY_BUTTON}>
                <LogIn className="size-4" aria-hidden="true" />
                Log In
              </button>
              <Link href="/" className={SECONDARY_BUTTON}>
                Browse markets
              </Link>
            </>
          }
        >
          Your dollar wallet, credit balance and every Local position you
          hold show up here once you&apos;re signed in to WorldStreet.
        </EmptyState>
      </div>
    );
  }

  const book = splitLocalBook(positions);
  // with nothing loaded, a failed or pending load is not "₩0 staked"
  const bookKnown = positions.length > 0 || (!loading && !error);

  // someone whose bets have all resolved lands on Settled — show them the
  // book they actually have — but a tab they pick is the tab they get
  const active: PortfolioTab =
    chosen ??
    (book.open.length === 0 && book.settled.length > 0 ? "settled" : "open");

  const counts: Record<PortfolioTab, number | null> = {
    open: bookKnown ? book.open.length : null,
    settled: bookKnown ? book.settled.length : null,
    watchlist: new Set(saved).size,
  };

  // only an empty book shows the load state itself; once rows exist, a
  // failed refresh keeps them on screen under a notice
  const unloaded = {
    loading: loading && positions.length === 0,
    error: positions.length === 0 ? error : null,
  };

  return (
    <>
      <div className="flex flex-col gap-8">
        <PageHeader
          subtitle={
            <>
              Balances, open stakes and settled receipts for{" "}
              <span className="font-medium text-primary">{user.name}</span>.
            </>
          }
          action={
            <button
              type="button"
              onClick={() => setFunding(true)}
              className={PRIMARY_BUTTON}
            >
              <Wallet className="size-4" aria-hidden="true" />
              Manage credit
            </button>
          }
        />

        <section
          aria-label="Summary"
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          <StatTile
            label="Dollar wallet"
            value={usdBalance === null ? "—" : usd(usdBalance)}
            note="Shared across WorldStreet — funds your credit balance."
          />
          <StatTile
            label="Credit balance"
            value={balanceKobo === null ? "—" : formatNaira(balanceKobo)}
            note="What Local markets trade with."
          />
          <StatTile
            label="Open stakes"
            value={bookKnown ? formatNaira(book.stakedKobo) : "—"}
            note={
              !bookKnown
                ? "Held until each market settles."
                : book.open.length === 0
                  ? "No open positions."
                  : `Across ${book.open.length} open position${book.open.length === 1 ? "" : "s"}.`
            }
          />
          <StatTile
            label="Pays if all win"
            value={bookKnown ? formatNaira(book.potentialKobo) : "—"}
            tone="text-yes"
            note="Credited to your balance as each market settles."
          />
        </section>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="group"
              aria-label="Portfolio section"
              className="inline-flex gap-0.5 rounded-md border border-border bg-surface p-0.5"
            >
              {TABS.map((t) => {
                const on = active === t.value;
                const count = counts[t.value];
                return (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setChosen(t.value)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-[13px] font-semibold transition-colors ${
                      on
                        ? "bg-element-3 text-primary"
                        : "text-secondary hover:text-primary"
                    }`}
                  >
                    {t.label}
                    {count !== null && (
                      <span
                        className={`tabular-nums ${on ? "text-secondary" : "text-tertiary"}`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {/* an empty section carries its own browse button */}
            {counts[active] ? (
              <Link
                href={active === "watchlist" ? "/" : "/?category=local"}
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-secondary transition-colors hover:text-primary"
              >
                {active === "watchlist" ? "Browse markets" : "Browse Local markets"}
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Link>
            ) : null}
          </div>

          {active !== "watchlist" && error && positions.length > 0 && (
            <StaleBookNotice message={error} />
          )}

          {active === "open" && (
            <OpenPositions
              positions={book.open}
              hasSettled={book.settled.length > 0}
              {...unloaded}
            />
          )}
          {active === "settled" && (
            <SettledPositions positions={book.settled} {...unloaded} />
          )}
          {active === "watchlist" && <Watchlist />}
        </div>
      </div>

      <FundNairaModal open={funding} onClose={() => setFunding(false)} />
    </>
  );
}

function PageHeader({
  subtitle,
  action,
}: {
  subtitle: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
          Portfolio
        </h1>
        <p className="mt-1 text-[13.5px] text-secondary">{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

function StatTile({
  label,
  value,
  note,
  tone = "text-primary",
}: {
  label: string;
  value: string;
  note: string;
  tone?: string;
}) {
  return (
    <div className={`${CARD} p-4 sm:p-5`}>
      <p className={LABEL}>{label}</p>
      <p
        className={`mt-2 truncate text-xl font-semibold tabular-nums tracking-tight sm:text-2xl ${tone}`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-secondary">{note}</p>
    </div>
  );
}

/* ---------- watchlist ---------- */

function Watchlist() {
  const slugs = useWatchlist();
  // memoised so the fetch keys off content, not array identity
  const wanted = useMemo(() => [...new Set(slugs)], [slugs]);
  const { bySlug, loading } = useLiveEvents(wanted);

  const events = wanted
    .map((s) => resolveEvent(s, bySlug))
    .filter((e): e is MarketEvent => Boolean(e));

  // a saved market resolves only once its event arrives — don't flash
  // "nothing saved" at someone who has bookmarks
  if (events.length === 0 && loading && wanted.length > 0) {
    return (
      <EmptyState
        icon={LoaderCircle}
        iconClassName="motion-safe:animate-spin"
        title="Loading your saved markets…"
        role="status"
      />
    );
  }
  if (events.length === 0) {
    return (
      <EmptyState
        icon={Bookmark}
        tone="text-accent-ink"
        title="Nothing saved yet"
        actions={
          <Link href="/" className={PRIMARY_BUTTON}>
            Browse markets
          </Link>
        }
      >
        Tap the bookmark on any market to keep it here.
      </EmptyState>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {events.map((e) => (
        <MarketCard key={e.id} event={e} />
      ))}
    </div>
  );
}
