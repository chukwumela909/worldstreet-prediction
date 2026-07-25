import type { MarketEvent } from "@/types/market";

/**
 * Resolving stored slugs (watchlist entries) back to live market data.
 *
 * The lookup takes a `bySlug` map of live events from useLiveEvents.
 * There is no static fallback universe — a slug the live API no longer
 * serves (a market that closed, say) simply doesn't resolve, and callers
 * render that as absent rather than inventing data for it.
 */
export function resolveEvent(
  slug: string,
  bySlug: Record<string, MarketEvent>,
): MarketEvent | undefined {
  return bySlug[slug];
}
