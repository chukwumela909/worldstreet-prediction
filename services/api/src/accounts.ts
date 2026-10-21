import type { FastifyBaseLogger } from "fastify";
import { sendCustomerEmails } from "./customer-mail.js";
import { ApiError } from "./errors.js";
import { User } from "./models.js";

/**
 * Suspending an account — the desk's stop for one person, where a paused
 * topic is the stop for a market. While suspended the account can't place
 * a bet or move money in or out (POST /trades, POST /wallet/ngn/convert);
 * it can still sign in, see its bets and write to support. Open bets are
 * left alone and settle as usual.
 *
 * Both actions are recorded on the profile (`accountActions`) with who
 * did it and why, and the customer can be told by email. The reason is
 * written for the customer: the site's suspended notice shows it too.
 */

export interface Suspension {
  at: string;
  reason: string;
}

/** The account's suspension, or null when it can use the book. */
export async function getSuspension(authUserId: string): Promise<Suspension | null> {
  const user = await User.findOne(
    { authUserId },
    { suspendedAt: 1, suspendedReason: 1 },
  ).lean();
  return user?.suspendedAt
    ? { at: user.suspendedAt.toISOString(), reason: user.suspendedReason ?? "" }
    : null;
}

/** Refuse a money move for a suspended account (403 ACCOUNT_SUSPENDED). */
export async function assertNotSuspended(authUserId: string): Promise<void> {
  if (await getSuspension(authUserId)) {
    throw new ApiError(
      403,
      "Your account is suspended, so betting and moving money are paused. Contact support for help.",
      "ACCOUNT_SUSPENDED",
    );
  }
}

export interface AccountActionResult {
  authUserId: string;
  suspended: boolean;
  suspendedAt: string | null;
  reason: string;
  /** Whether the customer's email went out; null when none was asked for. */
  emailed: boolean | null;
}

async function tell(
  log: FastifyBaseLogger,
  to: string,
  subject: string,
  lines: string[],
): Promise<boolean> {
  if (!to) return false;
  const [ok] = await sendCustomerEmails(log, [{ to, subject, text: lines.join("\n") }]);
  return ok ?? false;
}

export async function suspendAccount(params: {
  authUserId: string;
  reason: string;
  notify: boolean;
  actor: string;
  log: FastifyBaseLogger;
}): Promise<AccountActionResult> {
  const at = new Date();
  // only an active account moves, so a double click can't log twice
  const user = await User.findOneAndUpdate(
    { authUserId: params.authUserId, suspendedAt: null },
    {
      $set: { suspendedAt: at, suspendedBy: params.actor, suspendedReason: params.reason },
      $push: { accountActions: { action: "suspend", reason: params.reason, by: params.actor, at } },
    },
    { new: true },
  ).lean();
  if (!user) {
    const exists = await User.exists({ authUserId: params.authUserId });
    if (!exists) throw new ApiError(404, "No such account", "USER_NOT_FOUND");
    throw new ApiError(409, "This account is already suspended", "ALREADY_SUSPENDED");
  }
  params.log.warn({ authUserId: params.authUserId, actor: params.actor }, "account suspended");

  const emailed = params.notify
    ? await tell(params.log, user.email, "Your WorldStreet Predict account has been suspended", [
        `Hi ${user.username},`,
        "",
        "We've suspended your WorldStreet Predict account. While it's suspended you can't place bets or move money in or out. Bets you already have open will settle as usual.",
        "",
        `Reason: ${params.reason}`,
        "",
        "If you think this is a mistake, or you'd like to talk about it, contact us from the Support page on WorldStreet Predict.",
        "",
        "The WorldStreet team",
      ])
    : null;
  return {
    authUserId: params.authUserId,
    suspended: true,
    suspendedAt: at.toISOString(),
    reason: params.reason,
    emailed,
  };
}

export async function reinstateAccount(params: {
  authUserId: string;
  reason: string;
  notify: boolean;
  actor: string;
  log: FastifyBaseLogger;
}): Promise<AccountActionResult> {
  const at = new Date();
  const user = await User.findOneAndUpdate(
    { authUserId: params.authUserId, suspendedAt: { $ne: null } },
    {
      $set: { suspendedAt: null, suspendedBy: "", suspendedReason: "" },
      $push: { accountActions: { action: "reinstate", reason: params.reason, by: params.actor, at } },
    },
    { new: true },
  ).lean();
  if (!user) {
    const exists = await User.exists({ authUserId: params.authUserId });
    if (!exists) throw new ApiError(404, "No such account", "USER_NOT_FOUND");
    throw new ApiError(409, "This account isn't suspended", "NOT_SUSPENDED");
  }
  params.log.warn({ authUserId: params.authUserId, actor: params.actor }, "account reinstated");

  const emailed = params.notify
    ? await tell(params.log, user.email, "Your WorldStreet Predict account is active again", [
        `Hi ${user.username},`,
        "",
        "Your WorldStreet Predict account is active again — you can place bets and move money as usual.",
        ...(params.reason ? ["", params.reason] : []),
        "",
        "The WorldStreet team",
      ])
    : null;
  return { authUserId: params.authUserId, suspended: false, suspendedAt: null, reason: "", emailed };
}
