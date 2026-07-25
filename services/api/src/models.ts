import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

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
