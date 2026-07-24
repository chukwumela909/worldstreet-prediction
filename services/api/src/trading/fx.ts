import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { FxRate } from "./models.js";

/**
 * USD/NGN conversion pricing. The mid rate is admin-set (latest FxRate
 * row); the spread (basis points, config) is applied against the user
 * in both directions, so a round trip costs 2× spread and conversion
 * can't be used to arb the house. No rate row → conversions are
 * unavailable (503), never a guessed rate.
 */

export interface FxQuote {
  /** Naira per USD, mid. */
  mid: number;
  /** Rate applied converting USD → NGN (mid minus spread). */
  usdToNgn: number;
  /** Rate applied converting NGN → USD (mid plus spread). */
  ngnToUsd: number;
  spreadBps: number;
  asOf: Date;
}

export async function getFxQuote(): Promise<FxQuote> {
  const row = await FxRate.findOne().sort({ createdAt: -1 });
  if (!row) {
    throw new ApiError(
      503,
      "Currency conversion is not configured yet",
      "FX_UNAVAILABLE",
    );
  }
  const spread = config.FX_SPREAD_BPS / 10_000;
  return {
    mid: row.usdToNgn,
    usdToNgn: row.usdToNgn * (1 - spread),
    ngnToUsd: row.usdToNgn * (1 + spread),
    spreadBps: config.FX_SPREAD_BPS,
    asOf: row.createdAt,
  };
}

/** USD cents → kobo at the quote's buy rate (floor: house keeps dust). */
export function usdMinorToKobo(amountUsdMinor: number, quote: FxQuote): number {
  return Math.floor(amountUsdMinor * quote.usdToNgn);
}

/** Kobo → USD cents at the quote's sell rate (floor: house keeps dust). */
export function koboToUsdMinor(amountKobo: number, quote: FxQuote): number {
  return Math.floor(amountKobo / quote.ngnToUsd);
}
