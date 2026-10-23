import { PAYOUT_PER_SHARE_KOBO } from "./ledger.js";
import { openRiskByMarket, type MarketRisk } from "./risk.js";

/**
 * The whole book's loss limit (`maxBookLossKobo`): the most the house may
 * stand to lose if every open market went against it at once — the risk
 * desk's worst case (trading/risk.ts). A bet that would push that past
 * the limit is refused; a bet that doesn't add to it — the other side of
 * a one-sided market, or anything on a balanced one — always goes
 * through, so the book can only be pulled back toward safety. A refused
 * customer is told how much they could still bet on that side.
 *
 * Checked per order without holding every market still: two bets on
 * different markets at the same instant can overshoot by about one bet,
 * which keeps betting quick everywhere else.
 */

/** A market's worst case once this bet is in — same rule as risk.ts. */
function worstWith(m: MarketRisk | undefined, outcomeId: string, stakeKobo: number, payoutKobo: number): number {
  const stake = (m?.stakeKobo ?? 0) + stakeKobo;
  const payouts = new Map((m?.outcomes ?? []).map((o) => [o.outcomeId, o.payoutKobo]));
  payouts.set(outcomeId, (payouts.get(outcomeId) ?? 0) + payoutKobo);
  // an outcome nobody backed pays nothing, so only backed ones can be the worst
  return Math.min(...[...payouts.values()].map((payout) => stake - payout));
}

const payoutFor = (stakeKobo: number, priceKobo: number) => Math.floor((stakeKobo / priceKobo) * PAYOUT_PER_SHARE_KOBO);

export type BookLimitCheck =
  | { ok: true }
  /** Refused: the most that would still fit on this side (0 = none). */
  | { ok: false; maxStakeKobo: number; worstLossKobo: number };

export async function checkBookLimit(p: {
  marketId: string;
  outcomeId: string;
  stakeKobo: number;
  priceKobo: number;
  capKobo: number;
}): Promise<BookLimitCheck> {
  const markets = await openRiskByMarket();
  const book = markets.reduce((sum, m) => sum + m.worstCaseKobo, 0);
  const here = markets.find((m) => m.marketId === p.marketId);
  const before = here?.worstCaseKobo ?? 0;
  /** The book's worst case (negative = a loss) with a bet of this size in. */
  const bookWith = (stake: number) => book - before + worstWith(here, p.outcomeId, stake, payoutFor(stake, p.priceKobo));

  const after = bookWith(p.stakeKobo);
  // fine if it stays within the limit, or if it doesn't make things worse
  if (-after <= p.capKobo || after >= book) return { ok: true };

  // the largest stake that still fits: the worst case only gets worse as
  // the stake grows, so halve the gap until it closes
  let lo = 0;
  let hi = p.stakeKobo;
  while (hi - lo > 100) {
    const mid = Math.floor((lo + hi) / 2);
    if (-bookWith(mid) <= p.capKobo) lo = mid;
    else hi = mid;
  }
  return { ok: false, maxStakeKobo: Math.floor(lo / 100) * 100, worstLossKobo: -after };
}
