import { User } from "../models.js";
import { LedgerEntry, NairaAccount, Position } from "./models.js";
import { listWithdrawalChecks, type WithdrawalCheckRow } from "./withdrawals.js";

/**
 * Abuse watch: the desk's scans for the ways money has been, or could be,
 * taken from the book — each one a pattern in data we already keep:
 *
 *  - beatingOdds: winning far more often than the prices paid say is
 *    possible by luck (the signature of betting on results already
 *    known — a live game, a count anyone can see, a stale price);
 *  - nearCertain: piling into sides priced ₦90+ and almost never losing
 *    (the 15-minute crypto and post-count pattern; the ₦90 ceiling stops
 *    new ones, this shows who did it);
 *  - twins: two accounts backing the same side of the same market within
 *    two minutes of each other, market after market (one person, two
 *    accounts, to get round stake and loss limits);
 *  - cashOut: accounts that have withdrawn more than they ever added,
 *    with what their bets made — where taken money left the platform;
 *  - ledgerGaps: balances that don't equal the sum of their ledger —
 *    money that moved outside the ledger, which should never happen;
 *  - withdrawals: credit → dollar withdrawals the wallet never confirmed,
 *    held for the desk (trading/withdrawals.ts).
 *
 * Read-only. Bets the desk has reversed are left out of the betting
 * scans: they've already been dealt with. Kobo throughout.
 */

const MIN_BETS = 10;
/** How far beyond luck a record must be: ~1 in 1,000 by chance. */
const MIN_Z = 3;
const NEAR_CERTAIN_KOBO = 9_000;
const TWIN_WINDOW_MS = 2 * 60_000;
const MIN_SHARED_MARKETS = 5;
const ROWS = 50;

export interface Person {
  authUserId: string;
  username: string;
  displayName: string;
  email: string;
  balanceKobo: number;
  suspendedAt: string | null;
  suspendedReason: string;
}

export interface OddsRow extends Person {
  bets: number;
  won: number;
  /** What the prices paid said they'd win, summed. */
  expectedWins: number;
  /** Standard deviations above that — 3 is about 1 in 1,000 by luck. */
  z: number;
  avgPriceKobo: number;
  stakedKobo: number;
  profitKobo: number;
  markets: string[];
  lastBetAt: string | null;
}

export interface NearCertainRow extends Person {
  bets: number;
  won: number;
  avgPriceKobo: number;
  stakedKobo: number;
  profitKobo: number;
  markets: string[];
  lastBetAt: string | null;
}

export interface TwinRow {
  a: Person;
  b: Person;
  /** Markets where both backed the same side within two minutes. */
  sharedMarkets: number;
  examples: string[];
  lastAt: string | null;
}

export interface CashOutRow extends Person {
  addedKobo: number;
  /** Withdrawn, net of withdrawals that failed and came back. */
  withdrawnKobo: number;
  /** Withdrawn − added: what left beyond what came in. */
  extraKobo: number;
  /** What their bets made, settled and not reversed. */
  betProfitKobo: number;
  /** Winnings the desk took back by reversal. */
  reversedKobo: number;
}

export interface LedgerGapRow extends Person {
  ledgerKobo: number;
  /** balance − ledger. */
  gapKobo: number;
}

export interface AbuseWatch {
  days: number | null;
  beatingOdds: OddsRow[];
  nearCertain: NearCertainRow[];
  twins: TwinRow[];
  cashOut: CashOutRow[];
  ledgerGaps: LedgerGapRow[];
  withdrawals: WithdrawalCheckRow[];
}

interface Bet {
  authUserId: string;
  marketId: string;
  outcomeId: string;
  eventTitle: string;
  status: "open" | "won" | "lost" | "voided";
  stakeKobo: number;
  priceKobo: number;
  potentialPayoutKobo: number;
  createdAt: Date;
  reversedFrom?: string | null;
}

/** A row before the person's details are joined on. */
type Scored<T> = Omit<T, keyof Person> & { authUserId: string };

/** The titles someone bet on most, most first. */
function topTitles(titles: string[], n = 3): string[] {
  const counts = new Map<string, number>();
  for (const t of titles) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

export async function getAbuseWatch(days: number | null): Promise<AbuseWatch> {
  const since = days ? new Date(Date.now() - days * 86_400_000) : null;
  const bets = await Position.find(
    { reversedFrom: { $exists: false }, ...(since ? { createdAt: { $gte: since } } : {}) },
    {
      authUserId: 1,
      marketId: 1,
      outcomeId: 1,
      eventTitle: 1,
      status: 1,
      stakeKobo: 1,
      priceKobo: 1,
      potentialPayoutKobo: 1,
      createdAt: 1,
    },
  ).lean<Bet[]>();

  /* ---- results against the odds ---- */
  const byUser = new Map<string, Bet[]>();
  for (const b of bets) {
    if (b.status !== "won" && b.status !== "lost") continue;
    byUser.set(b.authUserId, [...(byUser.get(b.authUserId) ?? []), b]);
  }
  const profitOf = (b: Bet) => (b.status === "won" ? b.potentialPayoutKobo - b.stakeKobo : -b.stakeKobo);
  const lastAt = (list: Bet[]) =>
    list.reduce<Date | null>((m, b) => (!m || b.createdAt > m ? b.createdAt : m), null)?.toISOString() ?? null;

  const odds: Scored<OddsRow>[] = [];
  const near: Scored<NearCertainRow>[] = [];
  for (const [authUserId, list] of byUser) {
    if (list.length >= MIN_BETS) {
      const won = list.filter((b) => b.status === "won").length;
      const p = list.map((b) => Math.min(Math.max(b.priceKobo / 10_000, 0.0001), 0.9999));
      const expected = p.reduce((s, x) => s + x, 0);
      const variance = p.reduce((s, x) => s + x * (1 - x), 0);
      const z = (won - expected) / Math.sqrt(variance);
      if (z >= MIN_Z) {
        odds.push({
          authUserId,
          bets: list.length,
          won,
          expectedWins: Math.round(expected * 10) / 10,
          z: Math.round(z * 10) / 10,
          avgPriceKobo: Math.round(list.reduce((s, b) => s + b.priceKobo, 0) / list.length),
          stakedKobo: list.reduce((s, b) => s + b.stakeKobo, 0),
          profitKobo: list.reduce((s, b) => s + profitOf(b), 0),
          markets: topTitles(list.map((b) => b.eventTitle)),
          lastBetAt: lastAt(list),
        });
      }
    }
    const high = list.filter((b) => b.priceKobo >= NEAR_CERTAIN_KOBO);
    const highProfit = high.reduce((s, b) => s + profitOf(b), 0);
    if (high.length >= MIN_BETS && highProfit > 0) {
      near.push({
        authUserId,
        bets: high.length,
        won: high.filter((b) => b.status === "won").length,
        avgPriceKobo: Math.round(high.reduce((s, b) => s + b.priceKobo, 0) / high.length),
        stakedKobo: high.reduce((s, b) => s + b.stakeKobo, 0),
        profitKobo: highProfit,
        markets: topTitles(high.map((b) => b.eventTitle)),
        lastBetAt: lastAt(high),
      });
    }
  }
  odds.sort((a, b) => b.z - a.z);
  near.sort((a, b) => b.profitKobo - a.profitKobo);

  /* ---- two accounts moving together ---- */
  const bySide = new Map<string, Bet[]>();
  for (const b of bets) {
    const k = `${b.marketId}|${b.outcomeId}`;
    bySide.set(k, [...(bySide.get(k) ?? []), b]);
  }
  const pairs = new Map<string, { markets: Set<string>; titles: string[]; last: Date }>();
  for (const side of bySide.values()) {
    side.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
    const seenHere = new Set<string>();
    for (let i = 0; i < side.length; i++) {
      for (let j = i + 1; j < side.length; j++) {
        const gap = side[j]!.createdAt.getTime() - side[i]!.createdAt.getTime();
        if (gap > TWIN_WINDOW_MS) break;
        const [u1, u2] = [side[i]!.authUserId, side[j]!.authUserId].sort();
        if (u1 === u2) continue;
        const key = `${u1}|${u2}`;
        if (seenHere.has(key)) continue;
        seenHere.add(key);
        const pair = pairs.get(key) ?? { markets: new Set<string>(), titles: [], last: side[j]!.createdAt };
        pair.markets.add(side[i]!.marketId);
        pair.titles.push(side[i]!.eventTitle);
        if (side[j]!.createdAt > pair.last) pair.last = side[j]!.createdAt;
        pairs.set(key, pair);
      }
    }
  }
  const twinPairs = [...pairs.entries()]
    .filter(([, p]) => p.markets.size >= MIN_SHARED_MARKETS)
    .sort((a, b) => b[1].markets.size - a[1].markets.size)
    .slice(0, ROWS);

  /* ---- money in and out, all time ---- */
  const ledger = await LedgerEntry.aggregate<{
    _id: string;
    sum: number;
    added: number;
    withdrawn: number;
    returned: number;
    reversed: number;
  }>([
    {
      $group: {
        _id: "$authUserId",
        sum: { $sum: "$amountKobo" },
        added: { $sum: { $cond: [{ $eq: ["$type", "conversion_in"] }, "$amountKobo", 0] } },
        withdrawn: { $sum: { $cond: [{ $eq: ["$type", "conversion_out"] }, { $multiply: ["$amountKobo", -1] }, 0] } },
        // a failed withdrawal's credit coming back
        returned: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$type", "refund"] },
                  { $regexMatch: { input: "$refKey", regex: "^convert:.*:reversal$" } },
                ],
              },
              "$amountKobo",
              0,
            ],
          },
        },
        reversed: {
          $sum: { $cond: [{ $and: [{ $eq: ["$type", "reversal"] }, { $lt: ["$amountKobo", 0] }] }, { $multiply: ["$amountKobo", -1] }, 0] },
        },
      },
    },
  ]);
  const accounts = await NairaAccount.find({}, { authUserId: 1, balanceKobo: 1 }).lean();
  const balanceById = new Map(accounts.map((a) => [a.authUserId, a.balanceKobo]));

  const cash = ledger
    .map((l) => ({ ...l, net: l.withdrawn - l.returned }))
    .filter((l) => l.net > l.added)
    .sort((a, b) => b.net - b.added - (a.net - a.added))
    .slice(0, ROWS);
  const ledgerIds = new Set(ledger.map((l) => l._id));
  const gaps = [
    ...ledger
      .filter((l) => (balanceById.get(l._id) ?? 0) !== l.sum)
      .map((l) => ({ id: l._id, ledgerKobo: l.sum, gapKobo: (balanceById.get(l._id) ?? 0) - l.sum })),
    // a balance with no ledger behind it at all
    ...accounts
      .filter((a) => !ledgerIds.has(a.authUserId) && a.balanceKobo !== 0)
      .map((a) => ({ id: a.authUserId, ledgerKobo: 0, gapKobo: a.balanceKobo })),
  ].slice(0, ROWS);

  // settled, unreversed bet profit for the cash-out rows, all time
  const cashIds = cash.map((c) => c._id);
  const betProfit = new Map(
    (
      await Position.aggregate<{ _id: string; profit: number }>([
        { $match: { authUserId: { $in: cashIds }, status: { $in: ["won", "lost"] }, reversedFrom: { $exists: false } } },
        {
          $group: {
            _id: "$authUserId",
            profit: {
              $sum: {
                $cond: [
                  { $eq: ["$status", "won"] },
                  { $subtract: ["$potentialPayoutKobo", "$stakeKobo"] },
                  { $multiply: ["$stakeKobo", -1] },
                ],
              },
            },
          },
        },
      ])
    ).map((r) => [r._id, r.profit]),
  );

  /* ---- who they are ---- */
  const ids = new Set<string>([
    ...odds.map((o) => o.authUserId),
    ...near.map((o) => o.authUserId),
    ...twinPairs.flatMap(([k]) => k.split("|")),
    ...cashIds,
    ...gaps.map((g) => g.id),
  ]);
  const users = await User.find(
    { authUserId: { $in: [...ids] } },
    { authUserId: 1, username: 1, displayName: 1, email: 1, suspendedAt: 1, suspendedReason: 1 },
  ).lean();
  const userById = new Map(users.map((u) => [u.authUserId, u]));
  const person = (id: string): Person => {
    const u = userById.get(id);
    return {
      authUserId: id,
      username: u?.username ?? id,
      displayName: u?.displayName ?? "",
      email: u?.email ?? "",
      balanceKobo: balanceById.get(id) ?? 0,
      suspendedAt: u?.suspendedAt?.toISOString() ?? null,
      suspendedReason: u?.suspendedReason ?? "",
    };
  };

  return {
    days,
    beatingOdds: odds.slice(0, ROWS).map((o) => ({ ...person(o.authUserId), ...o })),
    nearCertain: near.slice(0, ROWS).map((o) => ({ ...person(o.authUserId), ...o })),
    twins: twinPairs.map(([key, p]) => {
      const [a, b] = key.split("|") as [string, string];
      return {
        a: person(a),
        b: person(b),
        sharedMarkets: p.markets.size,
        examples: topTitles(p.titles),
        lastAt: p.last.toISOString(),
      };
    }),
    cashOut: cash.map((c) => ({
      ...person(c._id),
      addedKobo: c.added,
      withdrawnKobo: c.net,
      extraKobo: c.net - c.added,
      betProfitKobo: Math.round(betProfit.get(c._id) ?? 0),
      reversedKobo: c.reversed,
    })),
    ledgerGaps: gaps.map((g) => ({ ...person(g.id), ledgerKobo: g.ledgerKobo, gapKobo: g.gapKobo })),
    withdrawals: await listWithdrawalChecks(),
  };
}
