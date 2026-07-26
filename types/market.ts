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
  /**
   * CLOB token id for the Yes outcome — the key for real price history.
   */
  clobTokenId?: string;
  /** On-chain condition id — the key for holders/trades lookups. */
  conditionId?: string;
  /** Real 24h price change as a decimal (e.g. -0.0025 = -0.25pp). */
  oneDayPriceChange?: number;
  /** Outcome labels when they aren't Yes/No (Bayse, e.g. ["Portable", "Charles"]). */
  outcomeLabels?: [string, string];
  /**
   * Local-book outcome ids, [yes, no] — what POST /v1/trades names when
   * staking naira on this market. Absent on Polymarket markets.
   */
  outcomeIds?: [string, string];
  /** Resolution criteria text (Bayse markets). */
  rules?: string;
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
  /**
   * Full ISO timestamp trading closes (Bayse) — `endDate` is date-only,
   * which is useless for the short-cycle countdown markets.
   */
  closesAt?: string;
  /**
   * True on Bayse's automated short-cycle series (15-minute crypto and
   * friends). They stop accepting trades a cutoff before `closesAt`,
   * since a nearly-decided market is pure adverse selection.
   */
  countdown?: boolean;
  markets: Market[];
  /**
   * Where the event came from; absent = Polymarket. Both Local-book
   * sources route their detail page to /local/[slug] and skip the
   * watchlist and the Polymarket price poller: `bayse` is Relay's feed,
   * `worldstreet` is a fixed-odds market we wrote ourselves.
   */
  source?: "bayse" | "worldstreet";
  /** Total trades across the event (Bayse `totalOrders`, or our own count). */
  trades?: number;
  /** Pool liquidity in naira as a decimal string (Bayse events). */
  liquidityNgn?: string;
  /**
   * Naira staked into the event as a decimal string (Worldstreet
   * events). Our markets have no pool to report — the house is the
   * counterparty — so this is what a card shows in liquidity's place.
   */
  stakedNgn?: string;
  /** What the event tracks (Bayse detail page). */
  description?: string;
  /** Where resolution is verified, e.g. a chart URL (Bayse). */
  resolutionSource?: string;
  /**
   * False when the desk has closed the book but the result isn't in
   * yet (Worldstreet events). Bayse events leave it unset and are
   * gated on `closesAt` alone.
   */
  tradingOpen?: boolean;
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

/**
 * True for the naira book — Bayse's feed and our own fixed-odds
 * markets. These are the events that trade at /local/[slug] against the
 * house, as opposed to the Polymarket events the site only mirrors.
 */
export function isLocalBook(event: Pick<MarketEvent, "source">): boolean {
  return event.source === "bayse" || event.source === "worldstreet";
}

/** True when the event is a single Yes/No market. */
export function isBinary(event: MarketEvent): boolean {
  return event.markets.length === 1;
}

/** Yes-probability of a market as a number in [0, 1]. */
export function yesProbability(market: Market): number {
  return parseFloat(market.outcomePrices[0]);
}
