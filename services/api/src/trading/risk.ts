import { Position } from "./models.js";

/**
 * What the house stands to win or lose on the open book.
 *
 * Worldstreet is the counterparty on every Local market, so the margin
 * in a price is only real if the money lands on both sides of it. Take
 * a market priced ₦58 / ₦47: one ₦5,800 Yes stake and one ₦4,700 No
 * stake means ₦10,500 collected against a ₦10,000 payout either way —
 * ₦500 kept whatever happens. Ten Yes stakes and no No stakes means
 * ₦58,000 collected against ₦100,000 owed if Yes lands. Same prices,
 * same margin, and the second one is just a bet.
 *
 * That difference is invisible in a per-market stake total, which is
 * why everything here is computed per OUTCOME. The number that matters
 * is `profitIfWins`: everything staked on the market, minus what that
 * one outcome would pay out. Negative means the house is short that
 * side and the price should move.
 *
 * All of it reads Position alone — no Bayse call, no market lookup —
 * so it covers both origins and costs one aggregate.
 */

export interface OutcomeRisk {
  outcomeId: string;
  /** Denormalized at trade time; the only label we're sure of. */
  outcomeLabel: string;
  positions: number;
  stakeKobo: number;
  /** What this outcome winning would pay out in total. */
  payoutKobo: number;
  /** Collected across the market, less this payout. Negative = a loss. */
  profitIfWinsKobo: number;
}

export interface MarketRisk {
  marketId: string;
  marketTitle: string;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  positions: number;
  /** Everything staked on this market, across both sides. */
  stakeKobo: number;
  outcomes: OutcomeRisk[];
  /** The outcome that hurts most, or the smallest win on a balanced book. */
  worstCaseKobo: number;
  worstOutcomeId: string | null;
}

export interface BookRisk {
  openPositions: number;
  openMarkets: number;
  /** Stakes taken on positions that haven't resolved. */
  openStakeKobo: number;
  /** Every market resolving the worst way at once. Negative = a loss. */
  worstCaseKobo: number;
  /** The single market carrying the most downside, if any is negative. */
  worstMarket: {
    marketId: string;
    marketTitle: string;
    eventTitle: string;
    eventSlug: string;
    lossKobo: number;
  } | null;
}

interface Row {
  _id: { marketId: string; outcomeId: string };
  outcomeLabel: string;
  positions: number;
  stakeKobo: number;
  payoutKobo: number;
  marketTitle: string;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
}

/** Open exposure per market, broken down by side, heaviest downside first. */
export async function openRiskByMarket(): Promise<MarketRisk[]> {
  const rows = await Position.aggregate<Row>([
    { $match: { status: "open" } },
    {
      $group: {
        _id: { marketId: "$marketId", outcomeId: "$outcomeId" },
        outcomeLabel: { $first: "$outcomeLabel" },
        positions: { $sum: 1 },
        stakeKobo: { $sum: "$stakeKobo" },
        payoutKobo: { $sum: "$potentialPayoutKobo" },
        marketTitle: { $first: "$marketTitle" },
        eventId: { $first: "$eventId" },
        eventTitle: { $first: "$eventTitle" },
        eventSlug: { $first: "$eventSlug" },
      },
    },
  ]);

  const byMarket = new Map<string, Row[]>();
  for (const row of rows) {
    const existing = byMarket.get(row._id.marketId);
    if (existing) existing.push(row);
    else byMarket.set(row._id.marketId, [row]);
  }

  const markets: MarketRisk[] = [];
  for (const [marketId, sides] of byMarket) {
    const stakeKobo = sides.reduce((sum, s) => sum + s.stakeKobo, 0);
    const first = sides[0]!;

    // An outcome nobody backed pays nothing, so it can only ever be the
    // best case — it never changes the worst, which is why the sides
    // with no positions can stay out of this entirely.
    const outcomes: OutcomeRisk[] = sides
      .map((side) => ({
        outcomeId: side._id.outcomeId,
        outcomeLabel: side.outcomeLabel,
        positions: side.positions,
        stakeKobo: side.stakeKobo,
        payoutKobo: side.payoutKobo,
        profitIfWinsKobo: stakeKobo - side.payoutKobo,
      }))
      .sort((a, b) => a.profitIfWinsKobo - b.profitIfWinsKobo);

    const worst = outcomes[0]!;
    markets.push({
      marketId,
      marketTitle: first.marketTitle,
      eventId: first.eventId,
      eventTitle: first.eventTitle,
      eventSlug: first.eventSlug,
      positions: sides.reduce((sum, s) => sum + s.positions, 0),
      stakeKobo,
      outcomes,
      worstCaseKobo: worst.profitIfWinsKobo,
      worstOutcomeId: worst.outcomeId,
    });
  }

  return markets.sort((a, b) => a.worstCaseKobo - b.worstCaseKobo);
}

/**
 * The whole book in four numbers. `worstCaseKobo` assumes every market
 * resolves against us at once — markets settle independently, so it is
 * a real floor rather than a scenario, and it nets off the stakes
 * already collected.
 */
export async function getBookRisk(): Promise<BookRisk> {
  const markets = await openRiskByMarket();
  const worst = markets[0]; // sorted worst-first

  return {
    openPositions: markets.reduce((sum, m) => sum + m.positions, 0),
    openMarkets: markets.length,
    openStakeKobo: markets.reduce((sum, m) => sum + m.stakeKobo, 0),
    worstCaseKobo: markets.reduce((sum, m) => sum + m.worstCaseKobo, 0),
    worstMarket:
      worst && worst.worstCaseKobo < 0
        ? {
            marketId: worst.marketId,
            marketTitle: worst.marketTitle,
            eventTitle: worst.eventTitle,
            eventSlug: worst.eventSlug,
            lossKobo: worst.worstCaseKobo,
          }
        : null,
  };
}

/** The per-side rows keyed by market, for callers that already have one. */
export async function riskByMarketId(): Promise<Map<string, MarketRisk>> {
  const markets = await openRiskByMarket();
  return new Map(markets.map((m) => [m.marketId, m]));
}
