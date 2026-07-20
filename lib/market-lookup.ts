import { MOCK_EVENTS } from "@/lib/mock-events";
import type { Market, MarketEvent } from "@/types/market";
import type { Position, Side } from "@/lib/portfolio-store";

/**
 * Resolving stored positions/watchlist entries back to market data.
 *
 * Positions reference markets by id and events by slug, but the app no
 * longer has a static universe to look them up in — most events come
 * from the live Gamma API. So the lookups take a `bySlug` map of live
 * events (from useLiveEvents) and fall back to the fixtures, which is
 * what fixture-only slugs and offline/geoblocked sessions rely on.
 */

/** Find a market (and its parent event) by id across the fixtures. */
export function findMarket(
  marketId: string,
): { event: MarketEvent; market: Market } | null {
  for (const event of MOCK_EVENTS) {
    const market = event.markets.find((m) => m.id === marketId);
    if (market) return { event, market };
  }
  return null;
}

export function eventBySlug(slug: string): MarketEvent | undefined {
  return MOCK_EVENTS.find((e) => e.slug === slug);
}

/**
 * Resolve an event by slug, preferring live data. Returns undefined when
 * neither source has it — e.g. a market that has since closed.
 */
export function resolveEvent(
  slug: string,
  bySlug: Record<string, MarketEvent>,
): MarketEvent | undefined {
  return bySlug[slug] ?? eventBySlug(slug);
}

/**
 * Current price in [0, 1] for one side of a held position.
 *
 * Looks the market up inside its own event (positions store `eventSlug`),
 * so live and fixture markets resolve the same way. Returns null — not 0
 * — when the price genuinely isn't known yet, so callers can distinguish
 * "still loading" from "worth nothing".
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

/** Current price by market id, fixtures only (used where no event slug is at hand). */
export function currentPrice(marketId: string, side: Side): number {
  const hit = findMarket(marketId);
  if (!hit) return 0;
  return priceOf(hit.market, side);
}
