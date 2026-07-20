import { unstable_cache } from "next/cache";
import type { Category, Market, MarketEvent } from "@/types/market";
import { CATEGORIES } from "@/types/market";
import type { HistoryWindow, SeriesPoint } from "@/lib/series";

/**
 * Server-side data layer for Polymarket's public Gamma API
 * (https://gamma-api.polymarket.com — free, no auth for reads).
 *
 * Normalizes raw Gamma responses into the app's `MarketEvent` shape so
 * pages can swap `MOCK_EVENTS` for `getEvents()` without touching
 * components. Gamma quirks handled here:
 *  - `outcomePrices` / `outcomes` arrive as JSON-encoded *strings*
 *  - event `volume` is a number, market `volume` a string
 *  - categories don't exist server-side; they're derived from tags
 *
 * Call from Server Components only — responses are cached via
 * `next: { revalidate }` (~60 req/min unauthenticated rate limit).
 * Note: Gamma is geoblocked in some regions; callers should catch
 * `PolymarketApiError` and fall back to fixtures.
 */

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";
const DEFAULT_REVALIDATE_SECONDS = 60;
/** History moves slower than spot prices, and payloads are larger. */
const HISTORY_REVALIDATE_SECONDS = 300;

/**
 * Hosts allowed for `iconUrl`. Must stay in sync with
 * `images.remotePatterns` in next.config.ts — an un-allowlisted host
 * would make next/image throw at render, so unknown hosts fall back
 * to the emoji icon instead.
 */
const ALLOWED_ICON_HOSTS = new Set([
  "polymarket-upload.s3.us-east-2.amazonaws.com",
]);

export class PolymarketApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "PolymarketApiError";
  }
}

/* ------------------------------------------------------------------ */
/* Raw Gamma shapes (only the fields we consume)                       */
/* ------------------------------------------------------------------ */

interface GammaTag {
  id: string;
  label: string;
  slug: string;
}

interface GammaMarket {
  id: string;
  question: string;
  groupItemTitle?: string;
  /** JSON-encoded array, e.g. '["0.97", "0.03"]' */
  outcomePrices?: string;
  /** JSON-encoded array, e.g. '["Yes", "No"]' */
  outcomes?: string;
  volume?: string;
  volumeNum?: number;
  active?: boolean;
  closed?: boolean;
  /** JSON-encoded [yesTokenId, noTokenId] — keys for CLOB price history. */
  clobTokenIds?: string;
  /** 24h price change as a decimal, e.g. -0.0025. Missing on thin markets. */
  oneDayPriceChange?: number;
}

interface GammaEvent {
  id: string;
  slug: string;
  title: string;
  icon?: string;
  image?: string;
  volume?: number;
  volume24hr?: number;
  endDate?: string;
  tags?: GammaTag[];
  markets?: GammaMarket[];
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

/** Tag slugs → app category, checked in order against every event tag. */
const TAG_CATEGORY_MAP: Record<string, Category> = {
  politics: "Politics",
  elections: "Politics",
  sports: "Sports",
  soccer: "Sports",
  nfl: "Sports",
  nba: "Sports",
  mlb: "Sports",
  crypto: "Crypto",
  bitcoin: "Crypto",
  ethereum: "Crypto",
  esports: "Esports",
  finance: "Finance",
  business: "Finance",
  stocks: "Finance",
  geopolitics: "Geopolitics",
  "middle-east": "Geopolitics",
  tech: "Tech",
  ai: "Tech",
  science: "Tech",
  culture: "Culture",
  "pop-culture": "Culture",
  movies: "Culture",
  music: "Culture",
  economy: "Economy",
  fed: "Economy",
  inflation: "Economy",
  weather: "Weather",
  climate: "Weather",
};

const CATEGORY_EMOJI: Record<Category, string> = {
  Trending: "🔥",
  Politics: "🗳️",
  Sports: "🏆",
  Crypto: "₿",
  Esports: "🎮",
  Finance: "📈",
  Geopolitics: "🌍",
  Tech: "🤖",
  Culture: "🎬",
  Economy: "🏦",
  Weather: "🌤️",
};

function categoryFromTags(tags: GammaTag[] | undefined): Category {
  for (const tag of tags ?? []) {
    const match = TAG_CATEGORY_MAP[tag.slug];
    if (match) return match;
  }
  return "Trending";
}

/** First candidate URL whose host is allowlisted for next/image. */
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

/** Parse a Gamma JSON-encoded string array (e.g. '["0.58", "0.42"]'). */
function parseStringArray(raw: string | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

function toMarket(raw: GammaMarket): Market | null {
  const prices = parseStringArray(raw.outcomePrices);
  if (!prices || prices.length < 2) return null;
  const tokenIds = parseStringArray(raw.clobTokenIds);
  return {
    id: raw.id,
    question: raw.question,
    groupItemTitle: raw.groupItemTitle || undefined,
    outcomePrices: [prices[0], prices[1]],
    volume: raw.volume ?? String(raw.volumeNum ?? 0),
    clobTokenId: tokenIds?.[0],
    oneDayPriceChange:
      typeof raw.oneDayPriceChange === "number"
        ? raw.oneDayPriceChange
        : undefined,
  };
}

/** Returns null when the event has no market with usable prices. */
export function toMarketEvent(raw: GammaEvent): MarketEvent | null {
  const markets = (raw.markets ?? [])
    .filter((m) => m.active !== false && m.closed !== true)
    .map(toMarket)
    .filter((m): m is Market => m !== null)
    .sort((a, b) => parseFloat(b.outcomePrices[0]) - parseFloat(a.outcomePrices[0]));
  if (markets.length === 0) return null;

  const category = categoryFromTags(raw.tags);
  const tagLabels = (raw.tags ?? [])
    .map((t) => t.label)
    .filter(
      (label) =>
        !(CATEGORIES as readonly string[]).includes(label) &&
        !/hide from/i.test(label),
    );

  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    icon: CATEGORY_EMOJI[category],
    iconUrl: safeIconUrl(raw.icon, raw.image),
    category,
    tags: tagLabels.length > 0 ? tagLabels.slice(0, 4) : undefined,
    volume: String(raw.volume ?? 0),
    // components expect a date-only string (they append "T00:00:00Z"),
    // but Gamma sends a full ISO timestamp — keep just the date part
    endDate: (raw.endDate ?? "").slice(0, 10),
    markets,
  };
}

/* ------------------------------------------------------------------ */
/* Fetchers                                                            */
/* ------------------------------------------------------------------ */

async function gammaFetch<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const url = new URL(path, GAMMA_BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let res: Response;
  try {
    // no-store: raw Gamma payloads run to ~7MB (> Next's 2MB fetch-cache
    // entry limit). The public fetchers below cache the small normalized
    // result via unstable_cache instead.
    res = await fetch(url, { cache: "no-store" });
  } catch {
    throw new PolymarketApiError(
      `Gamma request failed: ${url.pathname} (network error — Polymarket may be geoblocked in this region)`,
    );
  }
  if (!res.ok) {
    throw new PolymarketApiError(
      `Gamma request failed: ${url.pathname} → HTTP ${res.status}`,
      res.status,
    );
  }
  return res.json();
}

export interface GetEventsOptions {
  limit?: number;
  offset?: number;
  /** Gamma tag slug filter, e.g. "politics", "world-cup". */
  tagSlug?: string;
  /** Sort field, e.g. "volume24hr" (default) or "startDate". */
  order?: string;
}

/**
 * Open events sorted by 24h volume, normalized for the UI.
 * Cached (normalized output only) for DEFAULT_REVALIDATE_SECONDS,
 * keyed by options.
 */
export const getEvents = unstable_cache(
  async (options: GetEventsOptions = {}): Promise<MarketEvent[]> => {
    const { limit = 20, offset = 0, tagSlug, order = "volume24hr" } = options;

    const raw = await gammaFetch<GammaEvent[]>("/events", {
      limit,
      offset,
      closed: false,
      active: true,
      archived: false,
      order,
      ascending: false,
      tag_slug: tagSlug,
    });

    return raw.map(toMarketEvent).filter((e): e is MarketEvent => e !== null);
  },
  ["polymarket-events"],
  { revalidate: DEFAULT_REVALIDATE_SECONDS, tags: ["polymarket"] },
);

/** Single event by its URL slug, or null when not found. Cached like getEvents. */
export const getEventBySlug = unstable_cache(
  async (slug: string): Promise<MarketEvent | null> => {
    const raw = await gammaFetch<GammaEvent[]>("/events", { slug });
    if (raw.length === 0) return null;
    return toMarketEvent(raw[0]);
  },
  ["polymarket-event-by-slug"],
  { revalidate: DEFAULT_REVALIDATE_SECONDS, tags: ["polymarket"] },
);

/* ------------------------------------------------------------------ */
/* Price history (CLOB)                                                */
/* ------------------------------------------------------------------ */

/**
 * Timeframe → CLOB `interval` + `fidelity` (minutes per point). Fidelities
 * are picked so each window returns roughly the point count the charts
 * were designed around; the CLOB rejects fidelities too fine for a long
 * interval (1w/fidelity=1 returns nothing), so these are not arbitrary.
 */
const CLOB_INTERVALS: Record<HistoryWindow, { interval: string; fidelity: number }> = {
  "1H": { interval: "1h", fidelity: 1 },   // ~61 pts
  "6H": { interval: "6h", fidelity: 5 },   // ~73 pts
  "1D": { interval: "1d", fidelity: 15 },  // ~97 pts
  "1W": { interval: "1w", fidelity: 60 },  // ~169 pts
  "1M": { interval: "1m", fidelity: 360 }, // ~121 pts
  ALL: { interval: "max", fidelity: 1440 },// ~1 pt/day
  /** dense window used by the hero chart */
  HERO: { interval: "1m", fidelity: 60 },  // ~720 pts
};

interface ClobHistoryPoint {
  /** unix seconds */
  t: number;
  /** probability 0–1 */
  p: number;
}

/**
 * Real price history for one Yes-token, as {t: ms epoch, p: percent}
 * — the same shape the synthetic series produces, so charts can swap
 * between them. Returns [] when the CLOB has no history for the token.
 */
export const getPriceHistory = unstable_cache(
  async (clobTokenId: string, tf: HistoryWindow): Promise<SeriesPoint[]> => {
    const { interval, fidelity } = CLOB_INTERVALS[tf];
    const url = new URL("/prices-history", CLOB_BASE);
    url.searchParams.set("market", clobTokenId);
    url.searchParams.set("interval", interval);
    url.searchParams.set("fidelity", String(fidelity));

    let res: Response;
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch {
      throw new PolymarketApiError(
        "CLOB request failed (network error — Polymarket may be geoblocked in this region)",
      );
    }
    if (!res.ok) {
      throw new PolymarketApiError(
        `CLOB prices-history failed → HTTP ${res.status}`,
        res.status,
      );
    }

    const body = (await res.json()) as { history?: ClobHistoryPoint[] };
    return (body.history ?? []).map((pt) => ({
      t: pt.t * 1000, // CLOB sends unix seconds; charts use ms
      p: pt.p * 100, // and probabilities 0–1; charts use percent
    }));
  },
  ["polymarket-price-history"],
  { revalidate: HISTORY_REVALIDATE_SECONDS, tags: ["polymarket"] },
);
