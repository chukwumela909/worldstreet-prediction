"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { MarketCard } from "@/components/market/market-card";
import { LocalPositions } from "@/components/portfolio/local-positions";
import { FundNairaModal } from "@/components/local/fund-naira-modal";
import { resolveEvent } from "@/lib/market-lookup";
import { useLiveEvents } from "@/lib/use-live-events";
import { useWatchlist } from "@/lib/watchlist-store";
import { useWalletBalance } from "@/lib/use-wallet-balance";
import { useNairaWallet } from "@/lib/naira-wallet";
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
const TABS = ["Local markets", "Watchlist"] as const;
type Tab = (typeof TABS)[number];

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PortfolioView() {
  const { user, openAuth } = useAuth();
  const [tab, setTab] = useState<Tab>("Local markets");
  const [funding, setFunding] = useState(false);

  const usdBalance = useWalletBalance(Boolean(user));
  const { balanceKobo } = useNairaWallet(Boolean(user));

  if (!user) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-card">
        <h1 className="text-xl font-semibold">Portfolio</h1>
        <p className="mt-2 text-sm text-secondary">
          Log in to see your balances and positions.
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
        <button
          onClick={() => setFunding(true)}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
        >
          <Wallet className="size-3.5" />
          Manage naira
        </button>
      </div>

      {/* balances */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard
          label="Dollar wallet"
          value={usdBalance === null ? "—" : usd(usdBalance)}
          note="Shared across WorldStreet — funds your naira balance."
        />
        <StatCard
          label="Naira balance"
          value={balanceKobo === null ? "—" : formatNaira(balanceKobo)}
          note="What Local markets trade with."
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
          </button>
        ))}
      </div>

      <div className="py-4">
        {tab === "Local markets" && <LocalPositions />}
        {tab === "Watchlist" && <Watchlist />}
      </div>

      <FundNairaModal open={funding} onClose={() => setFunding(false)} />
    </>
  );
}

function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <p className="text-[13px] font-medium text-secondary">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {note && <p className="mt-1 text-xs text-tertiary">{note}</p>}
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
    return <div className="py-10 text-center text-sm text-secondary">Loading…</div>;
  }
  if (events.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-secondary">
          Nothing saved yet — tap the bookmark on any market.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex h-9 items-center rounded-md bg-element-2 px-4 text-sm font-semibold text-secondary hover:bg-element-3 hover:text-primary"
        >
          Browse markets
        </Link>
      </div>
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
