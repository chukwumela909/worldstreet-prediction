"use client";

import { useSyncExternalStore } from "react";

/**
 * Mock portfolio store (no backend), same pattern as session-store:
 * demo cash + positions + trade history + watchlist live in
 * localStorage and are shared app-wide via useSyncExternalStore.
 * SSR renders the empty default; the client snapshot takes over
 * after hydration. All amounts are USD numbers, prices in [0, 1].
 */

export type Side = "yes" | "no";

export interface Position {
  /** One row per market+side. */
  marketId: string;
  eventSlug: string;
  eventTitle: string;
  eventIcon: string;
  /** Outcome label shown on the row ("Spain", or the event title for binary markets). */
  outcomeLabel: string;
  side: Side;
  shares: number;
  /** Volume-weighted average entry price in [0, 1]. */
  avgPrice: number;
}

export interface Activity {
  id: string;
  type: "buy" | "sell" | "deposit";
  ts: number;
  /** Dollars moved (spent on buy, received on sell, credited on deposit). */
  amount: number;
  eventSlug?: string;
  eventTitle?: string;
  eventIcon?: string;
  outcomeLabel?: string;
  side?: Side;
  shares?: number;
  price?: number;
}

export interface PortfolioState {
  cash: number;
  positions: Position[];
  activity: Activity[];
  /** Bookmarked event slugs, newest first. */
  watchlist: string[];
}

export const STARTING_CASH = 1000;

const DEFAULT_STATE: PortfolioState = {
  cash: STARTING_CASH,
  positions: [],
  activity: [],
  watchlist: [],
};

const STORAGE_KEY = "ws-portfolio";

let state: PortfolioState = DEFAULT_STATE;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = { ...DEFAULT_STATE, ...(JSON.parse(raw) as PortfolioState) };
  } catch {
    /* corrupt or unavailable storage — start fresh */
  }
}

function commit(next: PortfolioState) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — state still lives in memory */
  }
  listeners.forEach((l) => l());
}

const newId = () => `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function deposit(amount: number) {
  load();
  if (amount <= 0) return;
  commit({
    ...state,
    cash: state.cash + amount,
    activity: [
      { id: newId(), type: "deposit", ts: Date.now(), amount },
      ...state.activity,
    ],
  });
}

export interface TradeIntent {
  marketId: string;
  eventSlug: string;
  eventTitle: string;
  eventIcon: string;
  outcomeLabel: string;
  side: Side;
  /** Current market price in [0, 1] for the chosen side. */
  price: number;
}

/** Spend `amount` dollars buying shares at the given price. */
export function buyShares(intent: TradeIntent, amount: number): { ok: boolean; error?: string; shares?: number } {
  load();
  if (amount <= 0) return { ok: false, error: "Enter an amount" };
  if (amount > state.cash) return { ok: false, error: "Insufficient balance" };

  const shares = amount / intent.price;
  const existing = state.positions.find(
    (p) => p.marketId === intent.marketId && p.side === intent.side,
  );
  const positions = existing
    ? state.positions.map((p) =>
        p === existing
          ? {
              ...p,
              shares: p.shares + shares,
              avgPrice:
                (p.avgPrice * p.shares + intent.price * shares) / (p.shares + shares),
            }
          : p,
      )
    : [
        {
          marketId: intent.marketId,
          eventSlug: intent.eventSlug,
          eventTitle: intent.eventTitle,
          eventIcon: intent.eventIcon,
          outcomeLabel: intent.outcomeLabel,
          side: intent.side,
          shares,
          avgPrice: intent.price,
        },
        ...state.positions,
      ];

  commit({
    ...state,
    cash: state.cash - amount,
    positions,
    activity: [
      {
        id: newId(),
        type: "buy",
        ts: Date.now(),
        amount,
        eventSlug: intent.eventSlug,
        eventTitle: intent.eventTitle,
        eventIcon: intent.eventIcon,
        outcomeLabel: intent.outcomeLabel,
        side: intent.side,
        shares,
        price: intent.price,
      },
      ...state.activity,
    ],
  });
  return { ok: true, shares };
}

/** Sell `shares` from a held position at the given price. */
export function sellShares(intent: TradeIntent, shares: number): { ok: boolean; error?: string; proceeds?: number } {
  load();
  const held = state.positions.find(
    (p) => p.marketId === intent.marketId && p.side === intent.side,
  );
  if (!held || held.shares <= 0) return { ok: false, error: "No shares to sell" };
  if (shares <= 0) return { ok: false, error: "Enter an amount" };
  // Tolerate float dust when the user sells "all".
  const toSell = Math.min(shares, held.shares);
  if (shares > held.shares + 1e-6) return { ok: false, error: "Not enough shares" };

  const proceeds = toSell * intent.price;
  const remaining = held.shares - toSell;
  const positions =
    remaining < 1e-6
      ? state.positions.filter((p) => p !== held)
      : state.positions.map((p) => (p === held ? { ...p, shares: remaining } : p));

  commit({
    ...state,
    cash: state.cash + proceeds,
    positions,
    activity: [
      {
        id: newId(),
        type: "sell",
        ts: Date.now(),
        amount: proceeds,
        eventSlug: intent.eventSlug,
        eventTitle: intent.eventTitle,
        eventIcon: intent.eventIcon,
        outcomeLabel: intent.outcomeLabel,
        side: intent.side,
        shares: toSell,
        price: intent.price,
      },
      ...state.activity,
    ],
  });
  return { ok: true, proceeds };
}

export function toggleWatchlist(slug: string) {
  load();
  const watchlist = state.watchlist.includes(slug)
    ? state.watchlist.filter((s) => s !== slug)
    : [slug, ...state.watchlist];
  commit({ ...state, watchlist });
}

/** Wipe demo funds and positions back to the starting state. */
export function resetPortfolio() {
  load();
  commit({ ...DEFAULT_STATE });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function usePortfolio(): PortfolioState {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return state;
    },
    () => DEFAULT_STATE,
  );
}

/** Current market value of a position given a live price lookup. */
export function positionValue(p: Position, price: number): number {
  return p.shares * price;
}
