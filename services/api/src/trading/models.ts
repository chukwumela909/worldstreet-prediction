import { randomUUID } from "node:crypto";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Trading data for the Local markets book. All naira amounts are
 * integer kobo (`*Kobo`), mirroring the central wallet's minor-unit
 * convention. Worldstreet is the counterparty: stakes debit the user's
 * naira balance here, and settlement credits winners ₦100/share back.
 * Nothing in this file talks to Bayse or the central wallet — that's
 * ledger.ts / trades.
 *
 * The book carries two origins of market, and positions cannot tell
 * them apart on purpose: Bayse-fed events (priced by Relay, resolved by
 * Bayse or the desk) and Worldstreet's own fixed-odds events, defined
 * at the bottom of this file and resolved only by the desk. Both are
 * keyed by UUID strings, which is why the Worldstreet schemas mint
 * `randomUUID()` ids of their own rather than exposing ObjectIds.
 */

/* ------------------------------------------------------------------ */
/* Naira account + ledger                                              */
/* ------------------------------------------------------------------ */

/**
 * One balance row per user. Balance mutations go through conditional
 * $inc updates (see ledger.ts) so a debit can never overdraw, without
 * requiring replica-set transactions.
 */
const nairaAccountSchema = new Schema(
  {
    authUserId: { type: String, required: true, unique: true, index: true },
    balanceKobo: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
);

export type INairaAccount = InferSchemaType<typeof nairaAccountSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const NairaAccount: Model<INairaAccount> =
  (mongoose.models.NairaAccount as Model<INairaAccount>) ??
  mongoose.model<INairaAccount>("NairaAccount", nairaAccountSchema);

export const LEDGER_TYPES = [
  "conversion_in", // USD → NGN funding
  "conversion_out", // NGN → USD withdrawal
  "trade_stake", // debit when buying into a market
  "payout", // credit for a winning position
  "refund", // credit for a voided position / failed conversion repair
] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

/**
 * Append-only record of every naira balance movement. `refKey` is the
 * idempotency anchor: unique per logical operation, so a retried
 * request can detect that its money already moved.
 */
const ledgerEntrySchema = new Schema(
  {
    authUserId: { type: String, required: true, index: true },
    type: { type: String, enum: LEDGER_TYPES, required: true },
    /** Signed kobo: positive credit, negative debit. */
    amountKobo: { type: Number, required: true },
    /** Balance after this entry applied (best-effort display value). */
    balanceAfterKobo: { type: Number, required: true },
    /** Unique idempotency key, e.g. "convert:<clientKey>" or "payout:<positionId>". */
    refKey: { type: String, required: true, unique: true },
    description: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export type ILedgerEntry = InferSchemaType<typeof ledgerEntrySchema> & {
  _id: mongoose.Types.ObjectId;
};

export const LedgerEntry: Model<ILedgerEntry> =
  (mongoose.models.LedgerEntry as Model<ILedgerEntry>) ??
  mongoose.model<ILedgerEntry>("LedgerEntry", ledgerEntrySchema);

/* ------------------------------------------------------------------ */
/* Positions                                                           */
/* ------------------------------------------------------------------ */

export const POSITION_STATUSES = ["open", "won", "lost", "voided"] as const;
export type PositionStatus = (typeof POSITION_STATUSES)[number];

/**
 * A hold-to-settlement stake on one outcome of one market, of either
 * origin. Denormalized snapshot fields (titles, labels, slug) freeze
 * what the user actually saw at trade time — the event can churn, and
 * a Bayse one can churn without asking us. Shares pay ₦100 (10 000
 * kobo) each on a win.
 */
const positionSchema = new Schema(
  {
    authUserId: { type: String, required: true, index: true },
    eventId: { type: String, required: true, index: true },
    marketId: { type: String, required: true, index: true },
    outcomeId: { type: String, required: true },
    outcomeLabel: { type: String, required: true },
    eventSlug: { type: String, required: true },
    eventTitle: { type: String, required: true },
    marketTitle: { type: String, required: true },
    stakeKobo: { type: Number, required: true, min: 1 },
    /** Executed price in kobo per share (0 < price < 10 000). */
    priceKobo: { type: Number, required: true, min: 1, max: 9_999 },
    /** stakeKobo / priceKobo — fractional shares allowed. */
    shares: { type: Number, required: true, min: 0 },
    /** floor(shares × 10 000): what a win credits, house keeps the dust. */
    potentialPayoutKobo: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: POSITION_STATUSES,
      default: "open",
      index: true,
    },
    /** Client idempotency key — a retried trade must not double-stake. */
    idempotencyKey: { type: String, required: true, unique: true },
    settledAt: { type: Date },
    settlementId: { type: String },
  },
  { timestamps: true },
);

positionSchema.index({ status: 1, eventId: 1 });

export type IPosition = InferSchemaType<typeof positionSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Position: Model<IPosition> =
  (mongoose.models.Position as Model<IPosition>) ??
  mongoose.model<IPosition>("Position", positionSchema);

/* ------------------------------------------------------------------ */
/* FX rate + settlements                                               */
/* ------------------------------------------------------------------ */

/**
 * Admin-set USD/NGN mid rate (naira per dollar). Latest row wins; the
 * conversion spread is applied around it at request time. History is
 * kept so ledger entries can be audited against the rate that priced
 * them.
 */
const fxRateSchema = new Schema(
  {
    /** Naira per USD, e.g. 1520.5 */
    usdToNgn: { type: Number, required: true, min: 1 },
    setBy: { type: String, required: true },
  },
  { timestamps: true },
);

export type IFxRate = InferSchemaType<typeof fxRateSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const FxRate: Model<IFxRate> =
  (mongoose.models.FxRate as Model<IFxRate>) ??
  mongoose.model<IFxRate>("FxRate", fxRateSchema);

export const SETTLEMENT_SOURCES = [
  "bayse-auto",
  "worldstreet-auto",
  "admin",
] as const;
export type SettlementSource = (typeof SETTLEMENT_SOURCES)[number];

/**
 * One record per settled market — the audit trail for "who said this
 * outcome won and on what basis". `winningOutcomeId` is null for voids.
 */
const settlementSchema = new Schema(
  {
    eventId: { type: String, required: true, index: true },
    marketId: { type: String, required: true, unique: true },
    winningOutcomeId: { type: String, default: null },
    voided: { type: Boolean, default: false },
    source: { type: String, enum: SETTLEMENT_SOURCES, required: true },
    /** Clerk userId for admin settlements, "system" for the worker. */
    actor: { type: String, required: true },
    /** Raw Bayse fields backing the decision, for disputes. */
    evidence: { type: Schema.Types.Mixed, default: {} },
    positionsSettled: { type: Number, required: true, default: 0 },
    payoutTotalKobo: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

export type ISettlement = InferSchemaType<typeof settlementSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Settlement: Model<ISettlement> =
  (mongoose.models.Settlement as Model<ISettlement>) ??
  mongoose.model<ISettlement>("Settlement", settlementSchema);

/* ------------------------------------------------------------------ */
/* Worldstreet's own markets                                           */
/* ------------------------------------------------------------------ */

/**
 * Lifecycle of an event we wrote ourselves.
 *
 *  draft     — being written; invisible to the site, untradeable
 *  open      — listed and taking stakes until `closesAt`
 *  closed    — still listed, no new stakes, waiting on the result
 *  resolved  — every market settled
 *  cancelled — abandoned; the poller voids what's open and refunds
 */
export const WS_EVENT_STATUSES = [
  "draft",
  "open",
  "closed",
  "resolved",
  "cancelled",
] as const;
export type WsEventStatus = (typeof WS_EVENT_STATUSES)[number];

/** Market statuses use Bayse's vocabulary so the dispatcher can be blind to origin. */
export const WS_MARKET_STATUSES = [
  "open",
  "closed",
  "resolved",
  "cancelled",
] as const;
export type WsMarketStatus = (typeof WS_MARKET_STATUSES)[number];

/**
 * An event authored on the admin desk. `eventId` is the UUID the rest
 * of the book keys on (positions, settlements, the trade route's own
 * validation) — the ObjectId never leaves this file.
 */
const worldstreetEventSchema = new Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      default: () => randomUUID(),
    },
    /** URL slug — the site routes /local/<slug> on it. */
    slug: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    /** One of the site's own category labels, e.g. "Politics". */
    category: { type: String, required: true, default: "Trending" },
    description: { type: String, default: "" },
    /** Absolute https URL, rendered unoptimized (any host). */
    imageUrl: { type: String, default: "" },
    resolutionSource: { type: String, default: "" },
    status: {
      type: String,
      enum: WS_EVENT_STATUSES,
      default: "draft",
      index: true,
    },
    /** Trading stops here. Unset = open until the desk closes it. */
    closesAt: { type: Date, default: null },
    /** When the result is expected — drives the overdue alert. */
    resolutionDate: { type: Date, default: null },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

export type IWorldstreetEvent = InferSchemaType<typeof worldstreetEventSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const WorldstreetEvent: Model<IWorldstreetEvent> =
  (mongoose.models.WorldstreetEvent as Model<IWorldstreetEvent>) ??
  mongoose.model<IWorldstreetEvent>("WorldstreetEvent", worldstreetEventSchema);

/**
 * One side of a fixed-odds market. `priceKobo` is what a ₦100 share
 * costs, set by the desk and only changed by the desk — there is no
 * order book and no automated maker behind these numbers. The two
 * prices of a market normally sum to more than ₦100; that overround is
 * the house margin (see bookMarginBps in trading/worldstreet.ts).
 */
const worldstreetOutcomeSchema = new Schema(
  {
    outcomeId: { type: String, required: true, default: () => randomUUID() },
    label: { type: String, required: true },
    priceKobo: { type: Number, required: true, min: 100, max: 9_900 },
  },
  { _id: false },
);

const worldstreetMarketSchema = new Schema(
  {
    marketId: {
      type: String,
      required: true,
      unique: true,
      default: () => randomUUID(),
    },
    /** The parent's `eventId`, not its ObjectId. */
    eventId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    rules: { type: String, default: "" },
    status: { type: String, enum: WS_MARKET_STATUSES, default: "open" },
    /** Exactly two, enforced in the route layer. */
    outcomes: { type: [worldstreetOutcomeSchema], required: true },
    /** Set when the desk settles it; mirrors the Settlement record. */
    resolvedOutcomeId: { type: String, default: null },
    /** Display order within the event. */
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type IWorldstreetMarket = InferSchemaType<
  typeof worldstreetMarketSchema
> & { _id: mongoose.Types.ObjectId };

export const WorldstreetMarket: Model<IWorldstreetMarket> =
  (mongoose.models.WorldstreetMarket as Model<IWorldstreetMarket>) ??
  mongoose.model<IWorldstreetMarket>(
    "WorldstreetMarket",
    worldstreetMarketSchema,
  );

/**
 * Wait for the money-critical unique indexes (ledger refKey, position
 * idempotencyKey, settlement marketId, and the Worldstreet event/market
 * ids the book keys on) to finish building. Mongoose builds indexes in
 * the background, so a cold start could otherwise serve trades before
 * the dedupe guarantees exist — call this at boot, after connecting,
 * before listening.
 */
export async function ensureTradingIndexes(): Promise<void> {
  await Promise.all([
    NairaAccount.init(),
    LedgerEntry.init(),
    Position.init(),
    FxRate.init(),
    Settlement.init(),
    WorldstreetEvent.init(),
    WorldstreetMarket.init(),
  ]);
}
