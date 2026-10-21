import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/** One suspend or reinstate on an account, by whom and why (accounts.ts). */
const accountActionSchema = new Schema(
  {
    action: { type: String, enum: ["suspend", "reinstate"], required: true },
    reason: { type: String, default: "" },
    by: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

/**
 * Local platform profile, keyed by the central Clerk userId (`authUserId`).
 * Identity lives in Clerk and money lives in the central wallet — this row
 * only carries prediction-platform data (username, display bits, and later
 * positions/trade bookkeeping).
 */
const userSchema = new Schema(
  {
    authUserId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, lowercase: true, index: true },
    username: { type: String, required: true, unique: true },
    displayName: { type: String, required: true },
    avatar: { type: String, default: "" },
    /**
     * Set while the desk has the account suspended: no new bets and no
     * money in or out until it's lifted (accounts.ts). The reason is the
     * customer's to read — the site and the email show it.
     */
    suspendedAt: { type: Date, default: null },
    suspendedBy: { type: String, default: "" },
    suspendedReason: { type: String, default: "" },
    /** Every suspend and reinstate, oldest first. */
    accountActions: { type: [accountActionSchema], default: [] },
  },
  { timestamps: true },
);

export type IUser = InferSchemaType<typeof userSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const User: Model<IUser> =
  (mongoose.models.User as Model<IUser>) ??
  mongoose.model<IUser>("User", userSchema);

/**
 * One row per recurring alert condition, so a market that stays stuck
 * doesn't mail somebody every time the settlement poller comes around.
 * `key` identifies the condition (not the occurrence) — e.g. one row per
 * overdue event — and the unique index is what makes the send/suppress
 * decision safe across concurrent instances.
 */
const alertStateSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    subject: { type: String, default: "" },
    lastSentAt: { type: Date, required: true },
    /** Occurrences swallowed since the last send; reported in the next one. */
    suppressedCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type IAlertState = InferSchemaType<typeof alertStateSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const AlertState: Model<IAlertState> =
  (mongoose.models.AlertState as Model<IAlertState>) ??
  mongoose.model<IAlertState>("AlertState", alertStateSchema);

/* ------------------------------------------------------------------ */
/* Support requests                                                    */
/* ------------------------------------------------------------------ */

export const SUPPORT_CATEGORIES = ["money", "bets", "account", "other"] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/**
 * open     — waiting on us (new, or the customer wrote again)
 * answered — we replied, waiting on the customer
 * closed   — done; the customer writing again reopens it
 */
export const SUPPORT_STATUSES = ["open", "answered", "closed"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

const supportMessageSchema = new Schema(
  {
    from: { type: String, enum: ["customer", "support"], required: true },
    body: { type: String, required: true },
    /** Who on the desk wrote a support message; empty for the customer's. */
    by: { type: String, default: "" },
    at: { type: Date, required: true },
  },
  { _id: false },
);

/**
 * A customer's question and the thread that answers it (routes/support.ts).
 * `ref` is the short number both sides quote ("WS-7K2M9Q"); the email and
 * username are copied at creation so the desk can read a ticket without a
 * join.
 */
const supportTicketSchema = new Schema(
  {
    ref: { type: String, required: true, unique: true },
    authUserId: { type: String, required: true, index: true },
    email: { type: String, default: "" },
    username: { type: String, default: "" },
    category: { type: String, enum: SUPPORT_CATEGORIES, required: true },
    subject: { type: String, required: true },
    status: { type: String, enum: SUPPORT_STATUSES, default: "open", index: true },
    messages: { type: [supportMessageSchema], default: [] },
    /** Last message either way — both inboxes sort on it. */
    lastMessageAt: { type: Date, required: true, index: true },
  },
  { timestamps: true },
);

export type ISupportTicket = InferSchemaType<typeof supportTicketSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const SupportTicket: Model<ISupportTicket> =
  (mongoose.models.SupportTicket as Model<ISupportTicket>) ??
  mongoose.model<ISupportTicket>("SupportTicket", supportTicketSchema);
