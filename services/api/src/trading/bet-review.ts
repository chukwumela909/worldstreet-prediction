import { User } from "../models.js";
import { NairaAccount, Position } from "./models.js";

/**
 * The bets of every suspended customer that need a decision, counted from
 * all their positions rather than the desk's latest 100. The measure is the
 * one the ₦90 ceiling uses: a settled bet at ₦90 or more a share, buying a
 * result that was all but decided. A high price alone doesn't prove the
 * Terms were broken, so this is what to review, not a verdict. Split at the
 * day the Terms went live, because bets before it came before the rule.
 * Reversed bets are left out of the money (already taken back), and refunds
 * paid nothing. Read-only: nothing here touches a balance.
 */

export const TERMS_LIVE_AT = new Date("2026-10-21T00:00:00+01:00");
const HIGH_PRICE_KOBO = 9_000;

interface Tally {
  bets: number;
  won: number;
  lost: number;
  stakedKobo: number;
  /** Winnings less stakes lost, on these bets. */
  profitKobo: number;
}

export interface ReviewMarket extends Tally {
  title: string;
  outcome: string;
  avgPriceKobo: number;
  firstAt: string;
  lastAt: string;
}

export interface ReviewRow {
  authUserId: string;
  username: string;
  displayName: string;
  email: string;
  suspendedAt: string | null;
  balanceKobo: number;
  /** Every bet they've placed, of any kind. */
  allBets: number;
  high: Tally;
  beforeTerms: Tally;
  afterTerms: Tally;
  /** ₦90+ bets that don't count toward the money: already reversed, or refunded. */
  highReversed: number;
  highRefunded: number;
  /** The most of the profit their balance could cover. */
  balanceCoversKobo: number;
  markets: ReviewMarket[];
}

const empty = (): Tally => ({ bets: 0, won: 0, lost: 0, stakedKobo: 0, profitKobo: 0 });

interface Bet {
  authUserId: string;
  eventTitle: string;
  marketTitle: string;
  outcomeLabel: string;
  status: string;
  stakeKobo: number;
  priceKobo: number;
  potentialPayoutKobo: number;
  reversedFrom?: string;
  createdAt: Date;
}

function add(t: Tally, b: Bet) {
  t.bets += 1;
  t.stakedKobo += b.stakeKobo;
  if (b.status === "won") {
    t.won += 1;
    t.profitKobo += b.potentialPayoutKobo - b.stakeKobo;
  } else {
    t.lost += 1;
    t.profitKobo -= b.stakeKobo;
  }
}

export async function getBetReview(): Promise<{ termsLiveAt: string; rows: ReviewRow[] }> {
  const users = await User.find(
    { suspendedAt: { $ne: null } },
    { authUserId: 1, username: 1, displayName: 1, email: 1, suspendedAt: 1 },
  ).lean();
  const ids = users.map((u) => u.authUserId);
  const [accounts, bets] = await Promise.all([
    NairaAccount.find({ authUserId: { $in: ids } }, { authUserId: 1, balanceKobo: 1 }).lean(),
    Position.find(
      { authUserId: { $in: ids } },
      {
        authUserId: 1,
        eventTitle: 1,
        marketTitle: 1,
        outcomeLabel: 1,
        status: 1,
        stakeKobo: 1,
        priceKobo: 1,
        potentialPayoutKobo: 1,
        reversedFrom: 1,
        createdAt: 1,
      },
    ).lean<Bet[]>(),
  ]);
  const balanceById = new Map(accounts.map((a) => [a.authUserId, a.balanceKobo]));

  const rows = users.map((u): ReviewRow => {
    const own = bets.filter((b) => b.authUserId === u.authUserId);
    const high = own.filter((b) => b.priceKobo >= HIGH_PRICE_KOBO);
    const counted = high.filter((b) => !b.reversedFrom && (b.status === "won" || b.status === "lost"));

    const row: ReviewRow = {
      authUserId: u.authUserId,
      username: u.username,
      displayName: u.displayName ?? "",
      email: u.email ?? "",
      suspendedAt: u.suspendedAt?.toISOString() ?? null,
      balanceKobo: balanceById.get(u.authUserId) ?? 0,
      allBets: own.length,
      high: empty(),
      beforeTerms: empty(),
      afterTerms: empty(),
      highReversed: high.filter((b) => b.reversedFrom).length,
      highRefunded: high.filter((b) => !b.reversedFrom && b.status === "voided").length,
      balanceCoversKobo: 0,
      markets: [],
    };

    const byMarket = new Map<string, { tally: Tally; title: string; outcome: string; prices: number; first: Date; last: Date }>();
    for (const b of counted) {
      add(row.high, b);
      add(b.createdAt < TERMS_LIVE_AT ? row.beforeTerms : row.afterTerms, b);
      const outcome = b.marketTitle && b.marketTitle !== b.eventTitle ? `${b.marketTitle} · ${b.outcomeLabel}` : b.outcomeLabel;
      const key = `${b.eventTitle}|${outcome}`;
      const m = byMarket.get(key) ?? { tally: empty(), title: b.eventTitle, outcome, prices: 0, first: b.createdAt, last: b.createdAt };
      add(m.tally, b);
      m.prices += b.priceKobo;
      if (b.createdAt < m.first) m.first = b.createdAt;
      if (b.createdAt > m.last) m.last = b.createdAt;
      byMarket.set(key, m);
    }
    row.markets = [...byMarket.values()]
      .map((m) => ({
        ...m.tally,
        title: m.title,
        outcome: m.outcome,
        avgPriceKobo: Math.round(m.prices / m.tally.bets),
        firstAt: m.first.toISOString(),
        lastAt: m.last.toISOString(),
      }))
      .sort((a, b) => b.profitKobo - a.profitKobo);
    row.balanceCoversKobo = Math.max(Math.min(row.high.profitKobo, row.balanceKobo), 0);
    return row;
  });
  rows.sort((a, b) => b.high.profitKobo - a.high.profitKobo);
  return { termsLiveAt: TERMS_LIVE_AT.toISOString(), rows };
}
