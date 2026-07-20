import type { Market, MarketEvent } from "@/types/market";
import type { Position, Side } from "@/lib/portfolio-store";

/**
 * Resolving stored positions/watchlist entries back to live market data.
 *
 * Positions reference markets by id and events by slug; the lookups take
 * a `bySlug` map of live events (from useLiveEvents). There is no static
 * fallback universe — a slug the live API no longer serves (e.g. a
 * market that closed) simply doesn't resolve, and callers render that as
 * "price unknown" rather than inventing one.
 */

export function resolveEvent(
  slug: string,
  bySlug: Record<string, MarketEvent>,
): MarketEvent | undefined {
  return bySlug[slug];
}

/**
 * Current price in [0, 1] for one side of a held position.
 *
 * Looks the market up inside its own event (positions store `eventSlug`).
 * Returns null — not 0 — when the price genuinely isn't known, so
 * callers can distinguish "still loading / no longer listed" from
 * "worth nothing".
 */
export function positionPrice(
  position: Position,
  bySlug: Record<string, MarketEvent>,
): number | null {
  const event = resolveEvent(position.eventSlug, bySlug);
  const market = event?.markets.find((m) => m.id === position.marketId);
  if (!market) return null;
  return priceOf(market, position.side);
}

/** Price in [0, 1] for one side of a market. */
export function priceOf(market: Market, side: Side): number {
  return parseFloat(market.outcomePrices[side === "yes" ? 0 : 1]);
}
