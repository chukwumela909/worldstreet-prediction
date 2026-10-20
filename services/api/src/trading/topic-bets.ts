import { User } from "../models.js";
import { Position } from "./models.js";
import { pausedPattern } from "./paused.js";

/**
 * Every bet on a topic's markets that finished in a window — won, lost
 * or refunded — and who placed it: the desk's Settled bets page. A
 * topic matches as paused topics do (trading/paused.ts): a whole word in
 * the event's title or slug or the market's title. Amounts are kobo.
 *
 * Three views of the same bets: per customer (with their win rate and
 * the average price they paid, stake-weighted — buying at ₦95+ means
 * buying what was already nearly decided), per round (one market, e.g.
 * one 15-minute Bitcoin window), and the bets themselves.
 *
 * A customer's "result" is what they're up or down on these bets:
 * winnings paid plus refunds, minus everything staked. The house result
 * is its opposite.
 */

const MAX_HOURS = 24 * 90;
const MAX_BETS = 5_000;
const MAX_BET_ROWS = 1_500;
const MAX_ROWS = 500;

export type SettledStatus = "won" | "lost" | "voided";

export interface TopicBet {
  id: string;
  marketId: string;
  authUserId: string;
  username: string;
  eventTitle: string;
  marketTitle: string;
  outcomeLabel: string;
  stakeKobo: number;
  priceKobo: number;
  /** What a win paid (₦100 a share); paid only when won. */
  payoutKobo: number;
  status: SettledStatus;
  /** Set when the desk reversed it after it settled (trading/reversals.ts). */
  reversedFrom: "won" | "lost" | "open" | null;
  placedAt: string | null;
  settledAt: string | null;
}

export interface TopicCustomer {
  authUserId: string;
  username: string;
  email: string;
  bets: number;
  won: number;
  lost: number;
  refunded: number;
  stakedKobo: number;
  /** Winnings paid on won bets, stake included. */
  paidKobo: number;
  refundedKobo: number;
  /** Paid + refunded − staked: what they're up (+) or down (−). */
  resultKobo: number;
  /** Stake-weighted average price paid per ₦100 share. */
  avgPriceKobo: number;
  lastSettledAt: string | null;
}

/** One market's bets — for a 15-minute series, one window. */
export interface TopicRound {
  marketId: string;
  eventTitle: string;
  marketTitle: string;
  settledAt: string | null;
  bets: number;
  customers: number;
  stakedKobo: number;
  paidKobo: number;
  refundedKobo: number;
  /** Staked − paid − refunded on this market. */
  houseResultKobo: number;
  /** The side(s) that paid out, from the winning bets. */
  winning: string[];
  avgPriceKobo: number;
}

export interface TopicBetsReport {
  topics: string[];
  hours: number;
  totals: {
    customers: number;
    bets: number;
    won: number;
    lost: number;
    refunded: number;
    stakedKobo: number;
    paidKobo: number;
    refundedKobo: number;
    /** Staked − paid − refunded: what the house kept (+) or lost (−). */
    houseResultKobo: number;
    /** Stake-weighted average price paid per ₦100 share. */
    avgPriceKobo: number;
    rounds: number;
  };
  /** Bets on these markets still waiting to settle. */
  open: { bets: number; stakeKobo: number };
  /** Biggest winners first. */
  customers: TopicCustomer[];
  /** Newest first. */
  rounds: TopicRound[];
  /** Newest first, at most MAX_BET_ROWS. */
  bets: TopicBet[];
  /** More bets settled in the window than were read (MAX_BETS). */
  truncated: boolean;
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const avg = (priceStake: number, stake: number) => (stake > 0 ? Math.round(priceStake / stake) : 0);

export async function getTopicBets(
  topics: readonly string[],
  hoursAsked: number,
): Promise<TopicBetsReport> {
  const hours = Math.min(Math.max(Math.round(hoursAsked), 1), MAX_HOURS);
  const empty: TopicBetsReport = {
    topics: [...topics],
    hours,
    totals: {
      customers: 0,
      bets: 0,
      won: 0,
      lost: 0,
      refunded: 0,
      stakedKobo: 0,
      paidKobo: 0,
      refundedKobo: 0,
      houseResultKobo: 0,
      avgPriceKobo: 0,
      rounds: 0,
    },
    open: { bets: 0, stakeKobo: 0 },
    customers: [],
    rounds: [],
    bets: [],
    truncated: false,
  };
  const pattern = pausedPattern(topics);
  if (!pattern) return empty;
  const onTopic = { $or: [{ eventTitle: pattern }, { eventSlug: pattern }, { marketTitle: pattern }] };
  const since = new Date(Date.now() - hours * 3_600_000);

  const [settled, [openAgg]] = await Promise.all([
    Position.find(
      { status: { $in: ["won", "lost", "voided"] }, settledAt: { $gte: since }, ...onTopic },
      {
        authUserId: 1,
        marketId: 1,
        eventTitle: 1,
        marketTitle: 1,
        outcomeLabel: 1,
        stakeKobo: 1,
        priceKobo: 1,
        potentialPayoutKobo: 1,
        status: 1,
        reversedFrom: 1,
        createdAt: 1,
        settledAt: 1,
      },
    )
      .sort({ settledAt: -1, createdAt: -1 })
      .limit(MAX_BETS + 1)
      .lean(),
    Position.aggregate<{ bets: number; stakeKobo: number }>([
      { $match: { status: "open", ...onTopic } },
      { $group: { _id: null, bets: { $sum: 1 }, stakeKobo: { $sum: "$stakeKobo" } } },
    ]),
  ]);
  const truncated = settled.length > MAX_BETS;
  const rows = settled.slice(0, MAX_BETS);

  const users = await User.find(
    { authUserId: { $in: [...new Set(rows.map((b) => b.authUserId))] } },
    { authUserId: 1, username: 1, email: 1 },
  ).lean();
  const userById = new Map(users.map((u) => [u.authUserId, u]));

  const totals = { ...empty.totals };
  let totalPriceStake = 0;
  const customers = new Map<string, TopicCustomer & { priceStake: number }>();
  const rounds = new Map<
    string,
    TopicRound & { priceStake: number; who: Set<string>; wins: Set<string> }
  >();

  for (const b of rows) {
    const status = b.status as SettledStatus;
    const paid = status === "won" ? b.potentialPayoutKobo : 0;
    const refund = status === "voided" ? b.stakeKobo : 0;
    totals.bets += 1;
    totals.stakedKobo += b.stakeKobo;
    totals.paidKobo += paid;
    totals.refundedKobo += refund;
    totalPriceStake += b.priceKobo * b.stakeKobo;
    if (status === "won") totals.won += 1;
    else if (status === "lost") totals.lost += 1;
    else totals.refunded += 1;

    const u = userById.get(b.authUserId);
    const c = customers.get(b.authUserId) ?? {
      authUserId: b.authUserId,
      username: u?.username ?? "",
      email: u?.email ?? "",
      bets: 0,
      won: 0,
      lost: 0,
      refunded: 0,
      stakedKobo: 0,
      paidKobo: 0,
      refundedKobo: 0,
      resultKobo: 0,
      avgPriceKobo: 0,
      lastSettledAt: iso(b.settledAt), // rows are newest first
      priceStake: 0,
    };
    c.bets += 1;
    if (status === "won") c.won += 1;
    else if (status === "lost") c.lost += 1;
    else c.refunded += 1;
    c.stakedKobo += b.stakeKobo;
    c.paidKobo += paid;
    c.refundedKobo += refund;
    c.resultKobo = c.paidKobo + c.refundedKobo - c.stakedKobo;
    c.priceStake += b.priceKobo * b.stakeKobo;
    customers.set(b.authUserId, c);

    const r = rounds.get(b.marketId) ?? {
      marketId: b.marketId,
      eventTitle: b.eventTitle,
      marketTitle: b.marketTitle,
      settledAt: iso(b.settledAt),
      bets: 0,
      customers: 0,
      stakedKobo: 0,
      paidKobo: 0,
      refundedKobo: 0,
      houseResultKobo: 0,
      winning: [],
      avgPriceKobo: 0,
      priceStake: 0,
      who: new Set<string>(),
      wins: new Set<string>(),
    };
    r.bets += 1;
    r.stakedKobo += b.stakeKobo;
    r.paidKobo += paid;
    r.refundedKobo += refund;
    r.priceStake += b.priceKobo * b.stakeKobo;
    r.who.add(b.authUserId);
    if (status === "won") r.wins.add(b.outcomeLabel);
    rounds.set(b.marketId, r);
  }
  totals.customers = customers.size;
  totals.rounds = rounds.size;
  totals.houseResultKobo = totals.stakedKobo - totals.paidKobo - totals.refundedKobo;
  totals.avgPriceKobo = avg(totalPriceStake, totals.stakedKobo);

  return {
    topics: [...topics],
    hours,
    totals,
    open: { bets: openAgg?.bets ?? 0, stakeKobo: openAgg?.stakeKobo ?? 0 },
    customers: [...customers.values()]
      .map(({ priceStake, ...c }) => ({ ...c, avgPriceKobo: avg(priceStake, c.stakedKobo) }))
      .sort((a, b) => b.resultKobo - a.resultKobo)
      .slice(0, MAX_ROWS),
    rounds: [...rounds.values()]
      .map(({ priceStake, who, wins, ...r }) => ({
        ...r,
        customers: who.size,
        winning: [...wins],
        houseResultKobo: r.stakedKobo - r.paidKobo - r.refundedKobo,
        avgPriceKobo: avg(priceStake, r.stakedKobo),
      }))
      .slice(0, MAX_ROWS),
    bets: rows.slice(0, MAX_BET_ROWS).map((b) => ({
      id: String(b._id),
      marketId: b.marketId,
      authUserId: b.authUserId,
      username: userById.get(b.authUserId)?.username ?? "",
      eventTitle: b.eventTitle,
      marketTitle: b.marketTitle,
      outcomeLabel: b.outcomeLabel,
      stakeKobo: b.stakeKobo,
      priceKobo: b.priceKobo,
      payoutKobo: b.potentialPayoutKobo,
      status: b.status as SettledStatus,
      reversedFrom: (b.reversedFrom as TopicBet["reversedFrom"]) ?? null,
      placedAt: iso(b.createdAt),
      settledAt: iso(b.settledAt),
    })),
    truncated,
  };
}
