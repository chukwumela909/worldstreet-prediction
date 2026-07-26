import { User } from "../models.js";
import { Position } from "./models.js";

/**
 * Trader rankings over the Local book — this platform's own positions,
 * not a mirror of anyone else's. Realized profit only: an open position
 * has no P&L until it settles, and marking it to the live Bayse price
 * would rank people on money they haven't won.
 *
 * Kobo end to end, like the rest of the book; the UI renders credit.
 */

export const LEADERBOARD_WINDOWS = ["1d", "1w", "30d", "all"] as const;
export type LeaderboardWindow = (typeof LEADERBOARD_WINDOWS)[number];

export const LEADERBOARD_SORTS = ["pnl", "vol"] as const;
export type LeaderboardSort = (typeof LEADERBOARD_SORTS)[number];

export interface LeaderboardEntry {
  rank: number;
  username: string;
  displayName: string;
  avatar: string;
  /** Realized profit in kobo; negative for a losing window. */
  profitKobo: number;
  /** Staked in kobo over the window. */
  volumeKobo: number;
}

const WINDOW_MS: Record<Exclude<LeaderboardWindow, "all">, number> = {
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/**
 * The two metrics are windowed on different clocks on purpose. Volume is
 * "what you staked in this period", so it keys off when the position was
 * opened. Profit is "what you realized in this period", so it keys off
 * when it settled — a bet placed in March and won in April is April's
 * profit. Keying both off one date would either hide this month's stakes
 * (nothing settled yet) or credit a win to the month it was placed.
 */
export async function getLeaderboard(
  window: LeaderboardWindow,
  sort: LeaderboardSort,
  limit = 30,
): Promise<LeaderboardEntry[]> {
  const since =
    window === "all" ? null : new Date(Date.now() - WINDOW_MS[window]);

  const inWindow = (field: string) =>
    since === null ? true : { $gte: [`$${field}`, since] };

  const rows = await Position.aggregate<{
    _id: string;
    profitKobo: number;
    volumeKobo: number;
  }>([
    ...(since === null
      ? []
      : [
          {
            $match: {
              $or: [{ createdAt: { $gte: since } }, { settledAt: { $gte: since } }],
            },
          },
        ]),
    {
      $group: {
        _id: "$authUserId",
        volumeKobo: {
          $sum: { $cond: [inWindow("createdAt"), "$stakeKobo", 0] },
        },
        profitKobo: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ["$settledAt", null] },
                  inWindow("settledAt"),
                ],
              },
              {
                $switch: {
                  branches: [
                    {
                      case: { $eq: ["$status", "won"] },
                      then: {
                        $subtract: ["$potentialPayoutKobo", "$stakeKobo"],
                      },
                    },
                    {
                      case: { $eq: ["$status", "lost"] },
                      then: { $multiply: ["$stakeKobo", -1] },
                    },
                  ],
                  // voided is a refund — the stake comes back, so it is
                  // neither profit nor loss
                  default: 0,
                },
              },
              0,
            ],
          },
        },
      },
    },
    // someone whose only activity in the window is an open position has
    // nothing to rank on the profit board, and nothing staked has nothing
    // to rank on the volume board
    {
      $match:
        sort === "pnl" ? { profitKobo: { $ne: 0 } } : { volumeKobo: { $gt: 0 } },
    },
    // Tie-break all the way down to _id. On the primary key alone, two
    // traders level on profit come back in whatever order the engine
    // feels like, so their ranks swap between identical requests — and
    // near the top of a young board, ties are the common case, not the
    // exotic one.
    {
      $sort:
        sort === "pnl"
          ? { profitKobo: -1, volumeKobo: -1, _id: 1 }
          : { volumeKobo: -1, profitKobo: -1, _id: 1 },
    },
    { $limit: limit },
  ]);

  if (rows.length === 0) return [];

  // one round trip for the names rather than a $lookup, so this keeps
  // working if the two ever live in separate databases
  const users = await User.find(
    { authUserId: { $in: rows.map((r) => r._id) } },
    { authUserId: 1, username: 1, displayName: 1, avatar: 1 },
  ).lean();
  const byId = new Map(users.map((u) => [u.authUserId, u]));

  return rows.map((r, i) => {
    const user = byId.get(r._id);
    return {
      rank: i + 1,
      // a position always outlives its profile row in principle; rank the
      // trade rather than dropping it, and say plainly that we lost the name
      username: user?.username ?? "unknown",
      displayName: user?.displayName || user?.username || "Unknown trader",
      avatar: user?.avatar ?? "",
      profitKobo: Math.round(r.profitKobo),
      volumeKobo: Math.round(r.volumeKobo),
    };
  });
}
