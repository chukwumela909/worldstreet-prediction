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
  /** Outcome labels when they aren't Yes/No (e.g. ["Portable", "Charles"], ["Over", "Under"]). */
  outcomeLabels?: [string, string];
  /**
   * Outcome ids, [yes, no] — what POST /v1/trades names when staking
   * naira on this market. UUIDs on the Local book, Polymarket's CLOB
   * token ids on the international one. Absent = not tradeable; present
   * on an international market still trades only while the API's
   * international-trading switch is on (useQuote().international).
   */
  outcomeIds?: [string, string];
  /** Resolution criteria text (Bayse markets). */
  rules?: string;
  /** "moneyline" | "spreads" | "totals" | ... on sports game markets. */
  sportsMarketType?: string;
}

/** One side of a game, as the source describes it. */
export interface GameTeam {
  name: string;
  abbreviation?: string;
  logoUrl?: string;
  /** The team's colour, e.g. "#134F89" — for its row's accent. */
  color?: string;
  side?: "home" | "away";
  record?: string;
}

/**
 * Live state of a sports game (Polymarket game events). The score and
 * period come through as the source writes them — "0-3" / "1H" for
 * soccer, "Bot 2nd" for baseball, "000-000|1-1|Bo3" for a best-of-three
 * — so they're displayed, never parsed for logic.
 */
export interface GameState {
  live: boolean;
  ended: boolean;
  score?: string;
  period?: string;
  /** Minutes played, when the sport has a clock. */
  elapsed?: string;
  /** Kickoff, ISO. */
  startTime?: string;
  /** League or competition, e.g. "UEFA Europa League 2025". */
  league?: string;
  teams: GameTeam[];
}

/** The sports page's market types (the reference's pills). */
export const SPORT_TYPES = [
  "Games",
  "Props",
  "To advance",
  "Futures",
  "Win totals",
  "Awards",
] as const;
export type SportType = (typeof SPORT_TYPES)[number];

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
   * The event's full market count, set only when a list trimmed
   * `markets` to a subset (lib/polymarket.ts trimForList) — what a card's
   * "N outcomes" should say.
   */
  marketCount?: number;
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
  /** Sports game state — present on game events (two teams, a kickoff). */
  game?: GameState;
  /** Which sports pill the event belongs to; absent outside sports. */
  sportType?: SportType;
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
 * True for the Local book — Bayse's feed and our own fixed-odds
 * markets, which always trade at /local/[slug] against the house. The
 * Polymarket events are the international book: they trade only while
 * the desk's international switch is on (`useQuote().international`),
 * and are display-only mirrors otherwise.
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
