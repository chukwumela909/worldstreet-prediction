import { unstable_cache } from "next/cache";
import type { Category, Market, MarketEvent } from "@/types/market";

/**
 * Server-side data layer for the Bayse Relay API
 * (https://relay.bayse.markets — public, no auth for event reads), the
 * source behind the "Local" category tab: Nigerian/African prediction
 * markets displayed alongside the Polymarket feed.
 *
 * Display-only for now — Bayse events carry `source: "bayse"` so the UI
 * can skip affordances that assume a Polymarket slug (event page link,
 * watchlist, live price polling). Trading comes later via the partner
 * API.
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
const DEFAULT_REVALIDATE_SECONDS = 60;

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
  outcome1Label?: string;
  outcome1Price?: number;
  outcome2Label?: string;
  outcome2Price?: number;
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
  hashtags?: string[];
  markets?: BayseMarket[];
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
  return {
    id: raw.id,
    question: single ? eventTitle : raw.title,
    groupItemTitle: single ? undefined : raw.title,
    outcomePrices: [String(yes), String(no)],
    // Relay reports volume per event, not per market
    volume: "0",
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
    markets,
    source: "bayse",
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
    res = await fetch(url, { cache: "no-store" });
  } catch {
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
