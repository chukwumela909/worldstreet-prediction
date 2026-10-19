import { User } from "../models.js";
import { FxRate, NairaAccount, Position } from "./models.js";

/**
 * The admin desk's headline numbers, in one read.
 *
 * Two clocks, on purpose: staking activity (money staked, bets, active
 * traders, average bet) counts a bet when it's PLACED; results (what
 * finished, what winners were paid, the house's profit and margin) count
 * it when its market FINISHES. A bet placed last month on a market that
 * settled today is this week's profit but last month's stake — which is
 * how a bookmaker reads its own book.
 *
 * Profit follows trading/pnl.ts: stakes kept on won + lost bets minus
 * the ₦100/share paid on won ones; voided bets were refunded and move
 * nothing. Kobo throughout; the desk converts for display.
 */

export interface PeriodStats {
  stakedKobo: number;
  bets: number;
  traders: number;
  averageStakeKobo: number;
  settledStakesKobo: number;
  payoutsKobo: number;
  profitKobo: number;
  marginPct: number | null;
}

export interface AdminOverview {
  periods: {
    last24h: PeriodStats;
    last7Days: PeriodStats;
    last30Days: PeriodStats;
    allTime: PeriodStats;
  };
  open: { bets: number; markets: number; stakeKobo: number; potentialPayoutKobo: number };
  tradersWithStakes: number;
  accounts: number;
  creditHeldKobo: number;
  fx: { usdToNgnMid: number; asOf: string } | null;
}

const HOUR_MS = 3_600_000;

async function period(since: Date | null): Promise<PeriodStats> {
  const placed = since ? { createdAt: { $gte: since } } : {};
  const finished = since ? { settledAt: { $gte: since } } : {};

  const [[activity], [results]] = await Promise.all([
    Position.aggregate<{ stakedKobo: number; bets: number; traders: string[] }>([
      { $match: placed },
      {
        $group: {
          _id: null,
          stakedKobo: { $sum: "$stakeKobo" },
          bets: { $sum: 1 },
          traders: { $addToSet: "$authUserId" },
        },
      },
    ]),
    Position.aggregate<{ settledStakesKobo: number; payoutsKobo: number }>([
      { $match: { status: { $in: ["won", "lost"] }, ...finished } },
      {
        $group: {
          _id: null,
          settledStakesKobo: { $sum: "$stakeKobo" },
          payoutsKobo: {
            $sum: { $cond: [{ $eq: ["$status", "won"] }, "$potentialPayoutKobo", 0] },
          },
        },
      },
    ]),
  ]);

  const stakedKobo = activity?.stakedKobo ?? 0;
  const bets = activity?.bets ?? 0;
  const settledStakesKobo = results?.settledStakesKobo ?? 0;
  const payoutsKobo = results?.payoutsKobo ?? 0;
  const profitKobo = settledStakesKobo - payoutsKobo;
  return {
    stakedKobo,
    bets,
    traders: activity?.traders.length ?? 0,
    averageStakeKobo: bets > 0 ? Math.round(stakedKobo / bets) : 0,
    settledStakesKobo,
    payoutsKobo,
    profitKobo,
    marginPct:
      settledStakesKobo > 0 ? Math.round((profitKobo / settledStakesKobo) * 1000) / 10 : null,
  };
}

export async function getAdminOverview(now = Date.now()): Promise<AdminOverview> {
  const at = (hours: number) => new Date(now - hours * HOUR_MS);
  const [last24h, last7Days, last30Days, allTime, [open], accounts, [credit], fxRow] =
    await Promise.all([
      period(at(24)),
      period(at(24 * 7)),
      period(at(24 * 30)),
      period(null),
      Position.aggregate<{
        bets: number;
        markets: string[];
        stakeKobo: number;
        potentialPayoutKobo: number;
      }>([
        { $match: { status: "open" } },
        {
          $group: {
            _id: null,
            bets: { $sum: 1 },
            markets: { $addToSet: "$marketId" },
            stakeKobo: { $sum: "$stakeKobo" },
            potentialPayoutKobo: { $sum: "$potentialPayoutKobo" },
          },
        },
      ]),
      User.countDocuments(),
      NairaAccount.aggregate<{ kobo: number }>([
        { $group: { _id: null, kobo: { $sum: "$balanceKobo" } } },
      ]),
      FxRate.findOne().sort({ createdAt: -1 }).lean(),
    ]);

  return {
    periods: { last24h, last7Days, last30Days, allTime },
    open: {
      bets: open?.bets ?? 0,
      markets: open?.markets.length ?? 0,
      stakeKobo: open?.stakeKobo ?? 0,
      potentialPayoutKobo: open?.potentialPayoutKobo ?? 0,
    },
    tradersWithStakes: allTime.traders,
    accounts,
    creditHeldKobo: credit?.kobo ?? 0,
    fx: fxRow
      ? { usdToNgnMid: fxRow.usdToNgn, asOf: new Date(fxRow.createdAt).toISOString() }
      : null,
  };
}
