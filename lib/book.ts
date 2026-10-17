import { isLocalBook, type MarketEvent } from "@/types/market";
import { formatNaira, toMultiplier } from "@/lib/format";

/**
 * Prices on WorldStreet's book — what one ₦100 share actually costs here,
 * which is what every buy button, payout multiple and stake form shows.
 *
 * Local markets (Bayse-fed and our own) trade at their own price.
 * International ones (Polymarket) trade only while the API's
 * international-trading switch is on, at Polymarket's price plus the
 * house spread on both sides. The switch and the spread are the API's —
 * published at GET /v1/markets/pricing, read by lib/book-pricing.ts and
 * handed down by <BookPricingProvider> — so components call these
 * through `useQuote()`, which passes the spread only while the switch is
 * on. With it off (or no API at all) the spread is null: international
 * markets are display-only mirrors, with no quote here and a payout
 * multiple read off Polymarket's own price.
 *
 * The API applies the same rule when it re-prices an order
 * (services/api/src/trading/polymarket/pricing.ts), so what the visitor
 * is quoted is what fills; if they ever disagree, the API answers
 * PRICE_MOVED with its price and the stake form asks to confirm it.
 */

/** Kobo per share (10 000 = ₦100) — what a winning share pays. */
const PAYOUT_PER_SHARE_KOBO = 10_000;
/** The API's ceiling: a share must always pay more than it costs. */
const MAX_PRICE_KOBO = 9_900;

/** The API's stake limits when it publishes none (its own defaults: ₦100–₦50,000). */
export const DEFAULT_MIN_STAKE_KOBO = 10_000;
export const DEFAULT_MAX_STAKE_KOBO = 5_000_000;

/**
 * What a share of this outcome costs on our book, in kobo. 0 when it
 * can't be bought here: any international outcome while international
 * trading is off (spread null), or one at or past certainty.
 */
export function quoteKobo(
  event: Pick<MarketEvent, "source">,
  decimalPrice: string,
  spreadBps: number | null,
): number {
  const p = parseFloat(decimalPrice);
  if (!Number.isFinite(p)) return 0;
  if (isLocalBook(event)) return Math.round(p * PAYOUT_PER_SHARE_KOBO);
  if (spreadBps === null || p <= 0 || p >= 1) return 0;
  const priced = Math.round(p * PAYOUT_PER_SHARE_KOBO) + spreadBps;
  return Math.min(Math.max(priced, 1), MAX_PRICE_KOBO);
}

/** A quote for display: "₦61.00", or "—" when there's no quote (0). */
export function formatQuote(kobo: number): string {
  return kobo > 0 ? formatNaira(kobo) : "—";
}

/**
 * Gross payout per unit staked — "1.64x". From our quote when the
 * outcome trades here; an international market that's only mirrored
 * (spread null) reads it off Polymarket's price (lib/format's
 * toMultiplier, same rounding).
 */
export function quoteMultiplier(
  event: Pick<MarketEvent, "source">,
  decimalPrice: string,
  spreadBps: number | null,
): string {
  if (!isLocalBook(event) && spreadBps === null) return toMultiplier(decimalPrice);
  const kobo = quoteKobo(event, decimalPrice, spreadBps);
  if (kobo <= 0 || kobo >= PAYOUT_PER_SHARE_KOBO) return "—";
  const m = PAYOUT_PER_SHARE_KOBO / kobo;
  const digits = m < 10 ? 2 : m < 100 ? 1 : 0;
  return `${m.toFixed(digits)}x`;
}

/**
 * The market page for a position or desk row, from its event or market
 * id: Polymarket's are all digits, the Local book's are UUIDs.
 */
export function bookHref(slug: string, eventOrMarketId: string): string {
  return marketHref(slug, /^\d+$/.test(eventOrMarketId) ? "polymarket" : "local");
}

/** The market page for an event or position: Local book under /local. */
export function marketHref(
  slug: string,
  book: Pick<MarketEvent, "source"> | "local" | "polymarket",
): string {
  const local = typeof book === "string" ? book === "local" : isLocalBook(book);
  return local ? `/local/${slug}` : `/event/${slug}`;
}
