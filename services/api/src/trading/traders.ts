import { User } from "../models.js";
import { NairaAccount, Position } from "./models.js";

/**
 * Who is actually playing the Local book — the desk's answer to "show
 * me the people", where the leaderboard only answers "show me the
 * winners". Everyone with a local profile is listed, whether or not
 * they have ever staked, because a signed-up account that never traded
 * is exactly the thing an operator wants to see.
 *
 * Three collections, three round trips, merged in memory rather than
 * with `$lookup` — same reason as leaderboard.ts: profiles, positions
 * and balances stay joinable even if they ever live in separate
 * databases. That costs a bounded scan (`SCAN_CAP`), which is honest
 * for a book this size and says so via `truncated` when it isn't.
 *
 * Kobo end to end; the UI renders credit.
 */

export const TRADER_SORTS = [
  "recent", // last trade, newest first — the default
  "staked",
  "pnl",
  "balance",
  "trades",
  "joined",
] as const;
export type TraderSort = (typeof TRADER_SORTS)[number];

export interface TraderRow {
  authUserId: string;
  username: string;
  displayName: string;
  email: string;
  avatar: string;
  joinedAt: string | null;
  /** Spendable naira balance in kobo; 0 when they have no account row yet. */
  balanceKobo: number;
  trades: number;
  openPositions: number;
  wonPositions: number;
  lostPositions: number;
  voidedPositions: number;
  /** Everything ever staked, in kobo. */
  stakedKobo: number;
  /** Staked and still riding. */
  openStakeKobo: number;
  /** What the open positions would pay if every one of them won. */
  openPayoutKobo: number;
  /** Realized profit in kobo, settled positions only; negative is a loss. */
  realizedPnlKobo: number;
  lastTradeAt: string | null;
}

export interface TraderSummary {
  /** Profiles matching the search. */
  users: number;
  /** Of those, how many have staked at least once. */
  traders: number;
  stakedKobo: number;
  openStakeKobo: number;
  realizedPnlKobo: number;
  balanceKobo: number;
}

export interface TraderList {
  traders: TraderRow[];
  /** Rows matching the filters, before pagination. */
  total: number;
  summary: TraderSummary;
  /** True when more profiles exist than the scan looked at. */
  truncated: boolean;
}

/** As many profiles as one listing will merge in memory. */
const SCAN_CAP = 2000;

interface PositionStats {
  _id: string;
  trades: number;
  openPositions: number;
  wonPositions: number;
  lostPositions: number;
  voidedPositions: number;
  stakedKobo: number;
  openStakeKobo: number;
  openPayoutKobo: number;
  realizedPnlKobo: number;
  lastTradeAt: Date | null;
}

const countIf = (status: string) => ({
  $sum: { $cond: [{ $eq: ["$status", status] }, 1, 0] },
});

/** Escape a user-typed search term so it can't compile as a regex. */
function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface TraderQuery {
  search?: string | undefined;
  sort?: TraderSort | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  /** Drop profiles that have never staked. */
  activeOnly?: boolean | undefined;
}

export async function listTraders(params: TraderQuery): Promise<TraderList> {
  const sort = params.sort ?? "recent";
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const offset = Math.max(params.offset ?? 0, 0);
  const search = (params.search ?? "").trim();

  const filter = search
    ? {
        $or: [
          { username: { $regex: escapeRegex(search), $options: "i" } },
          { displayName: { $regex: escapeRegex(search), $options: "i" } },
          { email: { $regex: escapeRegex(search), $options: "i" } },
          { authUserId: search },
        ],
      }
    : {};

  // one over the cap, so we can tell "exactly full" from "there's more"
  const users = await User.find(filter, {
    authUserId: 1,
    username: 1,
    displayName: 1,
    email: 1,
    avatar: 1,
    createdAt: 1,
  })
    .sort({ createdAt: -1 })
    .limit(SCAN_CAP + 1)
    .lean();

  const truncated = users.length > SCAN_CAP;
  const scanned = truncated ? users.slice(0, SCAN_CAP) : users;
  const ids = scanned.map((u) => u.authUserId);

  if (ids.length === 0) {
    return {
      traders: [],
      total: 0,
      summary: {
        users: 0,
        traders: 0,
        stakedKobo: 0,
        openStakeKobo: 0,
        realizedPnlKobo: 0,
        balanceKobo: 0,
      },
      truncated,
    };
  }

  const [stats, accounts] = await Promise.all([
    Position.aggregate<PositionStats>([
      { $match: { authUserId: { $in: ids } } },
      {
        $group: {
          _id: "$authUserId",
          trades: { $sum: 1 },
          openPositions: countIf("open"),
          wonPositions: countIf("won"),
          lostPositions: countIf("lost"),
          voidedPositions: countIf("voided"),
          stakedKobo: { $sum: "$stakeKobo" },
          openStakeKobo: {
            $sum: { $cond: [{ $eq: ["$status", "open"] }, "$stakeKobo", 0] },
          },
          openPayoutKobo: {
            $sum: {
              $cond: [{ $eq: ["$status", "open"] }, "$potentialPayoutKobo", 0],
            },
          },
          // settled only: an open stake is not a loss until it loses,
          // and a void is a refund — neither profit nor loss
          realizedPnlKobo: {
            $sum: {
              $switch: {
                branches: [
                  {
                    case: { $eq: ["$status", "won"] },
                    then: { $subtract: ["$potentialPayoutKobo", "$stakeKobo"] },
                  },
                  {
                    case: { $eq: ["$status", "lost"] },
                    then: { $multiply: ["$stakeKobo", -1] },
                  },
                ],
                default: 0,
              },
            },
          },
          lastTradeAt: { $max: "$createdAt" },
        },
      },
    ]),
    NairaAccount.find(
      { authUserId: { $in: ids } },
      { authUserId: 1, balanceKobo: 1 },
    ).lean(),
  ]);

  const statsById = new Map(stats.map((s) => [s._id, s]));
  const balanceById = new Map(
    accounts.map((a) => [a.authUserId, a.balanceKobo]),
  );

  let rows: TraderRow[] = scanned.map((u) => {
    const s = statsById.get(u.authUserId);
    return {
      authUserId: u.authUserId,
      username: u.username,
      displayName: u.displayName || u.username,
      email: u.email,
      avatar: u.avatar ?? "",
      joinedAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
      balanceKobo: balanceById.get(u.authUserId) ?? 0,
      trades: s?.trades ?? 0,
      openPositions: s?.openPositions ?? 0,
      wonPositions: s?.wonPositions ?? 0,
      lostPositions: s?.lostPositions ?? 0,
      voidedPositions: s?.voidedPositions ?? 0,
      stakedKobo: s?.stakedKobo ?? 0,
      openStakeKobo: s?.openStakeKobo ?? 0,
      openPayoutKobo: s?.openPayoutKobo ?? 0,
      realizedPnlKobo: Math.round(s?.realizedPnlKobo ?? 0),
      lastTradeAt: s?.lastTradeAt ? new Date(s.lastTradeAt).toISOString() : null,
    };
  });

  if (params.activeOnly) rows = rows.filter((r) => r.trades > 0);

  const summary = rows.reduce<TraderSummary>(
    (acc, r) => ({
      users: acc.users + 1,
      traders: acc.traders + (r.trades > 0 ? 1 : 0),
      stakedKobo: acc.stakedKobo + r.stakedKobo,
      openStakeKobo: acc.openStakeKobo + r.openStakeKobo,
      realizedPnlKobo: acc.realizedPnlKobo + r.realizedPnlKobo,
      balanceKobo: acc.balanceKobo + r.balanceKobo,
    }),
    {
      users: 0,
      traders: 0,
      stakedKobo: 0,
      openStakeKobo: 0,
      realizedPnlKobo: 0,
      balanceKobo: 0,
    },
  );

  // "recent" ranks by last trade, and someone who has never traded has
  // no last trade — those sink to the bottom rather than jumbling in
  // among the active accounts at epoch zero.
  const time = (iso: string | null) => (iso ? Date.parse(iso) : -1);
  const comparators: Record<TraderSort, (a: TraderRow, b: TraderRow) => number> =
    {
      recent: (a, b) => time(b.lastTradeAt) - time(a.lastTradeAt),
      staked: (a, b) => b.stakedKobo - a.stakedKobo,
      pnl: (a, b) => b.realizedPnlKobo - a.realizedPnlKobo,
      balance: (a, b) => b.balanceKobo - a.balanceKobo,
      trades: (a, b) => b.trades - a.trades,
      joined: (a, b) => time(b.joinedAt) - time(a.joinedAt),
    };
  // username breaks every tie, so the same page never reshuffles
  rows.sort(
    (a, b) =>
      comparators[sort](a, b) || a.username.localeCompare(b.username),
  );

  return {
    traders: rows.slice(offset, offset + limit),
    total: rows.length,
    summary,
    truncated,
  };
}
