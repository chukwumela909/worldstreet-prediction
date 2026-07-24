import { ApiError } from "../errors.js";
import {
  LedgerEntry,
  NairaAccount,
  type ILedgerEntry,
  type LedgerType,
} from "./models.js";

/**
 * Naira balance mutations. Every movement is a conditional `$inc` on
 * the account row followed by an append to the ledger — atomic per
 * document, so it works on standalone Mongo (no replica-set
 * transactions), with explicit compensation when the second step
 * fails. Idempotency: the ledger's unique `refKey` is checked first,
 * so a retried operation returns the original entry instead of moving
 * money twice.
 */

/** ₦100 payout per share, in kobo. */
export const PAYOUT_PER_SHARE_KOBO = 10_000;

export async function getNairaBalanceKobo(authUserId: string): Promise<number> {
  const account = await NairaAccount.findOne({ authUserId });
  return account?.balanceKobo ?? 0;
}

/** The prior entry for this refKey, if the operation already ran. */
export async function findExistingEntry(
  refKey: string,
): Promise<ILedgerEntry | null> {
  return LedgerEntry.findOne({ refKey });
}

async function appendEntry(params: {
  authUserId: string;
  type: LedgerType;
  amountKobo: number;
  balanceAfterKobo: number;
  refKey: string;
  description: string;
  metadata?: Record<string, unknown> | undefined;
}): Promise<ILedgerEntry> {
  return LedgerEntry.create({ ...params, metadata: params.metadata ?? {} });
}

/**
 * Credit `amountKobo`. Never fails for balance reasons; throws on a
 * duplicate refKey race (caller should re-read via findExistingEntry).
 */
export async function creditNaira(params: {
  authUserId: string;
  amountKobo: number;
  type: LedgerType;
  refKey: string;
  description: string;
  metadata?: Record<string, unknown>;
}): Promise<ILedgerEntry> {
  const { authUserId, amountKobo } = params;
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
    throw new ApiError(400, "Invalid credit amount", "INVALID_AMOUNT");
  }

  const existing = await findExistingEntry(params.refKey);
  if (existing) return existing;

  const account = await NairaAccount.findOneAndUpdate(
    { authUserId },
    { $inc: { balanceKobo: amountKobo } },
    { returnDocument: "after", upsert: true },
  );

  try {
    return await appendEntry({
      authUserId,
      type: params.type,
      amountKobo,
      balanceAfterKobo: account.balanceKobo,
      refKey: params.refKey,
      description: params.description,
      metadata: params.metadata,
    });
  } catch (err) {
    // Duplicate refKey race: a concurrent retry won. Undo our $inc so
    // the balance reflects exactly one credit, then return theirs.
    if (isDuplicateKey(err)) {
      await NairaAccount.updateOne(
        { authUserId },
        { $inc: { balanceKobo: -amountKobo } },
      );
      const winner = await findExistingEntry(params.refKey);
      if (winner) return winner;
    }
    throw err;
  }
}

/**
 * Debit `amountKobo`, guarded so the balance can never go negative.
 * Throws INSUFFICIENT_FUNDS when the guard fails.
 */
export async function debitNaira(params: {
  authUserId: string;
  amountKobo: number;
  type: LedgerType;
  refKey: string;
  description: string;
  metadata?: Record<string, unknown>;
}): Promise<ILedgerEntry> {
  const { authUserId, amountKobo } = params;
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
    throw new ApiError(400, "Invalid debit amount", "INVALID_AMOUNT");
  }

  const existing = await findExistingEntry(params.refKey);
  if (existing) return existing;

  const account = await NairaAccount.findOneAndUpdate(
    { authUserId, balanceKobo: { $gte: amountKobo } },
    { $inc: { balanceKobo: -amountKobo } },
    { returnDocument: "after" },
  );
  if (!account) {
    throw new ApiError(
      402,
      "Insufficient naira balance",
      "INSUFFICIENT_FUNDS",
    );
  }

  try {
    return await appendEntry({
      authUserId,
      type: params.type,
      amountKobo: -amountKobo,
      balanceAfterKobo: account.balanceKobo,
      refKey: params.refKey,
      description: params.description,
      metadata: params.metadata,
    });
  } catch (err) {
    if (isDuplicateKey(err)) {
      // A concurrent retry already debited — give this attempt's money back.
      await NairaAccount.updateOne(
        { authUserId },
        { $inc: { balanceKobo: amountKobo } },
      );
      const winner = await findExistingEntry(params.refKey);
      if (winner) return winner;
    }
    throw err;
  }
}

function isDuplicateKey(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && "code" in err && err.code === 11000,
  );
}
