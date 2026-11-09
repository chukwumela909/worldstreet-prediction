import type { FastifyBaseLogger } from "fastify";
import mongoose from "mongoose";
import { ApiError } from "../errors.js";
import { User } from "../models.js";
import { isCustomerMailConfigured, sendCustomerEmails } from "../customer-mail.js";
import { adjustNaira, writeOffDebt } from "./ledger.js";
import { LedgerEntry, NairaAccount, Position } from "./models.js";
import { pausedPattern } from "./paused.js";

/**
 * Reversing settled bets — the desk's recovery after an incident on any
 * market: a pricing glitch (the 15-minute crypto "Up or Down" markets,
 * exploited by buying the side already decided), a result that was known
 * before the market closed, and so on. The desk names the markets — words
 * in their titles, or one market's slug — and says why. Every bet on them
 * is undone as if it never happened:
 *
 *   won  → its winnings are taken back and its stake returned:
 *          balance change = stake − payout (negative);
 *   lost → its stake is returned: balance change = +stake.
 *
 * Open bets aren't touched here: markets that still hold some must be
 * paused first, and the pause refunds open bets every minute
 * (settlement.ts).
 *
 * The reason is stored on every bet it reverses (`reversalReason`), so
 * the customer's email quotes it and the desk can see each incident's
 * totals apart.
 *
 * A winner who has already spent or withdrawn the winnings can't cover
 * the take-back. "negative" takes it all, leaving them owing (a negative
 * balance, which blocks betting and withdrawing until new credit covers
 * it); "cap" takes only what their balance holds and writes off the rest.
 *
 * Each bet is one ledger entry (`reverse:<positionId>`, type "reversal")
 * and one guarded status change to "voided" with `reversedFrom`, so a
 * run can stop half way and be resumed, and nothing is ever reversed
 * twice. Runs go in batches so a big reversal never outlasts a request.
 */

const BATCH = 300;
const MAX_ROWS = 500;

export type Shortfall = "negative" | "cap";

interface Candidate {
  _id: mongoose.Types.ObjectId;
  authUserId: string;
  eventTitle: string;
  status: "won" | "lost";
  stakeKobo: number;
  potentialPayoutKobo: number;
}

/** Bets on markets whose event title, slug or market title names a topic. */
function onMarkets(topics: readonly string[]) {
  const pattern = pausedPattern(topics);
  return pattern ? [{ eventTitle: pattern }, { eventSlug: pattern }, { marketTitle: pattern }] : null;
}

/**
 * Where the bets in scope start: an exact moment (`sinceAt`, e.g. the day
 * a rule went live) wins over a rolling count of days back from now.
 */
function cutoff(sinceDays: number | null, sinceAt?: Date | null): Date | null {
  if (sinceAt) return sinceAt;
  return sinceDays !== null ? new Date(Date.now() - sinceDays * 86_400_000) : null;
}

/** The settled bets in scope; `authUserId` narrows it to one customer. */
function scope(topics: readonly string[], since: Date | null, authUserId?: string) {
  const markets = onMarkets(topics);
  if (!markets) return null;
  return {
    status: { $in: ["won", "lost"] as ("won" | "lost")[] },
    reversedFrom: { $exists: false },
    $or: markets,
    ...(authUserId ? { authUserId } : {}),
    ...(since ? { createdAt: { $gte: since } } : {}),
  };
}

/** Bets still open on these markets — a reversal waits for them to be paused. */
export async function openBetsMatching(topics: readonly string[], authUserId?: string): Promise<number> {
  const markets = onMarkets(topics);
  return markets ? Position.countDocuments({ status: "open", $or: markets, ...(authUserId ? { authUserId } : {}) }) : 0;
}

/** One customer by username or email, for a reversal aimed at them alone. */
export async function findCustomerId(name: string): Promise<string> {
  const clean = name.trim().replace(/^@/, "");
  const user = await User.findOne({ $or: [{ username: clean }, { email: clean.toLowerCase() }] }, { authUserId: 1 })
    .collation({ locale: "en", strength: 2 })
    .lean();
  if (!user) throw new ApiError(404, "No customer with that username or email", "USER_NOT_FOUND");
  return user.authUserId;
}

/** The balance change reversing a bet makes before any cap. */
const change = (b: Pick<Candidate, "status" | "stakeKobo" | "potentialPayoutKobo">) =>
  b.status === "won" ? b.stakeKobo - b.potentialPayoutKobo : b.stakeKobo;

/* ---------------- preview ---------------- */

export interface ReversalPreview {
  topics: string[];
  sinceDays: number | null;
  /** The exact start, when one was given; echoed so the desk knows it was used. */
  sinceAt: string | null;
  bets: number;
  won: number;
  lost: number;
  customers: number;
  /** Winnings taken back (payout − stake on won bets). */
  takeBackKobo: number;
  /** Stakes returned on lost bets. */
  returnKobo: number;
  /** takeBack − return: what the book gets back. */
  netKobo: number;
  /** Customers whose balance can't cover their take-back, and by how much in all. */
  shortCustomers: number;
  shortKobo: number;
  /** Open bets on these markets — refunded by the pause, not reversed. */
  openBets: number;
  /** The markets matched, most bets first, so the desk can check the scope. */
  events: { title: string; bets: number }[];
  /**
   * For one customer, given a reason: the email the reversal will lead to,
   * as if their whole take-back is collected. Null with nothing to reverse.
   */
  letter?: ReversalLetter | null;
  customerRows: {
    authUserId: string;
    username: string;
    email: string;
    bets: number;
    won: number;
    lost: number;
    changeKobo: number;
    balanceKobo: number;
    suspended: boolean;
    withdrawalsLocked: boolean;
  }[];
}

export async function previewReversal(
  topics: readonly string[],
  sinceDays: number | null,
  authUserId?: string,
  sinceAt?: Date | null,
  /** With a customer: write the email this would lead to, giving this reason. */
  reason?: string,
): Promise<ReversalPreview> {
  const base: ReversalPreview = {
    topics: [...topics],
    sinceDays,
    sinceAt: sinceAt?.toISOString() ?? null,
    bets: 0,
    won: 0,
    lost: 0,
    customers: 0,
    takeBackKobo: 0,
    returnKobo: 0,
    netKobo: 0,
    shortCustomers: 0,
    shortKobo: 0,
    openBets: 0,
    events: [],
    customerRows: [],
  };
  const q = scope(topics, cutoff(sinceDays, sinceAt), authUserId);
  if (!q) return base;
  const [bets, openBets] = await Promise.all([
    Position.find(q, { authUserId: 1, eventTitle: 1, status: 1, stakeKobo: 1, potentialPayoutKobo: 1 }).lean<
      Candidate[]
    >(),
    openBetsMatching(topics, authUserId),
  ]);

  const byUser = new Map<string, { bets: number; won: number; lost: number; change: number }>();
  const events = new Map<string, number>();
  for (const b of bets) {
    const c = change(b);
    if (b.status === "won") {
      base.won += 1;
      base.takeBackKobo += -c;
    } else {
      base.lost += 1;
      base.returnKobo += c;
    }
    const u = byUser.get(b.authUserId) ?? { bets: 0, won: 0, lost: 0, change: 0 };
    u.bets += 1;
    if (b.status === "won") u.won += 1;
    else u.lost += 1;
    u.change += c;
    byUser.set(b.authUserId, u);
    events.set(b.eventTitle, (events.get(b.eventTitle) ?? 0) + 1);
  }
  base.bets = bets.length;
  base.customers = byUser.size;
  base.netKobo = base.takeBackKobo - base.returnKobo;
  base.openBets = openBets;
  base.events = [...events.entries()]
    .map(([title, n]) => ({ title, bets: n }))
    .sort((a, b) => b.bets - a.bets)
    .slice(0, 30);

  const ids = [...byUser.keys()];
  const [users, accounts] = await Promise.all([
    User.find(
      { authUserId: { $in: ids } },
      { authUserId: 1, username: 1, email: 1, suspendedAt: 1, withdrawalsLockedAt: 1 },
    ).lean(),
    NairaAccount.find({ authUserId: { $in: ids } }, { authUserId: 1, balanceKobo: 1 }).lean(),
  ]);
  const userById = new Map(users.map((u) => [u.authUserId, u]));
  const balanceById = new Map(accounts.map((a) => [a.authUserId, a.balanceKobo]));
  base.customerRows = ids
    .map((id) => {
      const balance = balanceById.get(id) ?? 0;
      const c = byUser.get(id)!;
      if (balance + c.change < 0) {
        base.shortCustomers += 1;
        base.shortKobo += -(balance + c.change);
      }
      return {
        authUserId: id,
        username: userById.get(id)?.username ?? "",
        email: userById.get(id)?.email ?? "",
        bets: c.bets,
        won: c.won,
        lost: c.lost,
        changeKobo: c.change,
        balanceKobo: balance,
        suspended: Boolean(userById.get(id)?.suspendedAt),
        withdrawalsLocked: Boolean(userById.get(id)?.withdrawalsLockedAt),
      };
    })
    .sort((a, b) => a.changeKobo - b.changeKobo)
    .slice(0, MAX_ROWS);

  const row = authUserId ? base.customerRows[0] : undefined;
  if (row && reason) {
    base.letter = row.email
      ? {
          to: row.email,
          ...reversalLetter({
            username: row.username,
            bets: base.bets,
            reason,
            takenKobo: base.takeBackKobo,
            returnedKobo: base.returnKobo,
            onlyLost: true,
            balanceKobo: row.balanceKobo + row.changeKobo,
            markets: [...events.entries()].sort((x, y) => y[1] - x[1]).map(([t]) => t),
          }),
        }
      : null;
  }
  return base;
}

/* ---------------- running it ---------------- */

export interface ReversalBatch {
  /** Bets reversed in this call. */
  reversed: number;
  /** Bets still to reverse — call again until 0. */
  remaining: number;
  /** Balance changes made in this call (signed sum). */
  changeKobo: number;
  /** Take-back that couldn't be collected and was written off (cap only). */
  writtenOffKobo: number;
}

/** Reverse up to one batch of bets in scope. Safe to repeat: done bets drop out. */
export async function runReversalBatch(params: {
  topics: readonly string[];
  sinceDays: number | null;
  /** An exact start; wins over sinceDays. */
  sinceAt?: Date | null;
  /** Only this customer's bets, when set. */
  authUserId?: string;
  shortfall: Shortfall;
  /** Why — kept on every bet for the customer's email. */
  reason: string;
  actor: string;
  log: FastifyBaseLogger;
}): Promise<ReversalBatch> {
  const q = scope(params.topics, cutoff(params.sinceDays, params.sinceAt), params.authUserId);
  if (!q) return { reversed: 0, remaining: 0, changeKobo: 0, writtenOffKobo: 0 };
  const batch = await Position.find(q, {
    authUserId: 1,
    eventTitle: 1,
    status: 1,
    stakeKobo: 1,
    potentialPayoutKobo: 1,
  })
    .sort({ authUserId: 1, _id: 1 })
    .limit(BATCH)
    .lean<Candidate[]>();

  let reversed = 0;
  let changeKobo = 0;
  let writtenOffKobo = 0;
  for (const b of batch) {
    let amount = change(b);
    let short = 0;
    if (amount < 0 && params.shortfall === "cap") {
      const account = await NairaAccount.findOne({ authUserId: b.authUserId }, { balanceKobo: 1 }).lean();
      const take = Math.min(-amount, Math.max(account?.balanceKobo ?? 0, 0));
      short = -amount - take;
      amount = -take;
    }
    let applied = 0;
    if (amount !== 0) {
      const entry = await adjustNaira({
        authUserId: b.authUserId,
        amountKobo: amount,
        type: "reversal",
        refKey: `reverse:${String(b._id)}`,
        description:
          b.status === "won"
            ? `Reversed: winnings taken back, stake returned — ${b.eventTitle}`
            : `Reversed: stake returned — ${b.eventTitle}`,
        metadata: { positionId: String(b._id), reversedFrom: b.status, actor: params.actor, reason: params.reason },
      });
      // a resumed run finds the entry the first try wrote — that's what moved
      applied = entry.amountKobo;
    }
    const updated = await Position.updateOne(
      { _id: b._id, status: b.status, reversedFrom: { $exists: false } },
      {
        $set: {
          status: "voided",
          reversedFrom: b.status,
          reversedAt: new Date(),
          reversalKobo: applied,
          reversalShortKobo: short,
          reversalReason: params.reason,
        },
      },
    );
    if (updated.modifiedCount > 0) {
      reversed += 1;
      changeKobo += applied;
      writtenOffKobo += short;
    }
  }
  const remaining = await Position.countDocuments(q);
  params.log.warn(
    { reversed, remaining, changeKobo, writtenOffKobo, actor: params.actor, topics: params.topics },
    "bets reversed",
  );
  return { reversed, remaining, changeKobo, writtenOffKobo };
}

/* ---------------- what's been recovered ---------------- */

export interface RecoveryCustomer {
  authUserId: string;
  username: string;
  email: string;
  bets: number;
  /** Winnings taken back on won bets. */
  takenBackKobo: number;
  /** Stakes returned on lost bets. */
  returnedKobo: number;
  /** Written off: not collected on a capped run, or a debt the desk cleared. */
  writtenOffKobo: number;
  balanceKobo: number;
  /** When the reversal email went; null = not told yet. */
  emailedAt: string | null;
  reversedAt: string | null;
}

/** One incident: every bet reversed for the same reason. */
export interface RecoveryIncident {
  /** The reason as the desk wrote it; "" for the first, unrecorded one. */
  reason: string;
  bets: number;
  customers: number;
  takenBackKobo: number;
  returnedKobo: number;
  /** takenBack − returned, before any debt was written off. */
  netKobo: number;
  /** When its first and latest bets were reversed. */
  firstAt: string | null;
  lastAt: string | null;
  /** Bets whose customer hasn't been emailed yet. */
  untoldBets: number;
}

export interface RecoveryReport {
  totals: {
    bets: number;
    customers: number;
    takenBackKobo: number;
    returnedKobo: number;
    /** takenBack − returned − written off: what the book really got back. */
    netKobo: number;
    /** Part of it still owed by customers in negative balance. */
    owedKobo: number;
    owingCustomers: number;
    writtenOffKobo: number;
    emailed: number;
    notEmailed: number;
  };
  mailConfigured: boolean;
  /** Newest first. */
  incidents: RecoveryIncident[];
  customers: RecoveryCustomer[];
}

interface Reversed {
  _id: mongoose.Types.ObjectId;
  authUserId: string;
  eventTitle: string;
  stakeKobo: number;
  potentialPayoutKobo: number;
  reversedFrom: "won" | "lost" | "open";
  reversedAt?: Date | null;
  reversalKobo?: number | null;
  reversalShortKobo?: number | null;
  reversalReason?: string | null;
  reversalNotifiedAt?: Date | null;
}

async function reversedBets(authUserId?: string): Promise<Reversed[]> {
  return Position.find(
    { reversedFrom: { $exists: true }, ...(authUserId ? { authUserId } : {}) },
    {
      authUserId: 1,
      eventTitle: 1,
      stakeKobo: 1,
      potentialPayoutKobo: 1,
      reversedFrom: 1,
      reversedAt: 1,
      reversalKobo: 1,
      reversalShortKobo: 1,
      reversalReason: 1,
      reversalNotifiedAt: 1,
    },
  ).lean<Reversed[]>();
}

function incidentsOf(bets: Reversed[]): RecoveryIncident[] {
  const byReason = new Map<string, RecoveryIncident & { people: Set<string> }>();
  for (const b of bets) {
    const reason = b.reversalReason ?? "";
    const i =
      byReason.get(reason) ??
      {
        reason,
        bets: 0,
        customers: 0,
        takenBackKobo: 0,
        returnedKobo: 0,
        netKobo: 0,
        firstAt: null,
        lastAt: null,
        untoldBets: 0,
        people: new Set<string>(),
      };
    const k = b.reversalKobo ?? 0;
    i.bets += 1;
    i.people.add(b.authUserId);
    if (k < 0) i.takenBackKobo += -k;
    else i.returnedKobo += k;
    if (!b.reversalNotifiedAt) i.untoldBets += 1;
    const at = b.reversedAt?.toISOString() ?? null;
    if (at && (!i.firstAt || at < i.firstAt)) i.firstAt = at;
    if (at && (!i.lastAt || at > i.lastAt)) i.lastAt = at;
    byReason.set(reason, i);
  }
  return [...byReason.values()]
    .map(({ people, ...i }) => ({ ...i, customers: people.size, netKobo: i.takenBackKobo - i.returnedKobo }))
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}

export async function getRecovery(): Promise<RecoveryReport> {
  const bets = await reversedBets();
  const byUser = new Map<
    string,
    { bets: number; taken: number; returned: number; off: number; told: Date | null; untold: number; at: Date | null }
  >();
  for (const b of bets) {
    const u = byUser.get(b.authUserId) ?? { bets: 0, taken: 0, returned: 0, off: 0, told: null, untold: 0, at: null };
    const k = b.reversalKobo ?? 0;
    u.bets += 1;
    if (k < 0) u.taken += -k;
    else u.returned += k;
    u.off += b.reversalShortKobo ?? 0;
    if (b.reversalNotifiedAt) u.told = !u.told || b.reversalNotifiedAt > u.told ? b.reversalNotifiedAt : u.told;
    else u.untold += 1;
    if (b.reversedAt && (!u.at || b.reversedAt > u.at)) u.at = b.reversedAt;
    byUser.set(b.authUserId, u);
  }
  const ids = [...byUser.keys()];
  const [users, accounts, writeOffs] = await Promise.all([
    User.find({ authUserId: { $in: ids } }, { authUserId: 1, username: 1, email: 1 }).lean(),
    NairaAccount.find({ authUserId: { $in: ids } }, { authUserId: 1, balanceKobo: 1 }).lean(),
    LedgerEntry.find({ type: "debt_writeoff", authUserId: { $in: ids } }, { authUserId: 1, amountKobo: 1 }).lean(),
  ]);
  const userById = new Map(users.map((u) => [u.authUserId, u]));
  const balanceById = new Map(accounts.map((a) => [a.authUserId, a.balanceKobo]));
  for (const w of writeOffs) {
    const u = byUser.get(w.authUserId);
    if (u) u.off += w.amountKobo;
  }
  const debtOffKobo = writeOffs.reduce((sum, w) => sum + w.amountKobo, 0);

  const customers: RecoveryCustomer[] = ids.map((id) => {
    const u = byUser.get(id)!;
    return {
      authUserId: id,
      username: userById.get(id)?.username ?? "",
      email: userById.get(id)?.email ?? "",
      bets: u.bets,
      takenBackKobo: u.taken,
      returnedKobo: u.returned,
      writtenOffKobo: u.off,
      balanceKobo: balanceById.get(id) ?? 0,
      emailedAt: u.untold === 0 && u.told ? u.told.toISOString() : null,
      reversedAt: u.at ? u.at.toISOString() : null,
    };
  });
  customers.sort((a, b) => b.takenBackKobo - b.returnedKobo - (a.takenBackKobo - a.returnedKobo));

  const takenBackKobo = customers.reduce((s, c) => s + c.takenBackKobo, 0);
  const returnedKobo = customers.reduce((s, c) => s + c.returnedKobo, 0);
  const owing = customers.filter((c) => c.balanceKobo < 0);
  const emailed = customers.filter((c) => c.emailedAt).length;
  return {
    totals: {
      bets: bets.length,
      customers: customers.length,
      takenBackKobo,
      returnedKobo,
      netKobo: takenBackKobo - returnedKobo - debtOffKobo,
      owedKobo: owing.reduce((s, c) => s + -c.balanceKobo, 0),
      owingCustomers: owing.length,
      writtenOffKobo: customers.reduce((s, c) => s + c.writtenOffKobo, 0),
      emailed,
      notEmailed: customers.length - emailed,
    },
    mailConfigured: isCustomerMailConfigured(),
    incidents: incidentsOf(bets),
    customers: customers.slice(0, MAX_ROWS),
  };
}

/* ---------------- clearing what's owed ---------------- */

export interface DebtClearing {
  /** Customers with reversed bets now below zero (cleared, unless a dry run). */
  customers: number;
  /** What they owe(d) in all. */
  owedKobo: number;
  dryRun: boolean;
}

/**
 * Forgive what reversal customers owe: every one of them below zero is
 * brought back to exactly zero (ledger type "debt_writeoff"), which lifts
 * the block on betting and withdrawing. Everything already recovered
 * stays recovered. A dry run only counts.
 */
export async function clearDebts(params: {
  dryRun: boolean;
  actor: string;
  log: FastifyBaseLogger;
}): Promise<DebtClearing> {
  const ids: string[] = await Position.distinct("authUserId", { reversedFrom: { $exists: true } });
  const owing = await NairaAccount.find(
    { authUserId: { $in: ids }, balanceKobo: { $lt: 0 } },
    { authUserId: 1, balanceKobo: 1 },
  ).lean();
  const owedKobo = owing.reduce((sum, a) => sum + -a.balanceKobo, 0);
  if (params.dryRun || owing.length === 0) {
    return { customers: owing.length, owedKobo, dryRun: params.dryRun };
  }

  let customers = 0;
  let cleared = 0;
  const at = Date.now();
  for (const a of owing) {
    const entry = await writeOffDebt({
      authUserId: a.authUserId,
      refKey: `writeoff:${a.authUserId}:${at}`,
      description: "Balance owed after a reversal — written off",
      metadata: { actor: params.actor },
    });
    if (entry) {
      customers += 1;
      cleared += entry.amountKobo;
    }
  }
  params.log.warn({ customers, cleared, actor: params.actor }, "reversal debts written off");
  return { customers, owedKobo: cleared, dryRun: false };
}

/* ---------------- telling them ---------------- */

/** One email, as it goes out. */
export interface ReversalLetter {
  to: string;
  subject: string;
  text: string;
}

export interface ReversalNotice {
  customers: number;
  emailed: number;
  mailConfigured: boolean;
  dryRun: boolean;
  /** For one customer on a dry run: their emails exactly as they'd go out. */
  letters?: ReversalLetter[];
}

/** What the first reversals were for — they were made before reasons were kept. */
const UNRECORDED_REASON =
  "A glitch in our system affected the prices on our 15-minute crypto markets, and it was being exploited.";

const naira = (kobo: number) =>
  `${kobo < 0 ? "−" : ""}₦${(Math.abs(kobo) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What one email says: from the reversed bets, or from a preview before anything moves. */
export interface LetterFacts {
  username: string;
  bets: number;
  reason: string;
  /** Winnings taken back (less, where the balance couldn't cover them). */
  takenKobo: number;
  /** Stakes returned. */
  returnedKobo: number;
  /** Every returned stake was on a lost bet, none on an open one. */
  onlyLost: boolean;
  balanceKobo: number;
  /** Most bets first. */
  markets: string[];
}

/**
 * The reversal email: what was undone, what changed on their balance, and
 * why — the reason in the desk's own words. The one place it's written,
 * so the desk's preview and the email sent can't differ.
 */
export function reversalLetter(f: LetterFacts): { subject: string; text: string } {
  const net = f.returnedKobo - f.takenKobo;
  return {
    subject: "Important: some of your bets have been reversed",
    text: [
      `Hi ${f.username},`,
      "",
      `We've reversed ${f.bets === 1 ? "one of your bets" : `${f.bets} of your bets`} on WorldStreet Predict.`,
      "",
      "Why we did this:",
      f.reason,
      "",
      "What changed:",
      ...(f.takenKobo > 0 ? [`• Winnings taken back: ${naira(f.takenKobo)}`] : []),
      ...(f.returnedKobo > 0
        ? [`• ${f.onlyLost ? "Stakes returned on bets you lost" : "Stakes returned"}: ${naira(f.returnedKobo)}`]
        : []),
      `• Change to your balance: ${net > 0 ? "+" : ""}${naira(net)}`,
      `• Your balance now: ${naira(f.balanceKobo)}`,
      ...(f.balanceKobo < 0
        ? [
            "",
            "Your balance is below zero because some of those winnings had already been used. You can't bet or withdraw until it's back above zero, and any new credit goes towards it first.",
          ]
        : []),
      "",
      `${f.markets.length === 1 ? "Market" : "Markets"}:`,
      ...f.markets.slice(0, 5).map((m) => `• ${m}`),
      ...(f.markets.length > 5 ? [`• and ${f.markets.length - 5} more`] : []),
      "",
      "Questions? Contact us from the Support page on WorldStreet Predict.",
      "",
      "The WorldStreet team",
    ].join("\n"),
  };
}

/** Market titles, most bets first. */
function byMostBets(titles: string[]): string[] {
  const counts = new Map<string, number>();
  for (const t of titles) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

/**
 * One email per customer per incident they haven't been told about. The
 * first reversals, made before reasons were kept, give the reason they
 * were made for (UNRECORDED_REASON). `authUserId` keeps it to one
 * customer; a dry run for one customer returns their emails as written,
 * so the desk can read them, and share them, before sending.
 */
export async function notifyReversals(params: {
  dryRun: boolean;
  authUserId?: string;
  /**
   * The desk's own wording for the one email waiting for `authUserId`,
   * edited from the one written here. Refused when more than one waits.
   */
  edited?: { subject: string; text: string };
  log: FastifyBaseLogger;
}): Promise<ReversalNotice> {
  const untold = (await reversedBets(params.authUserId)).filter((b) => !b.reversalNotifiedAt);
  const byUser = new Map<string, Reversed[]>();
  for (const b of untold) byUser.set(b.authUserId, [...(byUser.get(b.authUserId) ?? []), b]);
  const base = { customers: byUser.size, mailConfigured: isCustomerMailConfigured() };
  const one = Boolean(params.authUserId);
  if (byUser.size === 0) return { ...base, emailed: 0, dryRun: params.dryRun, ...(one ? { letters: [] } : {}) };
  if (params.dryRun && !one) return { ...base, emailed: 0, dryRun: true };

  // one letter per customer per reason: [customer, that reason's bets]
  const letters: [string, Reversed[]][] = [];
  for (const [id, bets] of byUser) {
    const byReason = new Map<string, Reversed[]>();
    for (const b of bets) {
      const r = b.reversalReason ?? "";
      byReason.set(r, [...(byReason.get(r) ?? []), b]);
    }
    for (const group of byReason.values()) letters.push([id, group]);
  }

  const ids = [...byUser.keys()];
  const [users, accounts] = await Promise.all([
    User.find({ authUserId: { $in: ids } }, { authUserId: 1, username: 1, email: 1 }).lean(),
    NairaAccount.find({ authUserId: { $in: ids } }, { authUserId: 1, balanceKobo: 1 }).lean(),
  ]);
  const balanceById = new Map(accounts.map((a) => [a.authUserId, a.balanceKobo]));
  const userById = new Map(users.filter((u) => u.email).map((u) => [u.authUserId, u]));

  const sendable = letters.filter(([id]) => userById.has(id));
  const mails: ReversalLetter[] = sendable.map(([id, bets]) => {
    const u = userById.get(id)!;
    return {
      to: u.email,
      ...reversalLetter({
        username: u.username,
        bets: bets.length,
        reason: bets[0]?.reversalReason || UNRECORDED_REASON,
        // what actually moved, bet by bet: a won bet's winnings taken back
        // (less, where the balance couldn't cover them), a lost or open
        // bet's stake returned — the same two figures the desk saw
        takenKobo: bets.reduce((s, b) => s + Math.max(-(b.reversalKobo ?? 0), 0), 0),
        returnedKobo: bets.reduce((s, b) => s + Math.max(b.reversalKobo ?? 0, 0), 0),
        onlyLost: bets.every((b) => b.reversedFrom !== "open"),
        balanceKobo: balanceById.get(id) ?? 0,
        markets: byMostBets(bets.map((b) => b.eventTitle)),
      }),
    };
  });
  if (params.edited) {
    if (!params.authUserId || mails.length !== 1) {
      throw new ApiError(409, "An edited email can only replace a single waiting email for one customer", "NOT_ONE_EMAIL");
    }
    mails[0] = { ...mails[0]!, subject: params.edited.subject, text: params.edited.text };
  }
  if (params.dryRun) return { ...base, emailed: 0, dryRun: true, letters: mails };

  const results = await sendCustomerEmails(params.log, mails);
  const told = sendable.filter((_, i) => results[i]).flatMap(([, bets]) => bets.map((b) => b._id));
  if (told.length > 0) {
    await Position.updateMany({ _id: { $in: told } }, { $set: { reversalNotifiedAt: new Date() } });
  }
  const emailedTo = new Set(sendable.filter((_, i) => results[i]).map(([id]) => id));
  params.log.warn({ emails: results.filter(Boolean).length, customers: byUser.size }, "reversal emails sent");
  return { ...base, emailed: emailedTo.size, dryRun: false };
}
