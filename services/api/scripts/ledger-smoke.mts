/**
 * Smoke test for the naira ledger + settlement engine against an
 * in-memory Mongo (no real DB or env needed):
 *
 *   npx tsx scripts/ledger-smoke.mts
 *
 * Covers: balance guards, refKey idempotency (incl. a concurrent
 * race), one-shot settlement, double-settlement protection, and void
 * refunds — the invariants that keep the book's money right.
 */
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_fake";
process.env.CLERK_SECRET_KEY = "sk_test_fake";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: "test" });

const ledger = await import("../src/trading/ledger.js");
const { Position, Settlement, ensureTradingIndexes } = await import(
  "../src/trading/models.js"
);
const settlement = await import("../src/trading/settlement.js");

// same as server boot: unique indexes must exist before the race tests
await ensureTradingIndexes();

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log("  ✓", name);
  } else {
    failed++;
    console.log("  ✗", name);
  }
}

const U = "user_test_1";

// --- credit + balance
const c1 = await ledger.creditNaira({
  authUserId: U,
  amountKobo: 100_000,
  type: "conversion_in",
  refKey: "t:credit1",
  description: "fund",
});
check("credit applies", c1.balanceAfterKobo === 100_000);
check("balance reads", (await ledger.getNairaBalanceKobo(U)) === 100_000);

// --- idempotent credit
const c2 = await ledger.creditNaira({
  authUserId: U,
  amountKobo: 100_000,
  type: "conversion_in",
  refKey: "t:credit1",
  description: "fund again",
});
check("duplicate credit no-ops", (await ledger.getNairaBalanceKobo(U)) === 100_000);
check("duplicate returns original entry", String(c2._id) === String(c1._id));

// --- debit guard
let threw = false;
try {
  await ledger.debitNaira({
    authUserId: U,
    amountKobo: 200_000,
    type: "trade_stake",
    refKey: "t:overdraw",
    description: "too much",
  });
} catch {
  threw = true;
}
check("overdraw rejected", threw);
check("balance untouched after reject", (await ledger.getNairaBalanceKobo(U)) === 100_000);

// --- debit + idempotency
await ledger.debitNaira({
  authUserId: U,
  amountKobo: 40_000,
  type: "trade_stake",
  refKey: "t:stake1",
  description: "stake",
});
await ledger.debitNaira({
  authUserId: U,
  amountKobo: 40_000,
  type: "trade_stake",
  refKey: "t:stake1",
  description: "stake retry",
});
check("debit once despite retry", (await ledger.getNairaBalanceKobo(U)) === 60_000);

// --- concurrent same-refKey credits (race the dedupe)
await Promise.all(
  Array.from({ length: 5 }, () =>
    ledger
      .creditNaira({
        authUserId: U,
        amountKobo: 10_000,
        type: "payout",
        refKey: "t:race",
        description: "race",
      })
      .catch(() => null),
  ),
);
check("racy credit lands exactly once", (await ledger.getNairaBalanceKobo(U)) === 70_000);

// --- settlement engine ---
const fakeLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Parameters<typeof settlement.adminSettleMarket>[0]["log"];

const mk = (user: string, marketId: string, outcomeId: string, key: string) =>
  Position.create({
    authUserId: user,
    eventId: "ev1",
    marketId,
    outcomeId,
    outcomeLabel: outcomeId === "oYes" ? "Yes" : "No",
    eventSlug: "ev-1",
    eventTitle: "Test event",
    marketTitle: "Test market",
    stakeKobo: 30_000,
    priceKobo: 5_000,
    shares: 6,
    potentialPayoutKobo: 60_000,
    status: "open",
    idempotencyKey: key,
  });

await mk("winner_user", "mk1", "oYes", "k1");
await mk("loser_user", "mk1", "oNo", "k2");

const r1 = await settlement.adminSettleMarket({
  eventId: "ev1",
  marketId: "mk1",
  winningOutcomeId: "oYes",
  actor: "admin_1",
  log: fakeLog,
});
check("settle reports 2 positions", r1.positionsSettled === 2);
check("winner paid ₦600", (await ledger.getNairaBalanceKobo("winner_user")) === 60_000);
check("loser paid nothing", (await ledger.getNairaBalanceKobo("loser_user")) === 0);
check("winner status won", (await Position.findOne({ authUserId: "winner_user" }))?.status === "won");
check("loser status lost", (await Position.findOne({ authUserId: "loser_user" }))?.status === "lost");

// --- double settlement blocked
const r2 = await settlement.adminSettleMarket({
  eventId: "ev1",
  marketId: "mk1",
  winningOutcomeId: "oNo",
  actor: "admin_2",
  log: fakeLog,
});
check("second settle blocked", r2.outcome === "already_settled");
check(
  "winner balance unchanged",
  (await ledger.getNairaBalanceKobo("winner_user")) === 60_000,
);

// --- void refunds stakes
await mk("void_user", "mk2", "oYes", "k3");
const r3 = await settlement.adminVoidMarket({
  eventId: "ev1",
  marketId: "mk2",
  actor: "admin_1",
  reason: "match cancelled",
  log: fakeLog,
});
check("void settles 1", r3.positionsSettled === 1);
check("void refunds stake", (await ledger.getNairaBalanceKobo("void_user")) === 30_000);
check("void status", (await Position.findOne({ marketId: "mk2" }))?.status === "voided");

check("two settlement records", (await Settlement.find()).length === 2);

console.log(`\n${passed} passed, ${failed} failed`);
await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
