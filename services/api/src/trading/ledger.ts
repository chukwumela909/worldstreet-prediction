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
    return afterFailedAppend(err, authUserId, params.refKey, amountKobo, account.balanceKobo);
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
    return afterFailedAppend(err, authUserId, params.refKey, -amountKobo, account.balanceKobo);
  }
}

/**
 * The desk's signed adjustment: credit when positive, debit when
 * negative, with NO floor — the one movement that may take a balance
 * below zero (a reversed winning bet whose winnings were already spent).
 * A negative balance blocks betting and withdrawing, both guarded debits,
 * until new credit brings it back. Idempotent by refKey like the rest.
 */
export async function adjustNaira(params: {
  authUserId: string;
  amountKobo: number;
  type: LedgerType;
  refKey: string;
  description: string;
  metadata?: Record<string, unknown>;
}): Promise<ILedgerEntry> {
  const { authUserId, amountKobo } = params;
  if (!Number.isInteger(amountKobo) || amountKobo === 0) {
    throw new ApiError(400, "Invalid adjustment amount", "INVALID_AMOUNT");
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
    return afterFailedAppend(err, authUserId, params.refKey, amountKobo, account.balanceKobo);
  }
}

/**
 * The balance moved by `deltaKobo` but its ledger entry didn't write.
 *
 * A duplicate refKey means a concurrent retry recorded the same
 * operation first: undo our move so the balance reflects it once, and
 * return theirs. Any other failure: if our own entry landed anyway (the
 * error came after the write), it stands; otherwise the move is undone
 * and the error rethrown — the balance never holds money the ledger
 * doesn't explain, or a caller's compensation (a refunded dollar charge,
 * a returned stake) would pay out twice.
 */
async function afterFailedAppend(
  err: unknown,
  authUserId: string,
  refKey: string,
  deltaKobo: number,
  balanceAfterKobo: number,
): Promise<ILedgerEntry> {
  if (!isDuplicateKey(err)) {
    const landed = await findExistingEntry(refKey).catch(() => null);
    if (landed && landed.balanceAfterKobo === balanceAfterKobo) return landed;
  }
  await NairaAccount.updateOne({ authUserId }, { $inc: { balanceKobo: -deltaKobo } });
  if (isDuplicateKey(err)) {
    const winner = await findExistingEntry(refKey);
    if (winner) return winner;
  }
  throw err;
}

function isDuplicateKey(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && "code" in err && err.code === 11000,
  );
}
