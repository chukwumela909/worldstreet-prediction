import type { FastifyBaseLogger } from "fastify";
import mongoose from "mongoose";
import { User } from "../models.js";
import { isCustomerMailConfigured, sendCustomerEmails } from "../customer-mail.js";
import { adjustNaira, writeOffDebt } from "./ledger.js";
import { LedgerEntry, NairaAccount, Position } from "./models.js";
import { pausedPattern } from "./paused.js";

/**
 * Reversing settled bets — the desk's recovery after a pricing glitch
 * (the 15-minute crypto "Up or Down" markets, exploited by buying the
 * side already decided). Every bet on the chosen topics' markets is
 * undone as if it never happened:
 *
 *   won  → its winnings are taken back and its stake returned:
 *          balance change = stake − payout (negative);
 *   lost → its stake is returned: balance change = +stake.
 *
 * Open bets aren't touched here: the topics must be paused first, and
 * the pause already refunds open bets every minute (settlement.ts).
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

function scope(topics: readonly string[], sinceDays: number | null) {
  const pattern = pausedPattern(topics);
  if (!pattern) return null;
  return {
    status: { $in: ["won", "lost"] as ("won" | "lost")[] },
    reversedFrom: { $exists: false },
    $or: [{ eventTitle: pattern }, { eventSlug: pattern }, { marketTitle: pattern }],
    ...(sinceDays !== null ? { createdAt: { $gte: new Date(Date.now() - sinceDays * 86_400_000) } } : {}),
  };
}

/** The balance change reversing a bet makes before any cap. */
const change = (b: Pick<Candidate, "status" | "stakeKobo" | "potentialPayoutKobo">) =>
  b.status === "won" ? b.stakeKobo - b.potentialPayoutKobo : b.stakeKobo;

/* ---------------- preview ---------------- */

export interface ReversalPreview {
  topics: string[];
  sinceDays: number | null;
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
  customerRows: {
    authUserId: string;
    username: string;
    email: string;
    bets: number;
    changeKobo: number;
    balanceKobo: number;
  }[];
}

export async function previewReversal(
  topics: readonly string[],
  sinceDays: number | null,
): Promise<ReversalPreview> {
  const base: ReversalPreview = {
    topics: [...topics],
    sinceDays,
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
  const q = scope(topics, sinceDays);
  if (!q) return base;
  const pattern = pausedPattern(topics)!;
  const [bets, openBets] = await Promise.all([
    Position.find(q, { authUserId: 1, eventTitle: 1, status: 1, stakeKobo: 1, potentialPayoutKobo: 1 }).lean<
      Candidate[]
    >(),
    Position.countDocuments({
      status: "open",
      $or: [{ eventTitle: pattern }, { eventSlug: pattern }, { marketTitle: pattern }],
    }),
  ]);

  const byUser = new Map<string, { bets: number; change: number }>();
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
    const u = byUser.get(b.authUserId) ?? { bets: 0, change: 0 };
    u.bets += 1;
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
    User.find({ authUserId: { $in: ids } }, { authUserId: 1, username: 1, email: 1 }).lean(),
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
        changeKobo: c.change,
        balanceKobo: balance,
      };
    })
    .sort((a, b) => a.changeKobo - b.changeKobo)
    .slice(0, MAX_ROWS);
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
  shortfall: Shortfall;
  actor: string;
  log: FastifyBaseLogger;
}): Promise<ReversalBatch> {
  const q = scope(params.topics, params.sinceDays);
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
        metadata: { positionId: String(b._id), reversedFrom: b.status, actor: params.actor },
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
  reversalNotifiedAt?: Date | null;
}

async function reversedBets(): Promise<Reversed[]> {
  return Position.find(
    { reversedFrom: { $exists: true } },
    {
      authUserId: 1,
      eventTitle: 1,
      stakeKobo: 1,
      potentialPayoutKobo: 1,
      reversedFrom: 1,
      reversedAt: 1,
      reversalKobo: 1,
      reversalShortKobo: 1,
      reversalNotifiedAt: 1,
    },
  ).lean<Reversed[]>();
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
      description: "Balance owed after the 15-minute crypto reversal — written off",
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

export interface ReversalNotice {
  customers: number;
  emailed: number;
  mailConfigured: boolean;
  dryRun: boolean;
}

/**
 * One email per customer with reversed bets they haven't been told
 * about: what was undone, what changed on their balance, and why — a
 * glitch in our system that affected these markets' prices.
 */
export async function notifyReversals(params: {
  dryRun: boolean;
  log: FastifyBaseLogger;
}): Promise<ReversalNotice> {
  const untold = (await reversedBets()).filter((b) => !b.reversalNotifiedAt);
  const byUser = new Map<string, Reversed[]>();
  for (const b of untold) byUser.set(b.authUserId, [...(byUser.get(b.authUserId) ?? []), b]);
  const base = { customers: byUser.size, mailConfigured: isCustomerMailConfigured() };
  if (params.dryRun || byUser.size === 0) return { ...base, emailed: 0, dryRun: params.dryRun };

  const ids = [...byUser.keys()];
  const [users, accounts] = await Promise.all([
    User.find({ authUserId: { $in: ids } }, { authUserId: 1, username: 1, email: 1 }).lean(),
    NairaAccount.find({ authUserId: { $in: ids } }, { authUserId: 1, balanceKobo: 1 }).lean(),
  ]);
  const balanceById = new Map(accounts.map((a) => [a.authUserId, a.balanceKobo]));
  const recipients = users.filter((u) => u.email);
  const naira = (kobo: number) =>
    `${kobo < 0 ? "−" : ""}₦${(Math.abs(kobo) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const results = await sendCustomerEmails(
    params.log,
    recipients.map((u) => {
      const bets = byUser.get(u.authUserId)!;
      const staked = bets.reduce((s, b) => s + b.stakeKobo, 0);
      const winnings = bets
        .filter((b) => b.reversedFrom === "won")
        .reduce((s, b) => s + b.potentialPayoutKobo, 0);
      const net = bets.reduce((s, b) => s + (b.reversalKobo ?? 0), 0);
      const balance = balanceById.get(u.authUserId) ?? 0;
      return {
        to: u.email,
        subject: "Important: your 15-minute crypto bets have been reversed",
        text: [
          `Hi ${u.username},`,
          "",
          "We found a glitch in our system that affected the prices on our 15-minute crypto markets (Bitcoin, Ethereum and others), and it was being exploited. To keep the platform safe and fair for everyone, we have cancelled every bet placed on these markets.",
          "",
          "What this means for you:",
          `• Bets cancelled: ${bets.length}`,
          `• Your stakes on them (${naira(staked)}) have been returned`,
          ...(winnings > 0 ? [`• Payouts on them (${naira(winnings)}) have been taken back`] : []),
          `• Change to your balance: ${net > 0 ? "+" : ""}${naira(net)}`,
          `• Your balance now: ${naira(balance)}`,
          ...(balance < 0
            ? [
                "",
                "Your balance is below zero because some of those payouts had already been used. You won't be able to bet or withdraw until it's back above zero; any new credit covers it first.",
              ]
            : []),
          "",
          "We're sorry for the disruption, and thank you for bearing with us while we fix it.",
          "",
          "The WorldStreet team",
        ].join("\n"),
      };
    }),
  );

  const told = recipients
    .filter((_, i) => results[i])
    .flatMap((u) => byUser.get(u.authUserId)!.map((b) => b._id));
  if (told.length > 0) {
    await Position.updateMany({ _id: { $in: told } }, { $set: { reversalNotifiedAt: new Date() } });
  }
  const emailed = results.filter(Boolean).length;
  params.log.warn({ emailed, customers: byUser.size }, "reversal emails sent");
  return { ...base, emailed, dryRun: false };
}
