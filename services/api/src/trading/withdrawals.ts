import type { FastifyBaseLogger } from "fastify";
import { sendAlert } from "../alerts.js";
import { ApiError } from "../errors.js";
import { User } from "../models.js";
import { creditWallet } from "../wallet.js";
import { creditNaira } from "./ledger.js";
import { WithdrawalCheck } from "./models.js";

/**
 * Paying a credit → dollars withdrawal into the central wallet without
 * ever paying it twice.
 *
 * The credit is taken first (routes/ngn-wallet.ts), then the wallet is
 * asked to add the dollars. If it refuses outright — it answered, and
 * said no — nothing happened there and the credit is put back. If the
 * answer is lost (no reply in time, a network error, a 5xx, a page that
 * isn't the wallet's), the dollars may well have arrived, so the credit is
 * NOT put back on a guess: the wallet is asked once more under the same
 * reference — it dedupes on it, so asking again can only confirm a
 * payment, never make a second one — and if that settles nothing either,
 * the withdrawal is held for the desk (Admin → Abuse watch) and the admins
 * are alerted. The desk then asks the wallet again, or marks it paid or
 * returned by hand.
 */

export type SendOutcome = "paid" | "refused" | "unknown";

/** A refusal that means "you already did this" — the first attempt went through. */
const DUPLICATE = /duplicate|already/i;

function credit(p: { authUserId: string; refKey: string; amountKobo: number; amountUsdMinor: number; rate: number }) {
  return creditWallet({
    clerkUserId: p.authUserId,
    amountUsdMinor: p.amountUsdMinor,
    description: `Naira wallet withdrawal (₦${(p.amountKobo / 100).toFixed(2)})`,
    idempotencyKey: p.refKey,
    metadata: { kind: "ngn_withdrawal", rate: p.rate },
  });
}

/** Ask the wallet to add the dollars; on a lost answer, ask once more under the same reference. */
export async function sendWithdrawal(p: {
  authUserId: string;
  refKey: string;
  amountKobo: number;
  amountUsdMinor: number;
  rate: number;
  log: FastifyBaseLogger;
}): Promise<{ outcome: SendOutcome; code: string; message: string }> {
  let result = await credit(p);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (result.ok) return { outcome: "paid", code: "", message: "" };
    // no wallet configured means no call was made: that says nothing
    // about whether an earlier attempt paid, so it's never a refusal
    if (result.definite && result.code !== "NOT_CONFIGURED") {
      const duplicate = result.status === 409 || DUPLICATE.test(`${result.code} ${result.message}`);
      return { outcome: duplicate ? "paid" : "refused", code: result.code, message: result.message };
    }
    if (attempt === 0) {
      p.log.warn({ code: result.code, refKey: p.refKey }, "wallet credit unanswered — asking again under the same reference");
      result = await credit(p);
    }
  }
  return {
    outcome: "unknown",
    code: result.ok ? "" : result.code,
    message: result.ok ? "" : result.message,
  };
}

/** Put the withdrawn credit back — keyed like the automatic return, so it can only happen once. */
export async function returnWithdrawal(p: { authUserId: string; refKey: string; amountKobo: number }) {
  return creditNaira({
    authUserId: p.authUserId,
    amountKobo: p.amountKobo,
    type: "refund",
    refKey: `${p.refKey}:reversal`,
    description: "Withdrawal failed — naira returned",
  });
}

/** Hold a withdrawal the wallet never confirmed, and tell the admins. */
export async function holdWithdrawal(p: {
  authUserId: string;
  refKey: string;
  amountKobo: number;
  amountUsdMinor: number;
  rate: number;
  code: string;
  message: string;
  log: FastifyBaseLogger;
}): Promise<void> {
  await WithdrawalCheck.updateOne(
    { refKey: p.refKey },
    {
      $setOnInsert: {
        authUserId: p.authUserId,
        amountKobo: p.amountKobo,
        amountUsdMinor: p.amountUsdMinor,
        rate: p.rate,
        status: "unconfirmed",
      },
      $set: { lastCode: p.code, lastMessage: p.message },
    },
    { upsert: true },
  );
  await sendAlert(
    p.log,
    "Withdrawal not confirmed by the wallet",
    {
      note: "The credit is held, not returned. Settle it in Admin → Abuse watch → Withdrawals to confirm.",
      account: p.authUserId,
      amount: `₦${(p.amountKobo / 100).toFixed(2)} → $${(p.amountUsdMinor / 100).toFixed(2)}`,
      wallet: `${p.code}: ${p.message}`,
    },
    "withdrawal-unconfirmed",
  ).catch((err: unknown) => p.log.error({ err }, "unconfirmed-withdrawal alert failed"));
}

/* ---------------- the desk ---------------- */

export interface WithdrawalCheckRow {
  refKey: string;
  authUserId: string;
  username: string;
  email: string;
  amountKobo: number;
  amountUsdMinor: number;
  status: string;
  lastCode: string;
  lastMessage: string;
  createdAt: string | null;
  resolvedBy: string;
  resolvedAt: string | null;
}

export async function listWithdrawalChecks(limit = 100): Promise<WithdrawalCheckRow[]> {
  const checks = await WithdrawalCheck.find({}).sort({ status: -1, createdAt: -1 }).limit(limit).lean();
  const users = await User.find(
    { authUserId: { $in: [...new Set(checks.map((c) => c.authUserId))] } },
    { authUserId: 1, username: 1, email: 1 },
  ).lean();
  const byId = new Map(users.map((u) => [u.authUserId, u]));
  return checks
    .map((c) => ({
      refKey: c.refKey,
      authUserId: c.authUserId,
      username: byId.get(c.authUserId)?.username ?? "",
      email: byId.get(c.authUserId)?.email ?? "",
      amountKobo: c.amountKobo,
      amountUsdMinor: c.amountUsdMinor,
      status: c.status,
      lastCode: c.lastCode ?? "",
      lastMessage: c.lastMessage ?? "",
      createdAt: c.createdAt?.toISOString() ?? null,
      resolvedBy: c.resolvedBy ?? "",
      resolvedAt: c.resolvedAt?.toISOString() ?? null,
    }))
    // waiting ones first
    .sort((a, b) => Number(b.status === "unconfirmed") - Number(a.status === "unconfirmed"));
}

/**
 * Settle a held withdrawal. "retry" asks the wallet again under the same
 * reference (paid → done; refused → the credit goes back; still no
 * answer → stays held). "paid" and "return" are the desk's own call,
 * after checking the customer's dollar balance.
 */
export async function resolveWithdrawalCheck(p: {
  refKey: string;
  action: "retry" | "paid" | "return";
  actor: string;
  log: FastifyBaseLogger;
}): Promise<{ status: string; message: string }> {
  // claim it, so two clicks can't both act on it
  const check = await WithdrawalCheck.findOneAndUpdate(
    { refKey: p.refKey, status: "unconfirmed" },
    { $set: { status: "checking" } },
    { new: true },
  ).lean();
  if (!check) {
    const exists = await WithdrawalCheck.exists({ refKey: p.refKey });
    if (!exists) throw new ApiError(404, "No such withdrawal", "NOT_FOUND");
    throw new ApiError(409, "This withdrawal has already been settled", "ALREADY_SETTLED");
  }
  const settle = (status: "paid" | "returned" | "unconfirmed", extra: Record<string, unknown> = {}) =>
    WithdrawalCheck.updateOne(
      { refKey: p.refKey },
      {
        $set: {
          status,
          ...(status === "unconfirmed" ? {} : { resolvedBy: p.actor, resolvedAt: new Date() }),
          ...extra,
        },
      },
    );

  try {
    if (p.action === "paid") {
      await settle("paid");
      return { status: "paid", message: "Marked as paid — the credit stays withdrawn." };
    }
    if (p.action === "return") {
      await returnWithdrawal(check);
      await settle("returned");
      return { status: "returned", message: "The credit was returned to the customer." };
    }
    const sent = await sendWithdrawal({ ...check, log: p.log });
    if (sent.outcome === "paid") {
      await settle("paid", { lastCode: "", lastMessage: "" });
      return { status: "paid", message: "The wallet confirmed the dollars — it's paid." };
    }
    if (sent.outcome === "refused") {
      await returnWithdrawal(check);
      await settle("returned", { lastCode: sent.code, lastMessage: sent.message });
      return { status: "returned", message: `The wallet refused it (${sent.message}), so the credit was returned.` };
    }
    await settle("unconfirmed", { lastCode: sent.code, lastMessage: sent.message });
    return { status: "unconfirmed", message: "The wallet still didn't answer — it stays held. Try again later." };
  } catch (err) {
    // put it back in the queue rather than leave it stuck mid-check
    await settle("unconfirmed");
    throw err;
  }
}
