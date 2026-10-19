import { isLocalBook, type MarketEvent } from "@/types/market";
import type { BookPricing } from "@/lib/book-pricing";
import { formatNaira, toMultiplier } from "@/lib/format";

/**
 * Prices on WorldStreet's book — what one ₦100 share actually costs here,
 * which is what every buy button, payout multiple and stake form shows.
 * WorldStreet is the house on every bet, so every price carries its
 * margin:
 *
 * - **Base margin, by source.** A Bayse market sells at Bayse's price
 *   plus `localSpreadBps`; one of our own (`source: "worldstreet"`) at
 *   the desk's price as set — it already carries the desk's margin; an
 *   international (Polymarket) one at Polymarket's price plus
 *   `polymarketSpreadBps`, and only while the API's international
 *   switch is on — off, it's a display-only mirror with no quote here.
 * - **Auto-rise.** On the side of a market where the house stands to
 *   lose, the API raises the price 1 point for every
 *   `autoSpreadStepKobo` it stands to lose, with no cap short of the
 *   ₦99 ceiling. The API computes that per
 *   outcome; the bet slip and the market page's outcome rows read it
 *   from GET /v1/markets/rises (lib/use-market-rises.ts) and pass it in
 *   as `riseBps`. Board surfaces (cards, lists) show the base price.
 *
 * All of it is the API's — published at GET /v1/markets/pricing, read by
 * lib/book-pricing.ts and handed down by <BookPricingProvider> — so
 * components call these through `useQuote()`. Pricing null (no API, an
 * API too old to publish it, one that errored) quotes Local markets at
 * their raw price, rises ignored — never a margin the API might not
 * charge — and international ones not at all.
 *
 * The API applies the same rule when it re-prices an order, so what the
 * visitor is quoted is what fills; if they ever disagree, the API answers
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
 * The house's base margin on this event's outcomes, in basis points of
 * a ₦100 share — or null when it can't be bought here at all (an
 * international event while international trading is off, or pricing
 * unknown).
 */
export function baseSpreadBps(
  event: Pick<MarketEvent, "source">,
  pricing: BookPricing | null,
): number | null {
  if (event.source === "worldstreet") return 0; // desk-priced, margin built in
  if (event.source === "bayse") return pricing?.localSpreadBps ?? 0;
  return pricing?.internationalTrading === true ? pricing.polymarketSpreadBps : null;
}

/**
 * The API's price rule, in kobo: the source's raw price plus the base
 * margin and the auto-rise, capped at the ceiling. 0 — not sold — for an
 * outcome at or past certainty, or one with no room left for a margin.
 */
export function marginedPriceKobo(rawKobo: number, baseBps: number, riseBps: number): number {
  if (rawKobo <= 0 || rawKobo >= PAYOUT_PER_SHARE_KOBO) return 0;
  if (baseBps + riseBps === 0) return rawKobo; // own market, no rise: unchanged
  if (rawKobo >= MAX_PRICE_KOBO) return 0; // no room for a margin
  return Math.min(rawKobo + baseBps + riseBps, MAX_PRICE_KOBO);
}

/**
 * What a share of this outcome costs on our book, in kobo — 0 when it
 * can't be bought here. `riseBps` is the outcome's auto-rise from GET
 * /v1/markets/rises (0 where none was read); it only counts while the
 * API's pricing is known.
 */
export function quoteKobo(
  event: Pick<MarketEvent, "source">,
  decimalPrice: string,
  pricing: BookPricing | null,
  riseBps = 0,
): number {
  const base = baseSpreadBps(event, pricing);
  if (base === null) return 0;
  const p = parseFloat(decimalPrice);
  if (!Number.isFinite(p)) return 0;
  const rise = pricing && Number.isFinite(riseBps) && riseBps > 0 ? Math.round(riseBps) : 0;
  return marginedPriceKobo(Math.round(p * PAYOUT_PER_SHARE_KOBO), base, rise);
}

/** A quote for display: "₦61.00", or "—" when there's no quote (0). */
export function formatQuote(kobo: number): string {
  return kobo > 0 ? formatNaira(kobo) : "—";
}

/**
 * Gross payout per unit staked — "1.64x". From our quote when the
 * outcome trades here; an international market that's only mirrored
 * (no base margin: trading off) reads it off Polymarket's price
 * (lib/format's toMultiplier, same rounding).
 */
export function quoteMultiplier(
  event: Pick<MarketEvent, "source">,
  decimalPrice: string,
  pricing: BookPricing | null,
  riseBps = 0,
): string {
  if (baseSpreadBps(event, pricing) === null) return toMultiplier(decimalPrice);
  const kobo = quoteKobo(event, decimalPrice, pricing, riseBps);
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
