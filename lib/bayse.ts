import { unstable_cache } from "next/cache";
import type { Category, Market, MarketEvent } from "@/types/market";
import type { SeriesPoint } from "@/lib/series";

/**
 * Server-side data layer for the Bayse Relay API
 * (https://relay.bayse.markets — public, no auth for event reads), the
 * source behind the "Local" category tab: Nigerian/African prediction
 * markets displayed alongside the Polymarket feed.
 *
 * Display-only for now — Bayse events carry `source: "bayse"` so the UI
 * can skip affordances that assume a Polymarket slug (watchlist, live
 * price polling) and route their detail pages to /local/[slug].
 * Trading comes later via the partner API.
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
    // as display-only rather than sending a half-formed order
    outcomeIds:
      raw.outcome1Id && raw.outcome2Id
        ? [raw.outcome1Id, raw.outcome2Id]
        : undefined,
    rules: raw.rules || undefined,
  };
}

/** Returns null when the event has no open market with usable prices. */
export function toBayseMarketEvent(raw: BayseEvent): MarketEvent | null {
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

  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    icon: "🌍",
    iconUrl: safeIconUrl(raw.imageUrl, raw.image128Url),
    category,
    tags: tags.length > 0 ? tags.slice(0, 4) : undefined,
    volume: String(raw.totalVolume ?? 0),
    endDate: (raw.closingDate || raw.resolutionDate || "").slice(0, 10),
    closesAt: raw.closingDate || raw.resolutionDate || undefined,
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

/**
 * Open Bayse events in the API's own (trending-ish) order, normalized
 * for the UI. Relay caps pages at 20, so two pages are fetched to fill
 * the grid. Cached (normalized output only) like the Polymarket layer.
 */
export const getBayseEvents = unstable_cache(
  async (): Promise<MarketEvent[]> => {
    const pages = await Promise.all(
      [1, 2].map((page) =>
        relayFetch<{ events?: BayseEvent[] }>("/v1/pm/events", {
          page,
          size: 20,
          status: "open",
          currency: "NGN",
        }),
      ),
    );
    return pages
      .flatMap((p) => p.events ?? [])
      .map(toBayseMarketEvent)
      .filter((e): e is MarketEvent => e !== null);
  },
  ["bayse-events"],
  { revalidate: DEFAULT_REVALIDATE_SECONDS, tags: ["bayse"] },
);

/** Single Bayse event by its URL slug, or null when not found. */
export const getBayseEventBySlug = unstable_cache(
  async (slug: string): Promise<MarketEvent | null> => {
    let raw: BayseEvent;
    try {
      raw = await relayFetch<BayseEvent>(
        `/v1/pm/events/slug/${encodeURIComponent(slug)}`,
        { currency: "NGN" },
      );
    } catch (err) {
      if (err instanceof BayseApiError && err.status === 404) return null;
      throw err;
    }
    return toBayseMarketEvent(raw);
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
    try {
      raw = await relayFetch<BayseEvent>(
        `/v1/pm/events/slug/${encodeURIComponent(slug)}`,
        { currency: "NGN" },
      );
    } catch (err) {
      if (err instanceof BayseApiError && err.status === 404) return null;
      throw err;
    }
    return toBayseMarketEvent(raw);
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
