import type { MarketOrigin } from "./events.js";
import { openRiskByMarket } from "./risk.js";
import type { BookSettings } from "./settings.js";

/**
 * What the house charges on top of a market's own price.
 *
 * Two parts, both in basis points of a ₦100 share (100 = 1 point):
 *
 *  - a BASE margin by book: `localSpreadBps` on Bayse's markets (a copy
 *    of someone else's price, sold with no edge until now — which is how
 *    the book lost money), `polymarketSpreadBps` on international ones,
 *    and nothing on our own markets, whose desk-set prices already carry
 *    their margin;
 *  - an automatic RISE on any side the house stands to lose on: with
 *    `payout − everything staked on the market` at risk if that side
 *    wins, the side's price goes up 1 point for every
 *    `autoSpreadStepKobo` at risk. There is no cap: it keeps growing
 *    with the bets until the price meets the ₦99 ceiling, and the
 *    market's loss limit stops new bets regardless. New money is pushed
 *    to the other side until the book balances, and the rise falls back
 *    to zero. The quiet side never goes below its base — the house never
 *    sells under its margin.
 *
 * The trade route charges `quotedPriceKobo` on every order; the web app
 * applies the identical rule to show it (lib/book.ts), reading the rises
 * from GET /v1/markets/rises.
 */

/** Highest price quoted: a share must always pay more than it costs. */
export const MAX_QUOTED_KOBO = 9_900;
const PAYOUT_PER_SHARE_KOBO = 10_000;

export function baseMarginBps(origin: MarketOrigin, settings: BookSettings): number {
  if (origin === "bayse") return settings.localSpreadBps;
  if (origin === "polymarket") return settings.polymarketSpreadBps;
  return 0; // our own markets: the desk's prices are the margin
}

/**
 * What one ₦100 share of an outcome costs here, from the source's own
 * price. 0 = not sold: no price, a decided outcome, or one so close to
 * certain there's no room left for a margin.
 */
export function quotedPriceKobo(rawKobo: number, baseBps: number, riseBps: number): number {
  if (!Number.isFinite(rawKobo) || rawKobo <= 0 || rawKobo >= PAYOUT_PER_SHARE_KOBO) return 0;
  const margin = baseBps + riseBps;
  if (margin === 0) return rawKobo; // own market, nothing at risk: the desk's price
  if (rawKobo >= MAX_QUOTED_KOBO) return 0;
  return Math.min(rawKobo + margin, MAX_QUOTED_KOBO);
}

/**
 * The rise on one side, from what the house would lose if it won:
 * 1 point (100 bps) per `autoSpreadStepKobo` at risk, uncapped — the
 * price rule's ceiling is what stops it.
 */
export function riseBps(atRiskKobo: number, settings: BookSettings): number {
  const step = settings.autoSpreadStepKobo;
  if (step <= 0 || atRiskKobo <= 0) return 0;
  return Math.round((atRiskKobo / step) * 100);
}

/**
 * Every side carrying a rise right now, for the given markets:
 * marketId → outcomeId → bps. Sides with no rise are left out.
 */
export async function risesFor(
  marketIds: string[],
  settings: BookSettings,
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (marketIds.length === 0 || settings.autoSpreadStepKobo <= 0) return out;
  for (const market of await openRiskByMarket(marketIds)) {
    for (const side of market.outcomes) {
      // profitIfWins < 0: the house loses that much if this side wins
      const rise = riseBps(-side.profitIfWinsKobo, settings);
      if (rise <= 0) continue;
      const sides = out.get(market.marketId) ?? new Map<string, number>();
      sides.set(side.outcomeId, rise);
      out.set(market.marketId, sides);
    }
  }
  return out;
}
