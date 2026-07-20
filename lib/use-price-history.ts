"use client";

import { useEffect, useState } from "react";
import type { Market } from "@/types/market";
import type { HistoryWindow, SeriesPoint } from "@/lib/series";

/**
 * Real CLOB price history for a set of markets, keyed by market id.
 *
 * Markets carrying a `clobTokenId` (i.e. everything from the live Gamma
 * API) get real history; mock fixtures have no token id, so callers fall
 * back to the synthetic series for those. `real` reports whether the
 * returned data is genuine — charts use it to avoid presenting a
 * fabricated curve as if it were market data.
 */
export interface PriceHistory {
  /** market id → points, only for markets with real history */
  byMarket: Record<string, SeriesPoint[]>;
  /** true once at least one market's real history has loaded */
  real: boolean;
  loading: boolean;
}

const EMPTY: Record<string, SeriesPoint[]> = {};

export function usePriceHistory(
  markets: Market[],
  window: HistoryWindow,
): PriceHistory {
  const tokens = markets.map((m) => m.clobTokenId).filter(Boolean) as string[];
  // identifies the request; also gates stale results at render time
  const requestKey = `${tokens.join(",")}|${window}`;

  const [loaded, setLoaded] = useState<{
    key: string;
    byMarket: Record<string, SeriesPoint[]>;
  }>({ key: "", byMarket: EMPTY });

  useEffect(() => {
    if (tokens.length === 0) return;

    let cancelled = false;
    const key = requestKey;

    fetch(
      `/api/prices-history?tokens=${encodeURIComponent(tokens.join(","))}&window=${window}`,
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((body: { series: Record<string, SeriesPoint[]> }) => {
        if (cancelled) return;
        // remap token id → market id for the chart's dataKeys
        const next: Record<string, SeriesPoint[]> = {};
        for (const m of markets) {
          const points = m.clobTokenId && body.series[m.clobTokenId];
          if (points && points.length > 0) next[m.id] = points;
        }
        setLoaded({ key, byMarket: next });
      })
      .catch(() => {
        // record the failure against this key so callers stop waiting and
        // fall back to the synthetic series
        if (!cancelled) setLoaded({ key, byMarket: EMPTY });
      });

    return () => {
      cancelled = true;
    };
    // `markets` is excluded deliberately: requestKey captures the tokens
    // that matter, and the array identity churns on every parent render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  // ignore data belonging to a previous market set or timeframe, so
  // switching timeframes never plots the old window's points
  const fresh = loaded.key === requestKey;
  const byMarket = fresh ? loaded.byMarket : EMPTY;

  return {
    byMarket,
    real: Object.keys(byMarket).length > 0,
    loading: tokens.length > 0 && !fresh,
  };
}
