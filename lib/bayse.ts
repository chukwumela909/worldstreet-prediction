import { unstable_cache } from "next/cache";
import type { Category, Market, MarketEvent } from "@/types/market";
import type { SeriesPoint } from "@/lib/series";

/**
 * Server-side data layer for the Bayse Relay API
 * (https://relay.bayse.markets — public, no auth for event reads), the
 * source behind the "Local" category tab: Nigerian/African prediction
 * markets displayed alongside the Polymarket feed.
 *
 * Bayse events carry `source: "bayse"` so the UI can skip affordances
 * that assume a Polymarket slug (watchlist, live price polling) and route
 * their detail pages to /local/[slug], where they trade against
 * WorldStreet in naira credit.
 *
 * Money figures are requested in naira (`currency=NGN`) — Bayse's own
 * UI leads with ₦, and the listing's `totalVolume` is 0 while
 * `liquidity` carries the real pool size.
 *
 * Normalizes Relay responses into the app's `MarketEvent` shape. Relay
 * quirks handled here:
 *  - prices are numbers in [0, 1]; the app's shape uses decimal strings
 *  - a SINGLE_MARKET event's market is titled "Yes" — the real question
 *    lives on the event; COMBINED/GROUPED market titles are the outcome
 *    labels (→ `groupItemTitle`)
 *  - `closingDate` is often empty; fall back to `resolutionDate`
 *  - page size is capped at 20 server-side regardless of `size`
 */

const RELAY_BASE = "https://relay.bayse.markets";
/**
 * A page render waits on this, so an upstream that hangs rather than
 * refusing is worse than one that's down: without a deadline the render
 * hangs with it and the visitor gets a blank tab instead of the "feed
 * unavailable" state the page already knows how to show.
 */
const FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_REVALIDATE_SECONDS = 60;
/** Detail-page price polling — see getBayseEventLive. */
const LIVE_REVALIDATE_SECONDS = 10;

/**
 * Hosts allowed for `iconUrl`. Must stay in sync with
 * `images.remotePatterns` in next.config.ts (same contract as
 * ALLOWED_ICON_HOSTS in lib/polymarket.ts).
 */
const ALLOWED_ICON_HOSTS = new Set(["assets.bayse.markets"]);

export class BayseApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "BayseApiError";
  }
}

/* ------------------------------------------------------------------ */
/* Raw Relay shapes (only the fields we consume)                       */
/* ------------------------------------------------------------------ */

interface BayseMarket {
  id: string;
  /** "Yes" on single-market events; the outcome label on combined/grouped. */
  title: string;
  status?: string;
  outcome1Id?: string;
  outcome1Label?: string;
  outcome1Price?: number;
  outcome2Id?: string;
  outcome2Label?: string;
  outcome2Price?: number;
  rules?: string;
}

interface BayseEvent {
  id: string;
  slug: string;
  title: string;
  /** Uppercase, e.g. "CRYPTO", "BB NAIJA", "SOCIAL MEDIA". */
  category?: string;
  /** "SINGLE_MARKET" | "COMBINED_MARKETS" | "GROUPED_MARKETS" */
  type?: string;
  status?: string;
  imageUrl?: string;
  image128Url?: string;
  totalVolume?: number;
  /** Often an empty string — resolutionDate is the reliable one. */
  closingDate?: string;
  resolutionDate?: string;
  /** Either flag marks one of the automated short-cycle series. */
  displayCountdown?: boolean;
  countdownType?: string;
  /** Set on a game's events: the game in /v1/pm/sports/games. */
  sportGameId?: string;
  hashtags?: string[];
  markets?: BayseMarket[];
  /** Trades across the event. */
  totalOrders?: number;
  /** Pool liquidity in the requested currency (₦ with currency=NGN). */
  liquidity?: number;
  description?: string;
  resolutionSource?: string;
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

/** Bayse category strings → app category. Unmapped → Trending. */
const CATEGORY_MAP: Record<string, Category> = {
  POLITICS: "Politics",
  SPORTS: "Sports",
  CRYPTO: "Crypto",
  ESPORTS: "Esports",
  FINANCE: "Finance",
  ECONOMY: "Economy",
  TECH: "Tech",
  CULTURE: "Culture",
  ENTERTAINMENT: "Culture",
  "BB NAIJA": "Culture",
  "SOCIAL MEDIA": "Culture",
};

/** "BB NAIJA" → "BB Naija", for filter chips. */
function titleCase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bBb\b/, "BB");
}

function safeIconUrl(...candidates: (string | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (ALLOWED_ICON_HOSTS.has(new URL(candidate).hostname)) return candidate;
    } catch {
      // not a valid URL — skip
    }
  }
  return undefined;
}

function toMarket(raw: BayseMarket, single: boolean, eventTitle: string): Market | null {
  const yes = raw.outcome1Price;
  const no = raw.outcome2Price;
  if (typeof yes !== "number" || typeof no !== "number") return null;
  const labels: [string, string] = [
    raw.outcome1Label || "Yes",
    raw.outcome2Label || "No",
  ];
  return {
    id: raw.id,
    question: single ? eventTitle : raw.title,
    groupItemTitle: single ? undefined : raw.title,
    outcomePrices: [String(yes), String(no)],
    // Relay reports volume per event, not per market
    volume: "0",
    outcomeLabels: labels[0] !== "Yes" || labels[1] !== "No" ? labels : undefined,
    // both ids or neither — the trade panel treats a market without them
    // as not tradeable rather than sending a half-formed order
    outcomeIds:
      raw.outcome1Id && raw.outcome2Id
        ? [raw.outcome1Id, raw.outcome2Id]
        : undefined,
    rules: raw.rules || undefined,
  };
}

/* ---------- kickoff ---------- */

/*
 * Bayse keeps a game open until three hours after kickoff; our book
 * stops it at kickoff (services/api trading/bayse.ts, which the API
 * enforces on every order). The same two sources here: the games
 * list's start time and the kickoff in the market rules, earliest wins.
 */

/** Keep in step with services/api/src/trading/bayse.ts. */
const RULES_KICKOFF = /scheduled for ([A-Z][a-z]+ \d{1,2}, \d{4}) at (\d{1,2}:\d{2} ?[AP]M) UTC/;

/** Game id → kickoff (epoch ms). */
export type GameStarts = Record<string, number>;

/**
 * When the event's game kicks off, epoch ms: undefined for an event
 * that isn't a game, NaN for a game no source gives a time for.
 */
function kickoffMs(raw: BayseEvent, starts: GameStarts): number | undefined {
  if (!raw.sportGameId) return undefined;
  const times = [
    starts[raw.sportGameId] ?? NaN,
    ...(raw.markets ?? []).map((m) => {
      const hit = RULES_KICKOFF.exec(m.rules ?? "");
      return hit ? Date.parse(`${hit[1]} ${hit[2]} UTC`) : NaN;
    }),
  ].filter((t) => !Number.isNaN(t));
  return times.length > 0 ? Math.min(...times) : NaN;
}

/** A game that has kicked off — no longer bought here, so off the boards. */
function hasKickedOff(raw: BayseEvent, starts: GameStarts): boolean {
  const kickoff = kickoffMs(raw, starts);
  return kickoff !== undefined && !Number.isNaN(kickoff) && Date.now() >= kickoff;
}

/** Returns null when the event has no open market with usable prices. */
export function toBayseMarketEvent(raw: BayseEvent, starts: GameStarts = {}): MarketEvent | null {
  const single = raw.type === "SINGLE_MARKET";
  const markets = (raw.markets ?? [])
    .filter((m) => (m.status ?? "open") === "open")
    .map((m) => toMarket(m, single, raw.title))
    .filter((m): m is Market => m !== null)
    .sort((a, b) => parseFloat(b.outcomePrices[0]) - parseFloat(a.outcomePrices[0]));
  if (markets.length === 0) return null;

  const category = CATEGORY_MAP[raw.category ?? ""] ?? "Trending";
  // chips: the Bayse category label first, then real hashtags
  const tags = [
    ...(raw.category ? [titleCase(raw.category)] : []),
    ...(raw.hashtags ?? []).filter((h) => h.toLowerCase() !== "general"),
  ];
  // a game closes at kickoff, not at Bayse's closingDate three hours on
  const kickoff = kickoffMs(raw, starts);
  const bayseCloses = raw.closingDate || raw.resolutionDate || undefined;
  const closesAt =
    kickoff !== undefined &&
    !Number.isNaN(kickoff) &&
    (!bayseCloses || kickoff < Date.parse(bayseCloses))
      ? new Date(kickoff).toISOString()
      : bayseCloses;

  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    icon: "🌍",
    // the 128px variant first: icons render at 56px at most (112 at 2x),
    // and imageUrl is a 512px original — up to ~1 MB the optimizer would
    // download just to shrink
    iconUrl: safeIconUrl(raw.image128Url, raw.imageUrl),
    category,
    tags: tags.length > 0 ? tags.slice(0, 4) : undefined,
    volume: String(raw.totalVolume ?? 0),
    endDate: (raw.closingDate || raw.resolutionDate || "").slice(0, 10),
    closesAt,
    // a game with no stated kickoff: the API won't take bets on it
    ...(kickoff !== undefined && Number.isNaN(kickoff) && { tradingOpen: false }),
    countdown: Boolean(raw.displayCountdown || raw.countdownType) || undefined,
    markets,
    source: "bayse",
    trades: raw.totalOrders,
    liquidityNgn: raw.liquidity !== undefined ? String(raw.liquidity) : undefined,
    description: raw.description?.trim() || undefined,
    resolutionSource:
      raw.resolutionSource && raw.resolutionSource !== "TBD"
        ? raw.resolutionSource
        : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Fetchers                                                            */
/* ------------------------------------------------------------------ */

async function relayFetch<T>(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(path, RELAY_BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    // a timeout lands here too, and reads the same to the caller: the
    // feed didn't answer
    throw new BayseApiError(`Relay request failed: ${url.pathname} (network error)`);
  }
  if (!res.ok) {
    throw new BayseApiError(
      `Relay request failed: ${url.pathname} → HTTP ${res.status}`,
      res.status,
    );
  }
  return res.json();
}

const GAMES_REVALIDATE_SECONDS = 300;
const MAX_GAME_PAGES = 10;

/**
 * Every listed game's kickoff — Relay's games list, ~80 games over a
 * couple of pages. Kickoffs rarely move, so it's kept five minutes.
 */
const fetchGameStarts = unstable_cache(
  async (): Promise<GameStarts> => {
    const starts: GameStarts = {};
    for (let page = 1; page <= MAX_GAME_PAGES; page++) {
      const res = await relayFetch<{
        games?: { id?: string; startDate?: string }[];
        pagination?: { lastPage?: number };
      }>("/v1/pm/sports/games", { page });
      for (const g of res.games ?? []) {
        const at = Date.parse(g.startDate ?? "");
        if (g.id && !Number.isNaN(at)) starts[g.id] = at;
      }
      const last = res.pagination?.lastPage;
      if (typeof last !== "number" || page >= last) break;
    }
    return starts;
  },
  ["bayse-game-starts"],
  { revalidate: GAMES_REVALIDATE_SECONDS, tags: ["bayse"] },
);

/** The games list, or none when it's down — the rules text still gives most kickoffs. */
const getGameStarts = (): Promise<GameStarts> => fetchGameStarts().catch(() => ({}));

/**
 * Open Bayse events in the API's own (trending-ish) order, normalized
 * for the UI. Relay caps pages at 20, so two pages are fetched to fill
 * the grid. Cached (normalized output only) like the Polymarket layer.
 * Games that have kicked off are left out: they no longer take bets here.
 */
export const getBayseEvents = unstable_cache(
  async (): Promise<MarketEvent[]> => {
    const [starts, ...pages] = await Promise.all([
      getGameStarts(),
      ...[1, 2].map((page) =>
        relayFetch<{ events?: BayseEvent[] }>("/v1/pm/events", {
          page,
          size: 20,
          status: "open",
          currency: "NGN",
        }),
      ),
    ]);
    return pages
      .flatMap((p) => p.events ?? [])
      .filter((raw) => !hasKickedOff(raw, starts))
      .map((raw) => toBayseMarketEvent(raw, starts))
      .filter((e): e is MarketEvent => e !== null);
  },
  ["bayse-events"],
  { revalidate: DEFAULT_REVALIDATE_SECONDS, tags: ["bayse"] },
);

/** Relay's page size — it ignores any larger `size`. */
export const BAYSE_PAGE_SIZE = 20;
/** How deep "Load more" may page; Relay listed ~38 open pages when written. */
export const BAYSE_MAX_PAGE = 100;

export interface BayseEventsPage {
  events: MarketEvent[];
  /** Relay has a page after this one. */
  hasMore: boolean;
}

interface BayseEventsResponse {
  events?: BayseEvent[];
  pagination?: { page?: number; lastPage?: number; totalCount?: number };
}

/**
 * One Relay page of open events, normalized — what the Local tab's "Load
 * more" reads after the two pages getBayseEvents put on the board.
 *
 * `hasMore` comes from Relay's own `pagination.lastPage` rather than the
 * normalized count: an event with no open market is dropped here, so a
 * page can come back short and still not be the last one. Without
 * pagination metadata, a full raw page is taken to mean there may be more.
 */
export const getBayseEventsPage = unstable_cache(
  async (page: number): Promise<BayseEventsPage> => {
    if (!Number.isInteger(page) || page < 1 || page > BAYSE_MAX_PAGE) {
      throw new RangeError(`Bayse page out of range: ${page}`);
    }
    const [starts, raw] = await Promise.all([
      getGameStarts(),
      relayFetch<BayseEventsResponse>("/v1/pm/events", {
        page,
        size: BAYSE_PAGE_SIZE,
        status: "open",
        currency: "NGN",
      }),
    ]);
    const rows = raw.events ?? [];
    const lastPage = raw.pagination?.lastPage;
    const hasMore =
      page < BAYSE_MAX_PAGE &&
      (typeof lastPage === "number" ? page < lastPage : rows.length >= BAYSE_PAGE_SIZE);
    return {
      events: rows
        .filter((r) => !hasKickedOff(r, starts))
        .map((r) => toBayseMarketEvent(r, starts))
        .filter((e): e is MarketEvent => e !== null),
      hasMore,
    };
  },
  ["bayse-events-page"],
  { revalidate: DEFAULT_REVALIDATE_SECONDS, tags: ["bayse"] },
);

/** Single Bayse event by its URL slug, or null when not found. */
export const getBayseEventBySlug = unstable_cache(
  async (slug: string): Promise<MarketEvent | null> => {
    let raw: BayseEvent;
    const starts = getGameStarts();
    try {
      raw = await relayFetch<BayseEvent>(
        `/v1/pm/events/slug/${encodeURIComponent(slug)}`,
        { currency: "NGN" },
      );
    } catch (err) {
      if (err instanceof BayseApiError && err.status === 404) return null;
      throw err;
    }
    return toBayseMarketEvent(raw, await starts);
  },
  ["bayse-event-by-slug"],
  { revalidate: DEFAULT_REVALIDATE_SECONDS, tags: ["bayse"] },
);

/**
 * Same event, cached for a fraction of the time — what the /local page's
 * price poller reads. The page's own render can afford minute-old
 * prices; a panel someone is about to stake against cannot, and this
 * still coalesces every viewer of an event into one Relay call per tick.
 */
export const getBayseEventLive = unstable_cache(
  async (slug: string): Promise<MarketEvent | null> => {
    let raw: BayseEvent;
    const starts = getGameStarts();
    try {
      raw = await relayFetch<BayseEvent>(
        `/v1/pm/events/slug/${encodeURIComponent(slug)}`,
        { currency: "NGN" },
      );
    } catch (err) {
      if (err instanceof BayseApiError && err.status === 404) return null;
      throw err;
    }
    return toBayseMarketEvent(raw, await starts);
  },
  ["bayse-event-live"],
  { revalidate: LIVE_REVALIDATE_SECONDS, tags: ["bayse"] },
);

/* ------------------------------------------------------------------ */
/* Price history                                                       */
/* ------------------------------------------------------------------ */

/** Relay's history windows — coarser than the CLOB's (no 1H/6H). */
export const BAYSE_TIMEFRAMES = ["12H", "24H", "1W", "1M", "1Y"] as const;
export type BayseTimeframe = (typeof BAYSE_TIMEFRAMES)[number];

interface BayseHistoryResponse {
  markets?: {
    marketId: string;
    priceHistory?: { e: number; p: number }[];
  }[];
}

/**
 * Yes-price history for every market of an event, keyed by market id,
 * as {t: ms epoch, p: percent} — the shape the charts consume. Public
 * endpoint, no auth.
 */
export const getBaysePriceHistory = unstable_cache(
  async (
    eventId: string,
    timePeriod: BayseTimeframe,
  ): Promise<Record<string, SeriesPoint[]>> => {
    const raw = await relayFetch<BayseHistoryResponse>(
      `/v1/pm/events/${encodeURIComponent(eventId)}/price-history`,
      { timePeriod },
    );
    const out: Record<string, SeriesPoint[]> = {};
    for (const m of raw.markets ?? []) {
      const points = (m.priceHistory ?? []).map((pt) => ({
        t: pt.e,
        p: pt.p * 100, // probabilities 0–1 → percent, like the CLOB layer
      }));
      if (points.length > 0) out[m.marketId] = points;
    }
    return out;
  },
  ["bayse-price-history"],
  { revalidate: DEFAULT_REVALIDATE_SECONDS, tags: ["bayse"] },
);
