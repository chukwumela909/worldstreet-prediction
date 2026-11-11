import type { FastifyBaseLogger } from "fastify";
import { sendCustomerEmails } from "./customer-mail.js";
import { ApiError } from "./errors.js";
import { AlertRecord, User } from "./models.js";

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

/* ---------------- locking withdrawals ---------------- */

/**
 * The lighter stop: the account keeps betting and adding money, but can't
 * take any out until the desk unlocks it. The customer only learns of it
 * when they try to withdraw, and sees this.
 */
export const WITHDRAWALS_LOCKED_MESSAGE =
  "Your account is going through some checks because we found some suspicious activity, so withdrawals are paused for now. You can still bet as usual. If you have any questions, please contact Support.";

/** Refuse a withdrawal from an account whose withdrawals are locked (403 WITHDRAWALS_LOCKED). */
export async function assertCanWithdraw(authUserId: string): Promise<void> {
  const user = await User.findOne({ authUserId }, { withdrawalsLockedAt: 1 }).lean();
  if (user?.withdrawalsLockedAt) throw new ApiError(403, WITHDRAWALS_LOCKED_MESSAGE, "WITHDRAWALS_LOCKED");
}

export interface WithdrawalLockResult {
  authUserId: string;
  locked: boolean;
  lockedAt: string | null;
}

/* ---------------- stake levels ---------------- */

export const STAKE_LEVELS = ["normal", "reduced", "restricted"] as const;
export type StakeLevel = (typeof STAKE_LEVELS)[number];
const RANK: Record<StakeLevel, number> = { normal: 0, reduced: 1, restricted: 2 };
const LEVEL_LABEL: Record<StakeLevel, string> = { normal: "Normal", reduced: "Reduced", restricted: "Restricted" };
/** Who the abuse scan acts as when it lowers a level. */
export const AUTO_STAKE_ACTOR = "system:abuse";
/** Who puts a scan-set level back to normal once its week is up. */
export const STAKE_REVIEW_ACTOR = "system:review";
const DAY_MS = 86_400_000;
/** A level a person set stands this long before the scan may lower it again. */
const PERSON_HOLD_MS = 7 * DAY_MS;
/** A scan-set level goes back to normal this long after it was set, once the scan no longer flags them. */
const AUTO_RETURN_MS = 7 * DAY_MS;
/** Limited by the scan within this long before means a new flag is a repeat, and goes harder. */
const REPEAT_WINDOW_MS = 30 * DAY_MS;
/** Still flagged: an abuse alert about them fired this recently (the scan runs every hour). */
const STILL_FLAGGED_MS = 3 * 3_600_000;

const asLevel = (v: unknown): StakeLevel => (v === "reduced" || v === "restricted" ? v : "normal");

/** The customer's stake level; normal for anyone without one. */
export async function getStakeLevel(authUserId: string): Promise<StakeLevel> {
  const user = await User.findOne({ authUserId }, { stakeLevel: 1 }).lean();
  return asLevel(user?.stakeLevel);
}

/** The share of the book's stake limits a level gets, as a whole percent. */
export function stakeShare(
  level: StakeLevel,
  settings: { reducedStakePct: number; restrictedStakePct: number },
): number {
  return level === "restricted" ? settings.restrictedStakePct : level === "reduced" ? settings.reducedStakePct : 100;
}

/** A limit scaled to that share, rounded down to whole naira, never below the minimum stake. */
export function scaledLimit(kobo: number, pct: number, minKobo: number): number {
  if (pct >= 100) return kobo;
  return Math.max(Math.floor((kobo * pct) / 100 / 100) * 100, minKobo);
}

/**
 * The most this customer may stake on one bet and on one market, at their
 * level: what the order route enforces and the bet slip shows them. With
 * no per-market cap set, a limited customer still gets one (four of their
 * bets), so many small bets can't add up to a big one; 0 = no cap.
 */
export async function stakeLimitsFor(
  authUserId: string,
  settings: {
    minStakeKobo: number;
    maxStakeKobo: number;
    maxStakePerMarketKobo: number;
    reducedStakePct: number;
    restrictedStakePct: number;
  },
): Promise<{ maxStakeKobo: number; maxPerMarketKobo: number }> {
  const share = stakeShare(await getStakeLevel(authUserId), settings);
  const maxStakeKobo = scaledLimit(settings.maxStakeKobo, share, settings.minStakeKobo);
  const maxPerMarketKobo =
    settings.maxStakePerMarketKobo > 0
      ? scaledLimit(settings.maxStakePerMarketKobo, share, settings.minStakeKobo)
      : share < 100
        ? maxStakeKobo * 4
        : 0;
  return { maxStakeKobo, maxPerMarketKobo };
}

export interface StakeLevelResult {
  authUserId: string;
  stakeLevel: StakeLevel;
  stakeLevelReason: string;
  stakeLevelBy: string;
  stakeLevelAt: string;
}

/** The desk sets a customer's level, either way, with its reason; kept on the account's history. */
export async function setStakeLevel(params: {
  authUserId: string;
  level: StakeLevel;
  reason: string;
  actor: string;
  log: FastifyBaseLogger;
}): Promise<StakeLevelResult> {
  const at = new Date();
  const user = await User.findOneAndUpdate(
    { authUserId: params.authUserId, stakeLevel: { $ne: params.level } },
    {
      $set: {
        stakeLevel: params.level,
        stakeLevelReason: params.reason,
        stakeLevelBy: params.actor,
        stakeLevelAt: at,
      },
      $push: {
        accountActions: {
          action: "stake_level",
          reason: `${LEVEL_LABEL[params.level]}: ${params.reason}`,
          by: params.actor,
          at,
        },
      },
    },
    { new: true },
  ).lean();
  if (!user) {
    const exists = await User.exists({ authUserId: params.authUserId });
    if (!exists) throw new ApiError(404, "No such account", "USER_NOT_FOUND");
    throw new ApiError(409, `This account is already on ${LEVEL_LABEL[params.level]}`, "SAME_LEVEL");
  }
  params.log.warn({ authUserId: params.authUserId, level: params.level, actor: params.actor }, "stake level set");
  return {
    authUserId: params.authUserId,
    stakeLevel: params.level,
    stakeLevelReason: params.reason,
    stakeLevelBy: params.actor,
    stakeLevelAt: at.toISOString(),
  };
}

/**
 * The abuse scan lowers a flagged customer's level on its own: to `level`
 * the first time, to `repeatLevel` when the scan already limited them in
 * the last 30 days and they're flagged again after going back to normal.
 * It only ever lowers (a restricted customer isn't moved up to reduced),
 * never escalates within one spell (someone still flagged stays where they
 * are), and leaves alone a level a person set in the last week: the desk
 * has looked at them. Returns whether it changed anything.
 */
export async function lowerStakeLevelAutomatically(params: {
  authUserId: string;
  level: Exclude<StakeLevel, "normal">;
  /** Where a repeat goes; absent = the same as `level`. */
  repeatLevel?: Exclude<StakeLevel, "normal">;
  reason: string;
  log: FastifyBaseLogger;
}): Promise<boolean> {
  const user = await User.findOne(
    { authUserId: params.authUserId },
    { stakeLevel: 1, stakeLevelBy: 1, stakeLevelAt: 1, suspendedAt: 1, accountActions: 1 },
  ).lean();
  if (!user || user.suspendedAt) return false;
  const current = asLevel(user.stakeLevel);
  const since = Date.now() - REPEAT_WINDOW_MS;
  const limitedBefore = (user.accountActions ?? []).some(
    (a) =>
      a.action === "stake_level" &&
      a.by === AUTO_STAKE_ACTOR &&
      !String(a.reason).startsWith("Normal") &&
      new Date(a.at).getTime() >= since,
  );
  const repeat = Boolean(params.repeatLevel) && current === "normal" && limitedBefore;
  const level = repeat && params.repeatLevel ? params.repeatLevel : params.level;
  const reason = repeat ? `Flagged again within 30 days. ${params.reason}` : params.reason;
  if (RANK[current] >= RANK[level]) return false;
  const byPerson = Boolean(user.stakeLevelBy) && !String(user.stakeLevelBy).startsWith("system:");
  if (byPerson && user.stakeLevelAt && Date.now() - new Date(user.stakeLevelAt).getTime() < PERSON_HOLD_MS) {
    return false;
  }
  const at = new Date();
  const res = await User.updateOne(
    // only from what was read, so a desk change in between wins
    { authUserId: params.authUserId, stakeLevel: user.stakeLevel ?? "normal" },
    {
      $set: {
        stakeLevel: level,
        stakeLevelReason: reason,
        stakeLevelBy: AUTO_STAKE_ACTOR,
        stakeLevelAt: at,
      },
      $push: {
        accountActions: {
          action: "stake_level",
          reason: `${LEVEL_LABEL[level]}: ${reason}`,
          by: AUTO_STAKE_ACTOR,
          at,
        },
      },
    },
  );
  if (res.modifiedCount > 0) {
    params.log.warn({ authUserId: params.authUserId, level, repeat }, "stake level lowered by the abuse scan");
  }
  return res.modifiedCount > 0;
}

/**
 * The week is up: a level the scan set goes back to normal 7 days after it
 * was set, once the scan no longer flags them (no abuse alert about them
 * in the last few hours). Someone still flagged stays where they are until
 * they stop. A level a person set is never touched. Run before each scan.
 * Returns how many went back.
 */
export async function returnAutoStakeLevels(log: FastifyBaseLogger, now = Date.now()): Promise<number> {
  const due = await User.find(
    {
      stakeLevelBy: AUTO_STAKE_ACTOR,
      stakeLevel: { $ne: "normal" },
      stakeLevelAt: { $lte: new Date(now - AUTO_RETURN_MS) },
    },
    { authUserId: 1 },
  ).lean();
  if (due.length === 0) return 0;
  const ids = due.map((u) => u.authUserId);
  const stillFlagged = new Set(
    (
      await AlertRecord.find(
        { kind: "abuse", authUserIds: { $in: ids }, lastAt: { $gte: new Date(now - STILL_FLAGGED_MS) } },
        { authUserIds: 1 },
      ).lean()
    ).flatMap((a) => a.authUserIds ?? []),
  );
  const back = ids.filter((id) => !stillFlagged.has(id));
  if (back.length === 0) return 0;
  const at = new Date(now);
  const why = "7 days on a limit, and no longer flagged";
  const res = await User.updateMany(
    { authUserId: { $in: back }, stakeLevelBy: AUTO_STAKE_ACTOR, stakeLevel: { $ne: "normal" } },
    {
      $set: { stakeLevel: "normal", stakeLevelReason: why, stakeLevelBy: STAKE_REVIEW_ACTOR, stakeLevelAt: at },
      $push: { accountActions: { action: "stake_level", reason: `Normal: ${why}`, by: STAKE_REVIEW_ACTOR, at } },
    },
  );
  if (res.modifiedCount > 0) log.warn({ ids: back }, "scan-set stake levels back to normal after a week");
  return res.modifiedCount;
}

/**
 * Clearing an abuse alert: each of its customers the scan limited goes
 * back to normal, unless another abuse alert about them is still open.
 * A level a person set stays as it is. Returns how many were restored.
 */
export async function restoreAutoStakeLevels(params: {
  authUserIds: string[];
  /** The alert just cleared, so it doesn't count as still open. */
  alertId: string;
  actor: string;
  why: string;
  log: FastifyBaseLogger;
}): Promise<number> {
  if (params.authUserIds.length === 0) return 0;
  const stillFlagged = new Set(
    (
      await AlertRecord.find(
        { _id: { $ne: params.alertId }, kind: "abuse", status: "open", authUserIds: { $in: params.authUserIds } },
        { authUserIds: 1 },
      ).lean()
    ).flatMap((a) => a.authUserIds ?? []),
  );
  const ids = params.authUserIds.filter((id) => !stillFlagged.has(id));
  if (ids.length === 0) return 0;
  const at = new Date();
  const res = await User.updateMany(
    { authUserId: { $in: ids }, stakeLevelBy: AUTO_STAKE_ACTOR, stakeLevel: { $ne: "normal" } },
    {
      $set: { stakeLevel: "normal", stakeLevelReason: params.why, stakeLevelBy: params.actor, stakeLevelAt: at },
      $push: { accountActions: { action: "stake_level", reason: `Normal: ${params.why}`, by: params.actor, at } },
    },
  );
  if (res.modifiedCount > 0) {
    params.log.warn({ ids, actor: params.actor }, "stake levels restored with a cleared alert");
  }
  return res.modifiedCount;
}

export async function lockWithdrawals(params: {
  authUserId: string;
  note: string;
  actor: string;
  log: FastifyBaseLogger;
}): Promise<WithdrawalLockResult> {
  const at = new Date();
  const user = await User.findOneAndUpdate(
    { authUserId: params.authUserId, withdrawalsLockedAt: null },
    {
      $set: { withdrawalsLockedAt: at, withdrawalsLockedBy: params.actor, withdrawalsLockNote: params.note },
      $push: { accountActions: { action: "lock_withdrawals", reason: params.note, by: params.actor, at } },
    },
    { new: true },
  ).lean();
  if (!user) {
    const exists = await User.exists({ authUserId: params.authUserId });
    if (!exists) throw new ApiError(404, "No such account", "USER_NOT_FOUND");
    throw new ApiError(409, "This account's withdrawals are already locked", "ALREADY_LOCKED");
  }
  params.log.warn({ authUserId: params.authUserId, actor: params.actor }, "withdrawals locked");
  return { authUserId: params.authUserId, locked: true, lockedAt: at.toISOString() };
}

export async function unlockWithdrawals(params: {
  authUserId: string;
  note: string;
  actor: string;
  log: FastifyBaseLogger;
}): Promise<WithdrawalLockResult> {
  const at = new Date();
  const user = await User.findOneAndUpdate(
    { authUserId: params.authUserId, withdrawalsLockedAt: { $ne: null } },
    {
      $set: { withdrawalsLockedAt: null, withdrawalsLockedBy: "", withdrawalsLockNote: "" },
      $push: { accountActions: { action: "unlock_withdrawals", reason: params.note, by: params.actor, at } },
    },
    { new: true },
  ).lean();
  if (!user) {
    const exists = await User.exists({ authUserId: params.authUserId });
    if (!exists) throw new ApiError(404, "No such account", "USER_NOT_FOUND");
    throw new ApiError(409, "This account's withdrawals aren't locked", "NOT_LOCKED");
  }
  params.log.warn({ authUserId: params.authUserId, actor: params.actor }, "withdrawals unlocked");
  return { authUserId: params.authUserId, locked: false, lockedAt: null };
}
