"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { MarketEvent } from "@/types/market";

/**
 * Selection shared between the outcome list and the trade panel:
 * which market is being traded, and which side (Yes/No).
 */
interface TradeSelection {
  marketId: string;
  side: "yes" | "no";
  select: (marketId: string, side: "yes" | "no") => void;
  setSide: (side: "yes" | "no") => void;
}

const TradeContext = createContext<TradeSelection | null>(null);

export function TradeProvider({
  event,
  initialMarketId,
  initialSide = "yes",
  children,
}: {
  event: MarketEvent;
  /**
   * Market to start on (default: the first). Read on mount only — key the
   * provider to restart it from a new pick, as the sports ticket does.
   * An id the event doesn't carry falls back to the first market.
   */
  initialMarketId?: string;
  /** Side to start on (default "yes"). Mount only, like initialMarketId. */
  initialSide?: "yes" | "no";
  children: React.ReactNode;
}) {
  const [marketId, setMarketId] = useState(() =>
    initialMarketId && event.markets.some((m) => m.id === initialMarketId)
      ? initialMarketId
      : event.markets[0].id,
  );
  const [side, setSide] = useState<"yes" | "no">(initialSide);

  const value = useMemo<TradeSelection>(
    () => ({
      marketId,
      side,
      select: (id, s) => {
        setMarketId(id);
        setSide(s);
      },
      setSide,
    }),
    [marketId, side],
  );

  return <TradeContext.Provider value={value}>{children}</TradeContext.Provider>;
}

export function useTradeSelection(): TradeSelection {
  const ctx = useContext(TradeContext);
  if (!ctx) throw new Error("useTradeSelection must be used inside TradeProvider");
  return ctx;
}
