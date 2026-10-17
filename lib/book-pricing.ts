import { unstable_cache } from "next/cache";
import { API_BASE } from "@/lib/auth-config";
import { DEFAULT_MAX_STAKE_KOBO, DEFAULT_MIN_STAKE_KOBO } from "@/lib/book";

/**
 * The book's pricing parameters, read from the API — the one place they
 * are set (an admin edits them on the API's Settings; it publishes them
 * at GET /v1/markets/pricing, public, no auth). Server-only: the root
 * layout loads this and hands it to client components through
 * <BookPricingProvider> (components/book-pricing.tsx).
 *
 * `null` when the API isn't configured (no NEXT_PUBLIC_API_URL) or
 * answers non-2xx — an API deployed before this endpoint existed answers
 * 404. Null reads as "international trading off": Polymarket markets
 * stay display-only mirrors and the stake limits fall back to the API's
 * defaults.
 */
export interface BookPricing {
  /** The admin switch: international (Polymarket) markets take orders. */
  internationalTrading: boolean;
  /**
   * Basis points of a ₦100 share added to Polymarket's price on each
   * side (300 = 3 points: 60% sells at ₦63) — see lib/book.ts.
   */
  polymarketSpreadBps: number;
  /** Smallest stake one order may carry, kobo. */
  minStakeKobo: number;
  /** Largest stake one order may carry, kobo. */
  maxStakeKobo: number;
}

const FETCH_TIMEOUT_MS = 2_500;
/** A spread past this would price every share at the ceiling. */
const MAX_SPREAD_BPS = 9_900;

/**
 * Last good answer this server instance saw, kept through network blips
 * and malformed bodies. A definite non-2xx answer clears it.
 */
let lastGood: BookPricing | null = null;

const isKobo = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

/** The API's `data`, or null when it doesn't carry a usable spread. */
function parsePricing(data: unknown): BookPricing | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  const bps = d.polymarketSpreadBps;
  if (typeof bps !== "number" || !Number.isInteger(bps) || bps < 0 || bps > MAX_SPREAD_BPS) {
    return null;
  }
  let minStakeKobo = isKobo(d.minStakeKobo) ? d.minStakeKobo : DEFAULT_MIN_STAKE_KOBO;
  let maxStakeKobo = isKobo(d.maxStakeKobo) ? d.maxStakeKobo : DEFAULT_MAX_STAKE_KOBO;
  if (minStakeKobo > maxStakeKobo) {
    minStakeKobo = DEFAULT_MIN_STAKE_KOBO;
    maxStakeKobo = DEFAULT_MAX_STAKE_KOBO;
  }
  return {
    // only an explicit `true` opens the book — absent or anything else is off
    internationalTrading: d.internationalTrading === true,
    polymarketSpreadBps: bps,
    minStakeKobo,
    maxStakeKobo,
  };
}

async function fetchPricing(): Promise<BookPricing | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/markets/pricing`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      // the API answered, and not with pricing (an older deploy 404s):
      // that's "off", not a blip to ride out
      lastGood = null;
      return null;
    }
    const body = (await res.json()) as { data?: unknown } | null;
    const pricing = parsePricing(body?.data);
    if (!pricing) return lastGood;
    lastGood = pricing;
    return pricing;
  } catch {
    // timeout, network error, or a body that isn't JSON
    return lastGood;
  }
}

/**
 * Cached for a minute and served stale while it refreshes, so the root
 * layout never waits on the API once it has answered once, and an
 * admin's change reaches new page loads within about a minute — no
 * rebuild. (That revalidate also makes prerendered pages regenerate on
 * the same minute, which is how the switch reaches them.) A failed read
 * is cached too (as the last good value, or null), never retried on
 * every request, which would hold every page behind the timeout.
 */
const getCachedPricing = unstable_cache(
  fetchPricing,
  // the shape changed from the parked `international-book` version —
  // a new key so a cached entry of the old shape is never served
  ["book-pricing-v2", API_BASE],
  { revalidate: 60, tags: ["book-pricing"] },
);

/** The API's pricing, or null — at once, with no cache entry, when no API is configured. */
export async function getBookPricing(): Promise<BookPricing | null> {
  if (!API_BASE) return null; // API not wired in this environment
  return getCachedPricing();
}
