import { isLocalBook, type MarketEvent } from "@/types/market";
import { formatNaira, toMultiplier } from "@/lib/format";

/**
 * Prices on WorldStreet's book — what one ₦100 share actually costs here,
 * which is what every buy button, payout multiple and stake form shows.
 *
 * Only the Local book (Bayse-fed and our own markets) trades, at its own
 * price. International (Polymarket) markets are mirrored for display:
 * they have no quote on our book, and their payout multiple is read off
 * Polymarket's price. (The international house book — Polymarket's
 * price plus an API-published spread — is parked on the
 * `international-book` branch until the API can ship it; this module
 * and `useQuote()` are where it plugs back in.)
 */

/** Kobo per share (10 000 = ₦100) — what a winning share pays. */
const PAYOUT_PER_SHARE_KOBO = 10_000;

/**
 * What a share of this outcome costs on our book, in kobo. 0 when it
 * can't be bought here — every international outcome.
 */
export function quoteKobo(event: Pick<MarketEvent, "source">, decimalPrice: string): number {
  const p = parseFloat(decimalPrice);
  if (!Number.isFinite(p) || !isLocalBook(event)) return 0;
  return Math.round(p * PAYOUT_PER_SHARE_KOBO);
}

/** A quote for display: "₩61.00", or "—" when there's no quote (0). */
export function formatQuote(kobo: number): string {
  return kobo > 0 ? formatNaira(kobo) : "—";
}

/**
 * Gross payout per unit staked — "1.64x". The Local book's from our
 * price; an international market's from Polymarket's (lib/format's
 * toMultiplier, same rounding).
 */
export function quoteMultiplier(event: Pick<MarketEvent, "source">, decimalPrice: string): string {
  if (!isLocalBook(event)) return toMultiplier(decimalPrice);
  const kobo = quoteKobo(event, decimalPrice);
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
