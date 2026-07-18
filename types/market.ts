/**
 * Data shapes modeled on Polymarket's public Gamma API
 * (https://gamma-api.polymarket.com/events), simplified to the fields
 * the UI consumes. Prices arrive as decimal strings — exactly like the
 * real API — so swapping mock fixtures for live data later is a
 * fetch-function change, not a component change.
 */

/** A single tradeable market (one Yes/No question). */
export interface Market {
  id: string;
  question: string;
  /** Outcome label when part of a multi-market event (e.g. "Spain"). */
  groupItemTitle?: string;
  /** [yesPrice, noPrice] as decimal strings, e.g. ["0.58", "0.42"]. */
  outcomePrices: [string, string];
  /** Lifetime volume in USD as a decimal string. */
  volume: string;
}

/** An event groups one or more markets under a single card/page. */
export interface MarketEvent {
  id: string;
  slug: string;
  title: string;
  /** Emoji stand-in for the market icon image (fixtures only). */
  icon: string;
  /** Real icon image URL when sourced from the live Gamma API. */
  iconUrl?: string;
  category: Category;
  /** Optional breadcrumb refinement, e.g. "Soccer" under Sports. */
  subcategory?: string;
  /** Home-grid filter chips this event belongs to (e.g. "World Cup"). */
  tags?: string[];
  /** Total volume in USD as a decimal string. */
  volume: string;
  /** ISO date the event resolves/ends. */
  endDate: string;
  markets: Market[];
}

export const CATEGORIES = [
  "Trending",
  "Politics",
  "Sports",
  "Crypto",
  "Esports",
  "Finance",
  "Geopolitics",
  "Tech",
  "Culture",
  "Economy",
  "Weather",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** True when the event is a single Yes/No market. */
export function isBinary(event: MarketEvent): boolean {
  return event.markets.length === 1;
}

/** Yes-probability of a market as a number in [0, 1]. */
export function yesProbability(market: Market): number {
  return parseFloat(market.outcomePrices[0]);
}
