import type { FastifyBaseLogger } from "fastify";
import mongoose from "mongoose";
import { User } from "../models.js";
import { isCustomerMailConfigured, sendCustomerEmails } from "../customer-mail.js";
import { Position, Settlement } from "./models.js";
import { pausedPattern } from "./paused.js";

/**
 * What a paused topic's voids did to customers: who was refunded, how
 * much, on which markets, and whether they've had the apology email —
 * the desk's Paused markets report — plus the email itself.
 *
 * A refunded bet is a voided position on a market the paused topics
 * cover, voided within the report's window (so an old, unrelated void
 * of a Bitcoin market isn't mistaken for this one). Each bet records when
 * its customer was told (`refundNotifiedAt`), so nobody is emailed twice:
 * the automatic void emails as it refunds, and the desk's one-off action
 * reaches whoever was refunded before the emails existed.
 */

const ACTOR_AUTO = "system:paused";
const MAX_HOURS = 24 * 30;
const MAX_ROWS = 500;

interface RefundedBet {
  _id: mongoose.Types.ObjectId;
  authUserId: string;
  eventTitle: string;
  marketId: string;
  marketTitle: string;
  stakeKobo: number;
  settledAt?: Date | null;
  settlementId?: string | null;
  refundNotifiedAt?: Date | null;
}

async function refundedBets(topics: readonly string[], hours: number): Promise<RefundedBet[]> {
  const pattern = pausedPattern(topics);
  if (!pattern) return [];
  const since = new Date(Date.now() - Math.min(Math.max(hours, 1), MAX_HOURS) * 3_600_000);
  return Position.find(
    {
      status: "voided",
      settledAt: { $gte: since },
      $or: [{ eventTitle: pattern }, { eventSlug: pattern }, { marketTitle: pattern }],
    },
    {
      authUserId: 1,
      eventTitle: 1,
      marketId: 1,
      marketTitle: 1,
      stakeKobo: 1,
      settledAt: 1,
      settlementId: 1,
      refundNotifiedAt: 1,
    },
  ).lean<RefundedBet[]>();
}

/* ---------------- the report ---------------- */

export interface PausedRefundMarket {
  marketId: string;
  eventTitle: string;
  marketTitle: string;
  bets: number;
  refundKobo: number;
  voidedAt: string | null;
  /** "auto" — the minute-by-minute pause — or the admin who voided it. */
  voidedBy: string;
  reason: string;
}

export interface PausedRefundCustomer {
  authUserId: string;
  username: string;
  email: string;
  bets: number;
  refundKobo: number;
  events: string[];
  refundedAt: string | null;
  /** When the apology email went, once every refunded bet of theirs is covered. */
  emailedAt: string | null;
}

export interface PausedRefundReport {
  topics: string[];
  hours: number;
  mailConfigured: boolean;
  totals: {
    customers: number;
    bets: number;
    refundKobo: number;
    emailed: number;
    notEmailed: number;
  };
  markets: PausedRefundMarket[];
  customers: PausedRefundCustomer[];
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const later = (a: Date | null | undefined, b: Date | null | undefined) =>
  !a ? b ?? null : !b ? a : a > b ? a : b;

export async function getPausedRefunds(
  topics: readonly string[],
  hours: number,
): Promise<PausedRefundReport> {
  const bets = await refundedBets(topics, hours);

  const settlementIds = [...new Set(bets.map((b) => b.settlementId).filter(Boolean))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id!))
    .map((id) => new mongoose.Types.ObjectId(id!));
  const [settlements, users] = await Promise.all([
    Settlement.find({ _id: { $in: settlementIds } }, { actor: 1, evidence: 1, createdAt: 1 }).lean(),
    User.find(
      { authUserId: { $in: [...new Set(bets.map((b) => b.authUserId))] } },
      { authUserId: 1, username: 1, email: 1 },
    ).lean(),
  ]);
  const settlementById = new Map(settlements.map((s) => [String(s._id), s]));
  const userById = new Map(users.map((u) => [u.authUserId, u]));

  const markets = new Map<string, PausedRefundMarket & { at: Date | null }>();
  const customers = new Map<
    string,
    { bets: number; kobo: number; events: Set<string>; at: Date | null; told: Date | null; untold: number }
  >();
  for (const b of bets) {
    const s = b.settlementId ? settlementById.get(b.settlementId) : undefined;
    const m = markets.get(b.marketId) ?? {
      marketId: b.marketId,
      eventTitle: b.eventTitle,
      marketTitle: b.marketTitle,
      bets: 0,
      refundKobo: 0,
      voidedAt: null,
      voidedBy: s?.actor === ACTOR_AUTO ? "auto" : (s?.actor ?? "unknown"),
      reason: String((s?.evidence as { reason?: unknown } | undefined)?.reason ?? ""),
      at: null,
    };
    m.bets += 1;
    m.refundKobo += b.stakeKobo;
    m.at = later(m.at, b.settledAt);
    markets.set(b.marketId, m);

    const c = customers.get(b.authUserId) ?? {
      bets: 0,
      kobo: 0,
      events: new Set<string>(),
      at: null,
      told: null,
      untold: 0,
    };
    c.bets += 1;
    c.kobo += b.stakeKobo;
    c.events.add(b.eventTitle);
    c.at = later(c.at, b.settledAt);
    if (b.refundNotifiedAt) c.told = later(c.told, b.refundNotifiedAt);
    else c.untold += 1;
    customers.set(b.authUserId, c);
  }

  const customerRows = [...customers.entries()]
    .map(([authUserId, c]) => {
      const u = userById.get(authUserId);
      return {
        authUserId,
        username: u?.username ?? "",
        email: u?.email ?? "",
        bets: c.bets,
        refundKobo: c.kobo,
        events: [...c.events],
        refundedAt: iso(c.at),
        emailedAt: c.untold === 0 ? iso(c.told) : null,
      };
    })
    .sort((a, b) => b.refundKobo - a.refundKobo);
  const emailed = customerRows.filter((c) => c.emailedAt !== null).length;

  return {
    topics: [...topics],
    hours,
    mailConfigured: isCustomerMailConfigured(),
    totals: {
      customers: customerRows.length,
      bets: bets.length,
      refundKobo: bets.reduce((sum, b) => sum + b.stakeKobo, 0),
      emailed,
      notEmailed: customerRows.length - emailed,
    },
    markets: [...markets.values()]
      .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
      .slice(0, MAX_ROWS)
      .map(({ at, ...m }) => ({ ...m, voidedAt: iso(at) })),
    customers: customerRows.slice(0, MAX_ROWS),
  };
}

/* ---------------- the apology email ---------------- */

/**
 * One email per refunded customer — what was cancelled and what came
 * back — covering only bets they haven't been told about. Each bet is
 * marked once its customer's email is accepted. Returns how many went.
 */
export async function emailRefunds(
  bets: Pick<RefundedBet, "_id" | "authUserId" | "eventTitle" | "stakeKobo" | "refundNotifiedAt">[],
  topics: readonly string[],
  log: FastifyBaseLogger,
): Promise<number> {
  const byUser = new Map<string, { kobo: number; events: Set<string>; ids: mongoose.Types.ObjectId[] }>();
  for (const b of bets) {
    if (b.refundNotifiedAt) continue;
    const mine = byUser.get(b.authUserId) ?? { kobo: 0, events: new Set<string>(), ids: [] };
    mine.kobo += b.stakeKobo;
    mine.events.add(b.eventTitle);
    mine.ids.push(b._id);
    byUser.set(b.authUserId, mine);
  }
  if (byUser.size === 0) return 0;

  const users = (
    await User.find(
      { authUserId: { $in: [...byUser.keys()] } },
      { authUserId: 1, email: 1, username: 1 },
    ).lean()
  ).filter((u) => u.email);
  const topic = topics[0] ? topics[0].charAt(0).toUpperCase() + topics[0].slice(1) : "Some";
  const naira = (kobo: number) =>
    `₦${(kobo / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const results = await sendCustomerEmails(
    log,
    users.map((u) => {
      const mine = byUser.get(u.authUserId)!;
      const plural = mine.ids.length > 1;
      return {
        to: u.email,
        subject: plural ? "Your bets have been refunded" : "Your bet has been refunded",
        text: [
          `Hi ${u.username},`,
          "",
          `We've paused ${topic} markets on WorldStreet Predict for now while we improve them.`,
          "",
          `Your open ${plural ? "bets" : "bet"} on:`,
          ...[...mine.events].map((e) => `• ${e}`),
          "",
          `${plural ? "have" : "has"} been cancelled, and your full stake of ${naira(mine.kobo)} is back in your credit balance. You can use it on any other market right away.`,
          "",
          "Thank you for bearing with us — we're working to serve you better.",
          "",
          "The WorldStreet team",
        ].join("\n"),
      };
    }),
  );

  const told = users.filter((_, i) => results[i]).flatMap((u) => byUser.get(u.authUserId)!.ids);
  if (told.length > 0) {
    await Position.updateMany({ _id: { $in: told } }, { $set: { refundNotifiedAt: new Date() } });
  }
  return results.filter(Boolean).length;
}

export interface NotifyResult {
  /** Customers refunded in the window who haven't been told yet. */
  customers: number;
  /** Their refunded bets, and what came back on them. */
  bets: number;
  refundKobo: number;
  /** Emails accepted (0 on a dry run). */
  emailed: number;
  mailConfigured: boolean;
  dryRun: boolean;
}

/** The desk's one-off: email whoever a paused topic refunded but nobody has told yet. */
export async function notifyPausedRefunds(params: {
  topics: readonly string[];
  hours: number;
  dryRun: boolean;
  log: FastifyBaseLogger;
}): Promise<NotifyResult> {
  const untold = (await refundedBets(params.topics, params.hours)).filter((b) => !b.refundNotifiedAt);
  const base = {
    customers: new Set(untold.map((b) => b.authUserId)).size,
    bets: untold.length,
    refundKobo: untold.reduce((sum, b) => sum + b.stakeKobo, 0),
    mailConfigured: isCustomerMailConfigured(),
  };
  if (params.dryRun || untold.length === 0) return { ...base, emailed: 0, dryRun: params.dryRun };
  const emailed = await emailRefunds(untold, params.topics, params.log);
  params.log.warn({ emailed, customers: base.customers }, "paused-refund emails sent");
  return { ...base, emailed, dryRun: false };
}
