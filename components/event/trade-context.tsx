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
  children,
}: {
  event: MarketEvent;
  children: React.ReactNode;
}) {
  const [marketId, setMarketId] = useState(event.markets[0].id);
  const [side, setSide] = useState<"yes" | "no">("yes");

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
