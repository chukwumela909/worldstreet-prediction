import { unstable_cache } from "next/cache";
import { API_BASE } from "@/lib/auth-config";
import type { Category, Market, MarketEvent } from "@/types/market";
import { CATEGORIES } from "@/types/market";

/**
 * Server-side data layer for Worldstreet's own markets — the half of
 * the Local book we write ourselves, served by services/api
 * (`GET /v1/markets`, public, no auth) rather than by Bayse.
 *
 * These are fixed odds: an admin sets what each side costs and that is
 * the price until an admin sets another one. There is no maker, no
 * order book and no price history, which is the one visible difference
 * from a Bayse event — the detail page skips the chart.
 *
 * Prices arrive as kobo per ₦100 share (the unit the book trades in)
 * and are converted here to the app's decimal-string convention, so
 * every component downstream treats them exactly like a Bayse or
 * Polymarket price. Note the pair sums to more than 1 by design: the
 * overround is the house margin, and the percentage a card shows is
 * the price someone actually pays, not a normalized probability.
 */

const REVALIDATE_SECONDS = 30;
/**
 * A page render waits on this. Without a deadline an API that hangs
 * rather than refusing takes the render with it — and these sit beside
 * the Bayse feed, which is the whole reason a failure here returns null
 * instead of throwing.
 */
const FETCH_TIMEOUT_MS = 10_000;
/** Detail-page polling — the desk can reprice mid-session. */
const LIVE_REVALIDATE_SECONDS = 10;

/**
 * What a winning share pays, in kobo. Declared here rather than
 * imported from lib/local-trades: that module is `"use client"`, and a
 * plain constant read out of one from a server component comes back
 * undefined, which turns every price on the page into NaN.
 */
const PAYOUT_PER_SHARE_KOBO = 10_000;

interface ApiOutcome {
  id: string;
  label: string;
  priceKobo: number;
}

interface ApiMarket {
  id: string;
  title: string;
  rules: string;
  status: string;
  outcomes: ApiOutcome[];
}

interface ApiEvent {
  id: string;
  slug: string;
  title: string;
  category: string;
  description: string;
  imageUrl: string;
  resolutionSource: string;
  status: string;
  closesAt: string | null;
  resolutionDate: string | null;
  trades: number;
  stakedKobo: number;
  markets: ApiMarket[];
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

function toCategory(raw: string): Category {
  return (CATEGORIES as readonly string[]).includes(raw)
    ? (raw as Category)
    : "Trending";
}

/** Kobo per ₦100 share → the app's decimal-string price ("0.55"). */
function toDecimal(priceKobo: number): string {
  return String(priceKobo / PAYOUT_PER_SHARE_KOBO);
}

function toMarket(raw: ApiMarket, single: boolean, eventTitle: string): Market | null {
  const [yes, no] = raw.outcomes;
  if (!yes || !no) return null;
  return {
    id: raw.id,
    // same convention as Bayse's SINGLE_MARKET events: the real question
    // lives on the event, and a market title only means something when
    // there is more than one of them
    question: single ? eventTitle : raw.title,
    groupItemTitle: single ? undefined : raw.title,
    outcomePrices: [toDecimal(yes.priceKobo), toDecimal(no.priceKobo)],
    volume: "0",
    outcomeLabels:
      yes.label !== "Yes" || no.label !== "No" ? [yes.label, no.label] : undefined,
    outcomeIds: [yes.id, no.id],
    rules: raw.rules || undefined,
  };
}

/** Null when the event has nothing tradeable or displayable on it. */
export function toWorldstreetEvent(raw: ApiEvent): MarketEvent | null {
  const tradeable = raw.markets.filter((m) => m.status !== "cancelled");
  const single = tradeable.length === 1;
  const markets = tradeable
    .map((m) => toMarket(m, single, raw.title))
    .filter((m): m is Market => m !== null);
  if (markets.length === 0) return null;

  const closes = raw.closesAt || raw.resolutionDate || "";
  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    icon: "🏛️",
    iconUrl: raw.imageUrl || undefined,
    category: toCategory(raw.category),
    tags: ["Worldstreet"],
    volume: "0",
    endDate: closes.slice(0, 10),
    closesAt: closes || undefined,
    markets,
    source: "worldstreet",
    trades: raw.trades,
    // the house is the counterparty, so there is no pool — what a card
    // can honestly show is what has been staked into it
    stakedNgn: String(raw.stakedKobo / 100),
    description: raw.description || undefined,
    resolutionSource: raw.resolutionSource || undefined,
    /** Closed markets still render; the panel refuses the trade. */
    tradingOpen: raw.status === "open",
  };
}

/* ------------------------------------------------------------------ */
/* Fetchers                                                            */
/* ------------------------------------------------------------------ */

async function apiGet<T>(path: string): Promise<T | null> {
  if (!API_BASE) return null; // API not wired in this environment
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Every listed Worldstreet market, soonest to close first. Returns an
 * empty list rather than throwing when the API is unset or down: these
 * sit alongside the Bayse feed on the Local tab, and one book being
 * unreachable must not blank the other.
 */
export const getWorldstreetEvents = unstable_cache(
  async (): Promise<MarketEvent[]> => {
    const body = await apiGet<{ data?: { events?: ApiEvent[] } }>("/v1/markets");
    // every level is optional on purpose: a proxy or an older build of
    // the API can answer 200 with an envelope this doesn't recognise,
    // and reaching blindly through it would throw inside the cache and
    // take the page down instead of leaving the Bayse feed on it
    return (body?.data?.events ?? [])
      .map(toWorldstreetEvent)
      .filter((e): e is MarketEvent => e !== null);
  },
  ["worldstreet-events"],
  { revalidate: REVALIDATE_SECONDS, tags: ["worldstreet"] },
);

async function fetchBySlug(slug: string): Promise<MarketEvent | null> {
  const body = await apiGet<{ data?: { event?: ApiEvent } }>(
    `/v1/markets/slug/${encodeURIComponent(slug)}`,
  );
  const event = body?.data?.event;
  return event ? toWorldstreetEvent(event) : null;
}

/** One Worldstreet market by slug, or null when it isn't one of ours. */
export const getWorldstreetEventBySlug = unstable_cache(
  fetchBySlug,
  ["worldstreet-event-by-slug"],
  { revalidate: REVALIDATE_SECONDS, tags: ["worldstreet"] },
);

/** Same event on the short cache the detail-page poller reads. */
export const getWorldstreetEventLive = unstable_cache(
  fetchBySlug,
  ["worldstreet-event-live"],
  { revalidate: LIVE_REVALIDATE_SECONDS, tags: ["worldstreet"] },
);
