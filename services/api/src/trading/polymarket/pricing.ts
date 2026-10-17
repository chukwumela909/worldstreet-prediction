import { PAYOUT_PER_SHARE_KOBO } from "../ledger.js";

/**
 * What a share of an international outcome costs on our book.
 *
 * The house quotes Polymarket's own price plus a spread — the desk's
 * `polymarketSpreadBps` book setting (trading/settings.ts; its starting
 * default is POLYMARKET_SPREAD_BPS, 300 = 3 percentage points) — on both
 * sides of every market, so at 3 points a 60% Yes sells at 63 and its
 * 40% No at 43. Polymarket is a deep, fast external market and our
 * mirror of it is seconds behind at best; quoting its mid with no edge
 * would hand every sharp trader a free option on that lag. Bayse is
 * priced raw because it IS the venue; this is a copy, and the spread is
 * the price of that.
 *
 * Outcomes at or past certainty (price ≤ 0 or ≥ 1 — decided, or about
 * to be) aren't quoted at all: 0 kobo, which the trade route rejects as
 * unpriceable. The ceiling keeps a near-certain outcome from pricing at
 * or above the ₦100 a winning share pays.
 */

/** Highest price quoted: a share must always pay more than it costs. */
const MAX_PRICE_KOBO = 9_900;

export function buyPriceKobo(probability: number, spreadBps: number): number {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) return 0;
  const priced = Math.round(probability * PAYOUT_PER_SHARE_KOBO) + spreadBps;
  return Math.min(Math.max(priced, 1), MAX_PRICE_KOBO);
}
