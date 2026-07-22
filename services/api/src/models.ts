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
