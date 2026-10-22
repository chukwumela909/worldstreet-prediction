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
  "reversal", // a settled bet undone by the desk: stake back, winnings taken back (may go negative)
  "debt_writeoff", // the desk clearing a negative balance back to zero
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
    /**
     * Which book the position is on: "local" (Bayse-fed or our own
     * fixed odds) or "polymarket" (the international book). Positions
     * written before the international book existed are all local.
     */
    source: {
      type: String,
      enum: ["local", "polymarket"],
      default: "local",
      index: true,
    },
    /** Client idempotency key — a retried trade must not double-stake. */
    idempotencyKey: { type: String, required: true, unique: true },
    settledAt: { type: Date },
    settlementId: { type: String },
    /** When the customer was emailed that this bet was refunded (paused topics). */
    refundNotifiedAt: { type: Date },
    /**
     * Undone by the desk after it settled (trading/reversals.ts): what it
     * was before (won / lost / open), when, and the signed change to the
     * customer's balance — stake back, minus any winnings paid on it.
     */
    reversedFrom: { type: String, enum: ["won", "lost", "open"] },
    reversedAt: { type: Date },
    reversalKobo: { type: Number },
    /** Take-back written off because the balance couldn't cover it (a capped run). */
    reversalShortKobo: { type: Number },
    /**
     * Why the desk reversed it, in the words the customer's email uses.
     * Unset on the first reversals (the 15-minute crypto glitch), which
     * keep that email's own wording.
     */
    reversalReason: { type: String },
    /** When the customer was emailed about the reversal. */
    reversalNotifiedAt: { type: Date },
    /**
     * A reversed bet the paused-topic refund email wrongly called a refund
     * (both read as voided): when the customer got the correction.
     */
    refundCorrectedAt: { type: Date },
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

/* ------------------------------------------------------------------ */
/* Book settings (admin-set)                                           */
/* ------------------------------------------------------------------ */

/**
 * The admin desk's overrides of the book's pricing and limits — one row,
 * key "book". A field left unset falls back to its env default (see
 * trading/settings.ts), so a fresh database behaves exactly like the env
 * says until an admin changes something.
 */
const bookSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    internationalTrading: { type: Boolean },
    polymarketSpreadBps: { type: Number },
    localSpreadBps: { type: Number },
    autoSpreadStepKobo: { type: Number },
    maxQuoteKobo: { type: Number },
    fxSpreadBps: { type: Number },
    minStakeKobo: { type: Number },
    maxStakeKobo: { type: Number },
    maxMarketExposureKobo: { type: Number },
    priceToleranceKobo: { type: Number },
    countdownCutoffSeconds: { type: Number },
    lossAlertKobo: { type: Number },
    // no default: an unset field falls back to settings.ts's own
    pausedTopics: { type: [String], default: undefined },
    maxStakePerMarketKobo: { type: Number },
    earlyCloseHours: { type: Number },
    earlyCloseTopics: { type: [String], default: undefined },
    withdrawalReviewKobo: { type: Number },
    /** Email of the admin behind the last change. */
    updatedBy: { type: String },
  },
  { timestamps: true },
);

export type IBookSettings = InferSchemaType<typeof bookSettingsSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const BookSettingsDoc: Model<IBookSettings> =
  (mongoose.models.BookSettings as Model<IBookSettings>) ??
  mongoose.model<IBookSettings>("BookSettings", bookSettingsSchema);

/** One row per changed field — who moved a money setting, from what, to what. */
const settingsChangeSchema = new Schema(
  {
    field: { type: String, required: true },
    from: { type: Schema.Types.Mixed },
    to: { type: Schema.Types.Mixed },
    by: { type: String, required: true },
  },
  { timestamps: true },
);
settingsChangeSchema.index({ createdAt: -1 });

export type ISettingsChange = InferSchemaType<typeof settingsChangeSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const SettingsChange: Model<ISettingsChange> =
  (mongoose.models.SettingsChange as Model<ISettingsChange>) ??
  mongoose.model<ISettingsChange>("SettingsChange", settingsChangeSchema);

/* ------------------------------------------------------------------ */
/* Per-market order lock                                               */
/* ------------------------------------------------------------------ */

/**
 * One row per market that has taken an order: held while an order is
 * checked against the market's loss limit and filled, so two orders
 * can't both pass the check (trading/market-lock.ts). `expiresAt` frees
 * a lock whose holder died; a free lock reads as expired.
 */
const marketLockSchema = new Schema({
  marketId: { type: String, required: true, unique: true },
  token: { type: String },
  expiresAt: { type: Date, required: true },
});

export type IMarketLock = InferSchemaType<typeof marketLockSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const MarketLock: Model<IMarketLock> =
  (mongoose.models.MarketLock as Model<IMarketLock>) ??
  mongoose.model<IMarketLock>("MarketLock", marketLockSchema);

/**
 * A dollars-to-credit conversion whose dollar charge was refunded after
 * the naira side failed. Its key can't be replayed: the wallet dedupes
 * charges by key and would hand back the refunded charge as if it stood,
 * crediting naira for nothing (routes/ngn-wallet.ts).
 */
const reversedConversionSchema = new Schema(
  { refKey: { type: String, required: true, unique: true } },
  { timestamps: true },
);

export type IReversedConversion = InferSchemaType<typeof reversedConversionSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const ReversedConversion: Model<IReversedConversion> =
  (mongoose.models.ReversedConversion as Model<IReversedConversion>) ??
  mongoose.model<IReversedConversion>("ReversedConversion", reversedConversionSchema);

/**
 * A credit → dollars withdrawal the wallet never confirmed: it didn't
 * answer, or answered with something that isn't its own refusal, so the
 * dollars may or may not have arrived. The credit stays taken until the
 * desk settles it (trading/withdrawals.ts) — asking the wallet again under
 * the same reference, or marking it paid or returned by hand — because
 * putting it back on a guess pays twice when the dollars did arrive.
 */
export const WITHDRAWAL_CHECK_STATUSES = ["unconfirmed", "review", "checking", "paid", "returned"] as const;

const withdrawalCheckSchema = new Schema(
  {
    /** The withdrawal's ledger refKey — also its reference at the wallet. */
    refKey: { type: String, required: true, unique: true },
    authUserId: { type: String, required: true, index: true },
    amountKobo: { type: Number, required: true },
    amountUsdMinor: { type: Number, required: true },
    /** The ₦/$ rate it was priced at. */
    rate: { type: Number, required: true },
    status: { type: String, enum: WITHDRAWAL_CHECK_STATUSES, default: "unconfirmed", index: true },
    /**
     * Why it waits for an admin's approval before going to the wallet (a
     * big day of withdrawals, or a flagged account); empty for one held
     * only because the wallet never confirmed it.
     */
    reason: { type: String, default: "" },
    /** What the wallet last said, for the desk. */
    lastCode: { type: String, default: "" },
    lastMessage: { type: String, default: "" },
    resolvedBy: { type: String, default: "" },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);

export type IWithdrawalCheck = InferSchemaType<typeof withdrawalCheckSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const WithdrawalCheck: Model<IWithdrawalCheck> =
  (mongoose.models.WithdrawalCheck as Model<IWithdrawalCheck>) ??
  mongoose.model<IWithdrawalCheck>("WithdrawalCheck", withdrawalCheckSchema);

export const SETTLEMENT_SOURCES = [
  "bayse-auto",
  "worldstreet-auto",
  "polymarket-auto",
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
    /** Raw source fields (Bayse, Polymarket) backing the decision, for disputes. */
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
    BookSettingsDoc.init(),
    MarketLock.init(),
    ReversedConversion.init(),
    WithdrawalCheck.init(),
    Settlement.init(),
    WorldstreetEvent.init(),
    WorldstreetMarket.init(),
  ]);
}
