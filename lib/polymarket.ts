import { unstable_cache } from "next/cache";
import type { Category, Market, MarketEvent } from "@/types/market";
import { CATEGORIES } from "@/types/market";
import type { HistoryWindow, SeriesPoint } from "@/lib/series";
import { deriveHotTopics, type HotTopic } from "@/lib/hot-topics";

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
 * Note: Gamma is geoblocked in some regions; there is deliberately no
 * fixture fallback — callers surface an error/empty state instead, so
 * the UI never presents fabricated data as market data.
 */

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";
const DATA_API_BASE = "https://data-api.polymarket.com";
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
  /** Polymarket's own "don't surface this tag" flag. */
  forceHide?: boolean;
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
  /** On-chain condition id — the key for data-api holders/trades. */
  conditionId?: string;
  /** 24h price change as a decimal, e.g. -0.0025. Missing on thin markets. */
  oneDayPriceChange?: number;
  /** "moneyline" | "spreads" | "totals" | ... on sports game markets. */
  sportsMarketType?: string;
  /** Spread/total line, e.g. 2.5. */
  line?: number;
  /** "2026-07-20 17:00:00+00" on sports game markets. */
  gameStartTime?: string;
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
  series?: { title?: string }[];
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
    conditionId: raw.conditionId,
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
  params: Record<string, string | number | boolean | string[] | undefined>,
): Promise<T> {
  const url = new URL(path, GAMMA_BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    // Gamma takes repeated keys for multi-value filters (?slug=a&slug=b)
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, String(value));
    }
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

/**
 * Several events in one call, for clients holding a set of slugs (open
 * positions, watchlist). Unknown slugs are omitted rather than erroring,
 * so a mix of live and fixture slugs returns just the live ones.
 */
export const getEventsBySlugs = unstable_cache(
  async (slugs: string[]): Promise<MarketEvent[]> => {
    if (slugs.length === 0) return [];
    const raw = await gammaFetch<GammaEvent[]>("/events", { slug: slugs });
    return raw.map(toMarketEvent).filter((e): e is MarketEvent => e !== null);
  },
  ["polymarket-events-by-slugs"],
  { revalidate: DEFAULT_REVALIDATE_SECONDS, tags: ["polymarket"] },
);

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

interface GammaComment {
  id: string;
  body?: string;
  createdAt?: string;
  reportCount?: number;
  profile?: {
    name?: string;
    pseudonym?: string;
    displayUsernamePublic?: boolean;
    profileImage?: string;
    baseAddress?: string;
  };
}

/** A comment normalized for display (hero marquee, event tabs). */
export interface EventComment {
  id: string;
  user: string;
  text: string;
  /** Real avatar when allowlisted; otherwise render the hue gradient. */
  avatarUrl?: string;
  /** Deterministic per-user hue for the gradient avatar fallback. */
  hue: number;
  /** ms epoch of the comment, for "2h ago" labels. */
  createdAt?: number;
}

/**
 * Accounts without a chosen username get "0x<40 hex>-<timestamp>" as
 * their name; display it truncated the way Polymarket does (0xEfF3…1c83).
 */
function shortenAddressName(name: string): string {
  const m = name.match(/^(0x[0-9a-fA-F]{40})/);
  if (!m) return name;
  const addr = m[1];
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Small stable hash → hue, so a user's fallback avatar color sticks. */
function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

/**
 * Filter + normalize raw comments. Drops anything reported (Gamma leaves
 * spam like "passive income via copy trading" flagged but published),
 * near-empty bodies, and repeat commenters; honors displayUsernamePublic
 * by falling back to Polymarket's anonymous pseudonym.
 */
export function toEventComments(raw: GammaComment[], limit = 8): EventComment[] {
  const seen = new Set<string>();
  const out: EventComment[] = [];
  for (const c of raw) {
    if (out.length >= limit) break;
    const text = (c.body ?? "").trim();
    if ((c.reportCount ?? 0) > 0 || text.length < 20) continue;
    const p = c.profile ?? {};
    const user = shortenAddressName(
      (p.displayUsernamePublic ? p.name : p.pseudonym) ||
        p.pseudonym ||
        "anonymous",
    );
    const dedupeKey = p.baseAddress ?? user;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const created = c.createdAt ? Date.parse(c.createdAt) : NaN;
    out.push({
      id: c.id,
      user,
      text,
      avatarUrl: safeIconUrl(p.profileImage),
      hue: hueFor(dedupeKey),
      createdAt: Number.isNaN(created) ? undefined : created,
    });
  }
  return out;
}

/** Recent comments on an event, filtered for display. */
export const getComments = unstable_cache(
  async (eventId: string): Promise<EventComment[]> => {
    const raw = await gammaFetch<GammaComment[]>("/comments", {
      parent_entity_type: "Event",
      parent_entity_id: eventId,
      limit: 40,
      order: "createdAt",
      ascending: false,
    });
    return toEventComments(raw);
  },
  ["polymarket-comments"],
  { revalidate: DEFAULT_REVALIDATE_SECONDS, tags: ["polymarket"] },
);

/**
 * Hot topics ranked by real 24h volume.
 *
 * Aggregates over a wider sample than the grid shows, since a topic's
 * volume is spread across many events. Derived from the raw payload —
 * `toMarketEvent` drops volume24hr and the tag flags the ranking needs.
 */
export const getHotTopics = unstable_cache(
  async (limit = 5): Promise<HotTopic[]> => {
    const raw = await gammaFetch<GammaEvent[]>("/events", {
      limit: 100,
      closed: false,
      active: true,
      archived: false,
      order: "volume24hr",
      ascending: false,
    });
    return deriveHotTopics(raw, limit);
  },
  ["polymarket-hot-topics"],
  // a slower-moving aggregate than spot prices; also keeps this extra
  // wide fetch well clear of Gamma's ~60 req/min ceiling
  { revalidate: HISTORY_REVALIDATE_SECONDS, tags: ["polymarket"] },
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

/* ------------------------------------------------------------------ */
/* Data API (holders, trades, leaderboard)                             */
/* ------------------------------------------------------------------ */

async function dataApiFetch<T>(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(path, DATA_API_BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    throw new PolymarketApiError(
      `Data API request failed: ${url.pathname} (network error — Polymarket may be geoblocked in this region)`,
    );
  }
  if (!res.ok) {
    throw new PolymarketApiError(
      `Data API request failed: ${url.pathname} → HTTP ${res.status}`,
      res.status,
    );
  }
  return res.json();
}

/** Display identity shared by holders / trades / leaderboard rows. */
export interface TraderIdentity {
  name: string;
  avatarUrl?: string;
  hue: number;
}

interface DataApiProfileFields {
  name?: string;
  pseudonym?: string;
  displayUsernamePublic?: boolean;
  profileImage?: string;
  proxyWallet?: string;
}

function toIdentity(p: DataApiProfileFields): TraderIdentity {
  const name = shortenAddressName(
    (p.displayUsernamePublic === false ? p.pseudonym : p.name) ||
      p.pseudonym ||
      p.proxyWallet ||
      "anonymous",
  );
  return {
    name,
    avatarUrl: safeIconUrl(p.profileImage),
    hue: hueFor(p.proxyWallet ?? name),
  };
}

interface DataApiHolder extends DataApiProfileFields {
  amount: number;
  outcomeIndex: number;
}

export interface MarketHolder extends TraderIdentity {
  /** shares held */
  amount: number;
}

/**
 * Top holders per side of one market (by condition id):
 * `{ yes: [...], no: [...] }`, largest first.
 */
export const getTopHolders = unstable_cache(
  async (
    conditionId: string,
    limit = 5,
  ): Promise<{ yes: MarketHolder[]; no: MarketHolder[] }> => {
    const raw = await dataApiFetch<{ holders?: DataApiHolder[] }[]>("/holders", {
      market: conditionId,
      limit,
    });
    const sides: [MarketHolder[], MarketHolder[]] = [[], []];
    for (const token of raw ?? []) {
      for (const h of token.holders ?? []) {
        const side = h.outcomeIndex === 0 ? 0 : 1;
        if (sides[side].length >= limit) continue;
        sides[side].push({ ...toIdentity(h), amount: h.amount });
      }
    }
    for (const side of sides) side.sort((a, b) => b.amount - a.amount);
    return { yes: sides[0], no: sides[1] };
  },
  ["polymarket-holders"],
  { revalidate: DEFAULT_REVALIDATE_SECONDS, tags: ["polymarket"] },
);

interface DataApiTrade extends DataApiProfileFields {
  side: "BUY" | "SELL";
  size: number;
  price: number;
  timestamp: number;
  outcome?: string;
  outcomeIndex?: number;
  transactionHash?: string;
}

export interface EventTrade extends TraderIdentity {
  side: "BUY" | "SELL";
  /** shares traded */
  size: number;
  /** price in [0, 1] */
  price: number;
  /** ms epoch */
  timestamp: number;
  /** outcome label, e.g. "Yes" or a team name */
  outcome: string;
  outcomeIndex: number;
  id: string;
}

/** Recent trades across an event's markets, newest first. */
export const getEventTrades = unstable_cache(
  async (eventId: string, limit = 15): Promise<EventTrade[]> => {
    // NB: the filter param is `eventId` — a bare `event` param is
    // silently ignored and returns the global trade feed
    const raw = await dataApiFetch<DataApiTrade[]>("/trades", {
      eventId,
      limit,
    });
    return (raw ?? []).map((t, i) => ({
      ...toIdentity(t),
      side: t.side,
      size: t.size,
      price: t.price,
      timestamp: t.timestamp * 1000,
      outcome: t.outcome ?? "Yes",
      outcomeIndex: t.outcomeIndex ?? 0,
      id: t.transactionHash ?? `${t.timestamp}-${i}`,
    }));
  },
  ["polymarket-trades"],
  { revalidate: DEFAULT_REVALIDATE_SECONDS, tags: ["polymarket"] },
);

export const LEADERBOARD_WINDOWS = ["1d", "1w", "30d", "all"] as const;
export type LeaderboardWindow = (typeof LEADERBOARD_WINDOWS)[number];
export type LeaderboardRankType = "pnl" | "vol";

interface DataApiLeaderboardRow {
  rank: string;
  proxyWallet?: string;
  userName?: string;
  pseudonym?: string;
  profileImage?: string;
  vol?: number;
  pnl?: number;
}

export interface LeaderboardTrader extends TraderIdentity {
  rank: number;
  profit: number;
  volume: number;
}

/** Ranked traders by profit or volume over a window. */
export const getLeaderboard = unstable_cache(
  async (
    window: LeaderboardWindow,
    rankType: LeaderboardRankType,
    limit = 30,
  ): Promise<LeaderboardTrader[]> => {
    const raw = await dataApiFetch<DataApiLeaderboardRow[]>("/v1/leaderboard", {
      window,
      rankType,
      limit,
    });
    return (raw ?? []).map((r, i) => ({
      ...toIdentity({
        name: r.userName,
        pseudonym: r.pseudonym,
        profileImage: r.profileImage,
        proxyWallet: r.proxyWallet,
      }),
      rank: Number(r.rank) || i + 1,
      profit: r.pnl ?? 0,
      volume: r.vol ?? 0,
    }));
  },
  ["polymarket-leaderboard"],
  // rankings move slowly; also keeps the 8 window×sort combos cheap
  { revalidate: HISTORY_REVALIDATE_SECONDS, tags: ["polymarket"] },
);

/* ------------------------------------------------------------------ */
/* Featured game (hero slide)                                          */
/* ------------------------------------------------------------------ */

export interface GamePick {
  label: string;
  /** price in [0, 1] */
  price: number;
}

export interface GameLineGroup {
  /** all lines available, e.g. ["1.5", "2.5"] */
  lines: string[];
  /** the line the options below belong to */
  active: string;
  options: [GamePick, GamePick];
}

export interface FeaturedGame {
  breadcrumb: string;
  title: string;
  slug: string;
  /** preformatted in ET, e.g. "1:00 PM" / "July 20" — formatted
   * server-side so SSR and hydration agree regardless of viewer TZ */
  kickoff: string;
  date: string;
  home: { name: string; pct: number };
  draw?: { pct: number };
  away: { name: string; pct: number };
  spread?: GameLineGroup;
  total?: GameLineGroup;
  /** USD volume as a decimal string */
  volume: string;
  iconUrl?: string;
}

const yesPrice = (m: GammaMarket): number => {
  const prices = parseStringArray(m.outcomePrices);
  return prices ? parseFloat(prices[0]) : NaN;
};

/** Group spreads/totals markets into the picker-row shape. */
function toLineGroup(markets: GammaMarket[], suffix: (line: number, i: number) => string): GameLineGroup | undefined {
  const byLine = new Map<number, GammaMarket>();
  for (const m of markets) {
    if (typeof m.line !== "number") continue;
    if (!byLine.has(m.line)) byLine.set(m.line, m);
  }
  if (byLine.size === 0) return undefined;
  const lines = [...byLine.keys()].sort((a, b) => Math.abs(a) - Math.abs(b));
  // the most competitive line — outcome prices closest to a coin flip
  const active = lines.reduce((best, l) =>
    Math.abs(yesPrice(byLine.get(l)!) - 0.5) < Math.abs(yesPrice(byLine.get(best)!) - 0.5) ? l : best,
  );
  const market = byLine.get(active)!;
  const outcomes = parseStringArray(market.outcomes) ?? ["", ""];
  const prices = parseStringArray(market.outcomePrices) ?? ["0", "0"];
  return {
    lines: lines.map((l) => String(Math.abs(l))),
    active: String(Math.abs(active)),
    options: [
      { label: `${outcomes[0]} ${suffix(active, 0)}`.trim(), price: parseFloat(prices[0]) },
      { label: `${outcomes[1]} ${suffix(active, 1)}`.trim(), price: parseFloat(prices[1]) },
    ],
  };
}

/**
 * Highest-volume upcoming soccer game for the hero slide. Soccer, because
 * the slide's layout is a three-way moneyline (home/draw/away); spread and
 * total rows come from the sibling "<slug>-more-markets" event when it
 * exists. Returns null when no game qualifies.
 */
export const getFeaturedGame = unstable_cache(
  async (): Promise<FeaturedGame | null> => {
    const raw = await gammaFetch<GammaEvent[]>("/events", {
      limit: 25,
      closed: false,
      active: true,
      archived: false,
      order: "volume24hr",
      ascending: false,
      tag_slug: "soccer",
    });

    const now = Date.now();
    for (const event of raw) {
      const moneylines = (event.markets ?? []).filter(
        (m) => m.sportsMarketType === "moneyline" && m.active !== false && m.closed !== true,
      );
      if (moneylines.length !== 3) continue; // home / draw / away
      const draw = moneylines.find((m) => m.groupItemTitle?.startsWith("Draw"));
      const teams = moneylines.filter((m) => m !== draw);
      if (!draw || teams.length !== 2) continue;

      // Gamma sends "2026-07-20 17:00:00+00" — not quite ISO; normalize
      // the space and the truncated offset before parsing
      const start = teams[0].gameStartTime
        ? Date.parse(
            teams[0].gameStartTime.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"),
          )
        : NaN;
      if (Number.isNaN(start) || start < now) continue; // kickoff still ahead

      // match button order to the title ("Home vs. Away")
      const [homeName] = event.title.split(/ vs\.? /i);
      const home =
        teams.find((m) => m.groupItemTitle === homeName?.trim()) ?? teams[0];
      const away = teams.find((m) => m !== home)!;

      // spreads/totals live in a sibling event; absent for smaller games
      let spread: GameLineGroup | undefined;
      let total: GameLineGroup | undefined;
      try {
        const more = await gammaFetch<GammaEvent[]>("/events", {
          slug: `${event.slug}-more-markets`,
        });
        const moreMarkets = (more[0]?.markets ?? []).filter(
          (m) => m.active !== false && m.closed !== true,
        );
        spread = toLineGroup(
          moreMarkets.filter((m) => m.sportsMarketType === "spreads"),
          (line, i) => (i === 0 ? `${line}` : `+${Math.abs(line)}`),
        );
        total = toLineGroup(
          moreMarkets.filter((m) => m.sportsMarketType === "totals"),
          () => "",
        );
      } catch {
        // no sibling event — render the moneyline row alone
      }

      const league = event.series?.[0]?.title;
      const kickoffFmt = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      });
      const dateFmt = new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        timeZone: "America/New_York",
      });

      return {
        breadcrumb: ["Sports", "Soccer", league].filter(Boolean).join(" · "),
        title: event.title,
        slug: event.slug,
        kickoff: `${kickoffFmt.format(start)} ET`,
        date: dateFmt.format(start),
        home: { name: home.groupItemTitle ?? "Home", pct: Math.round(yesPrice(home) * 100) },
        draw: { pct: Math.round(yesPrice(draw) * 100) },
        away: { name: away.groupItemTitle ?? "Away", pct: Math.round(yesPrice(away) * 100) },
        spread,
        total,
        volume: String(event.volume ?? 0),
        iconUrl: safeIconUrl(event.icon, event.image),
      };
    }
    return null;
  },
  ["polymarket-featured-game"],
  { revalidate: DEFAULT_REVALIDATE_SECONDS, tags: ["polymarket"] },
);
