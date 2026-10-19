import { randomUUID } from "node:crypto";
import { ApiError } from "../errors.js";
import { MarketLock } from "./models.js";

/**
 * One order at a time per market, across every API instance.
 *
 * The loss limit is a sum over the market's open positions, so checking
 * it and then filling the order are two steps — two orders arriving
 * together could each pass the check and between them go past the
 * limit. Holding this lock from the check to the fill closes that gap
 * without Mongo transactions (the book runs on standalone Mongo, see
 * ledger.ts): it's one row per market, taken with a conditional upsert.
 *
 * Orders on different markets never wait on each other, and a normal
 * hold is a few milliseconds. A holder that dies frees the lock after
 * HOLD_MS; a release only ever frees the holder's own lock.
 */

/** Longest a lock is held if its holder never releases it. */
const HOLD_MS = 15_000;
/** How long an order waits for the market before giving up. */
const WAIT_MS = 5_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isDuplicateKey(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && err.code === 11000);
}

async function acquire(marketId: string, token: string): Promise<boolean> {
  const now = new Date();
  try {
    // free (expired) → ours; no row yet → inserted as ours; held → the
    // upsert's insert hits the unique marketId and throws
    await MarketLock.findOneAndUpdate(
      { marketId, expiresAt: { $lte: now } },
      { $set: { token, expiresAt: new Date(now.getTime() + HOLD_MS) } },
      { upsert: true },
    );
    return true;
  } catch (err) {
    if (isDuplicateKey(err)) return false;
    throw err;
  }
}

/** Run `fn` holding the market's lock; 503 MARKET_BUSY if it stays taken. */
export async function withMarketLock<T>(marketId: string, fn: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  const deadline = Date.now() + WAIT_MS;
  while (!(await acquire(marketId, token))) {
    if (Date.now() >= deadline) {
      throw new ApiError(
        503,
        "Lots of bets on this market right now — try again in a moment",
        "MARKET_BUSY",
      );
    }
    await sleep(15 + Math.random() * 35);
  }
  try {
    return await fn();
  } finally {
    // a release that fails leaves the lock to free itself after HOLD_MS —
    // never worth failing an order that has already been filled
    await MarketLock.updateOne({ marketId, token }, { $set: { expiresAt: new Date(0) } }).catch(
      () => undefined,
    );
  }
}
