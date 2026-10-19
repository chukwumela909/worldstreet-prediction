import { User } from "../models.js";
import { FxRate, LedgerEntry, NairaAccount, Position } from "./models.js";

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
  /**
   * What the conversion spread earned on dollar⇄credit conversions in
   * the period, against the mid rate in force at each one.
   */
  conversionEarningsKobo: number;
  /** Conversions made in the period (deposits + cash-outs, failed ones excluded). */
  conversions: number;
  /** Betting profit + conversion earnings — everything the book made. */
  totalEarnedKobo: number;
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

interface MidRow {
  usdToNgn: number;
  at: number;
}

/** The mid rate in force at `at`: the latest one set at or before it. */
function midAt(rates: MidRow[], at: number): number | null {
  let lo = 0;
  let hi = rates.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rates[mid]!.at <= at) {
      found = rates[mid]!.usdToNgn;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * What the conversion spread earned since `since`. A deposit gave the
 * user `kobo` for `usd` cents, which were worth `usd × mid` kobo at the
 * mid; a cash-out took `kobo` and paid `usd` cents, worth `usd × mid`.
 * The difference each way is the house's — the spread plus the rounding
 * dust it keeps. A cash-out the wallet refused was reversed
 * (`<refKey>:reversal`) and earned nothing, so it's left out.
 */
async function conversionEarnings(
  since: Date | null,
  rates: MidRow[],
  reversed: Set<string>,
): Promise<{ earnedKobo: number; conversions: number }> {
  const entries = await LedgerEntry.find(
    {
      type: { $in: ["conversion_in", "conversion_out"] },
      ...(since ? { createdAt: { $gte: since } } : {}),
    },
    { type: 1, amountKobo: 1, metadata: 1, refKey: 1, createdAt: 1 },
  ).lean();

  let earned = 0;
  let conversions = 0;
  for (const e of entries) {
    const usd = Number((e.metadata as { amountUsdMinor?: unknown } | null)?.amountUsdMinor);
    const at = e.createdAt ? new Date(e.createdAt).getTime() : NaN;
    const mid = Number.isNaN(at) ? null : midAt(rates, at);
    if (!Number.isFinite(usd) || mid === null) continue;
    const kobo = Math.abs(e.amountKobo);
    if (e.type === "conversion_in") {
      earned += usd * mid - kobo;
    } else {
      if (reversed.has(e.refKey)) continue;
      earned += kobo - usd * mid;
    }
    conversions += 1;
  }
  return { earnedKobo: Math.round(earned), conversions };
}

async function period(
  since: Date | null,
  rates: MidRow[],
  reversed: Set<string>,
): Promise<PeriodStats> {
  const placed = since ? { createdAt: { $gte: since } } : {};
  const finished = since ? { settledAt: { $gte: since } } : {};

  const [[activity], [results], fx] = await Promise.all([
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
    conversionEarnings(since, rates, reversed),
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
    conversionEarningsKobo: fx.earnedKobo,
    conversions: fx.conversions,
    totalEarnedKobo: profitKobo + fx.earnedKobo,
  };
}

export async function getAdminOverview(now = Date.now()): Promise<AdminOverview> {
  const at = (hours: number) => new Date(now - hours * HOUR_MS);
  // the rate history (oldest first) and the reversed cash-outs, shared by
  // every period's conversion earnings
  const [rateRows, reversals] = await Promise.all([
    FxRate.find({}, { usdToNgn: 1, createdAt: 1 }).sort({ createdAt: 1 }).lean(),
    LedgerEntry.find({ type: "refund", refKey: /:reversal$/ }, { refKey: 1 }).lean(),
  ]);
  const rates: MidRow[] = rateRows.map((r) => ({
    usdToNgn: r.usdToNgn,
    at: new Date(r.createdAt).getTime(),
  }));
  const reversed = new Set(reversals.map((r) => r.refKey.replace(/:reversal$/, "")));

  const [last24h, last7Days, last30Days, allTime, [open], accounts, [credit], fxRow] =
    await Promise.all([
      period(at(24), rates, reversed),
      period(at(24 * 7), rates, reversed),
      period(at(24 * 30), rates, reversed),
      period(null, rates, reversed),
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
