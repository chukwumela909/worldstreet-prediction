"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, isApiConfigured } from "@/lib/api-client";
import { setNairaBalance } from "@/lib/naira-wallet";

/**
 * Client for the Local (naira) book in services/api. Positions are
 * hold-to-settlement: a stake buys shares at the price shown, and a
 * winning share pays ₦100 when the market resolves. There is no
 * sell-back in v1, so nothing here marks a position to market.
 */

/** What a winning share pays out, in kobo — mirrors the server's constant. */
export const PAYOUT_PER_SHARE_KOBO = 10_000;

export type LocalPositionStatus = "open" | "won" | "lost" | "voided";

export interface LocalPosition {
  id: string;
  eventId: string;
  marketId: string;
  outcomeId: string;
  outcomeLabel: string;
  eventSlug: string;
  eventTitle: string;
  marketTitle: string;
  stakeKobo: number;
  /** Execution price, kobo per ₦100 share. */
  priceKobo: number;
  shares: number;
  potentialPayoutKobo: number;
  status: LocalPositionStatus;
  createdAt: string | null;
  settledAt: string | null;
}

interface TradeResponse {
  success: boolean;
  data: {
    position: LocalPosition;
    balanceKobo?: number;
    alreadyProcessed?: boolean;
  };
}

/**
 * Stake naira on an outcome. `expectedPriceKobo` is the price the user
 * was shown: the server re-prices against Bayse and rejects with
 * PRICE_MOVED (carrying `details.freshPriceKobo`) rather than filling at
 * a price nobody agreed to. Reuse the same `idempotencyKey` when
 * re-confirming or retrying — it is what stops a double stake.
 */
export async function placeLocalTrade(params: {
  eventId: string;
  marketId: string;
  outcomeId: string;
  stakeKobo: number;
  expectedPriceKobo: number;
  idempotencyKey: string;
}): Promise<TradeResponse["data"]> {
  const res = await apiFetch<TradeResponse>("/v1/trades", {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (typeof res.data.balanceKobo === "number") {
    setNairaBalance(res.data.balanceKobo);
  }
  return res.data;
}

interface PortfolioResponse {
  success: boolean;
  data: { balanceKobo: number; positions: LocalPosition[] };
}

export interface LocalPortfolio {
  positions: LocalPosition[];
  balanceKobo: number | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** Naira balance + every Local position, newest first. */
export function useLocalPortfolio(enabled: boolean): LocalPortfolio {
  const [state, setState] = useState<{
    positions: LocalPosition[];
    balanceKobo: number | null;
    loading: boolean;
    error: string | null;
  }>({ positions: [], balanceKobo: null, loading: true, error: null });
  // bumped by refresh() — re-runs the load without duplicating it
  const [reloads, setReloads] = useState(0);

  const active = enabled && isApiConfigured();

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await apiFetch<PortfolioResponse>("/v1/portfolio");
        if (cancelled) return;
        setState({
          positions: res.data.positions,
          balanceKobo: res.data.balanceKobo,
          loading: false,
          error: null,
        });
        setNairaBalance(res.data.balanceKobo);
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          loading: false,
          error:
            err instanceof Error ? err.message : "Could not load your positions",
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, reloads]);

  const refresh = useCallback(() => setReloads((n) => n + 1), []);

  return { ...state, loading: active && state.loading, refresh };
}

/** Shares a stake buys at a price, both in kobo. */
export function sharesFor(stakeKobo: number, priceKobo: number): number {
  return priceKobo > 0 ? stakeKobo / priceKobo : 0;
}

/** What those shares pay if the outcome wins, in kobo (server floors too). */
export function payoutFor(stakeKobo: number, priceKobo: number): number {
  return Math.floor(sharesFor(stakeKobo, priceKobo) * PAYOUT_PER_SHARE_KOBO);
}

/** Decimal probability ("0.58") → kobo per ₦100 share (5800). */
export function priceToKobo(decimalPrice: string): number {
  return Math.round(parseFloat(decimalPrice) * PAYOUT_PER_SHARE_KOBO);
}
