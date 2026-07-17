import { MOCK_EVENTS } from "@/lib/mock-events";
import type { Market, MarketEvent } from "@/types/market";
import type { Side } from "@/lib/portfolio-store";

/** Find a market (and its parent event) by id across all fixtures. */
export function findMarket(
  marketId: string,
): { event: MarketEvent; market: Market } | null {
  for (const event of MOCK_EVENTS) {
    const market = event.markets.find((m) => m.id === marketId);
    if (market) return { event, market };
  }
  return null;
}

/** Current price in [0, 1] for one side of a market, 0 if unknown. */
export function currentPrice(marketId: string, side: Side): number {
  const hit = findMarket(marketId);
  if (!hit) return 0;
  return parseFloat(hit.market.outcomePrices[side === "yes" ? 0 : 1]);
}

export function eventBySlug(slug: string): MarketEvent | undefined {
  return MOCK_EVENTS.find((e) => e.slug === slug);
}
