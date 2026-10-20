/**
 * Credit ⇄ dollar conversions when the central wallet fails: the money is
 * put back, and the same key can't be replayed into a false "done" or a
 * free credit — on an in-memory database, with the wallet service
 * answered by canned responses instead of the network.
 *
 *   npx tsx scripts/convert-smoke.mts
 */
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk";
process.env.CLERK_SECRET_KEY = "sk_test_fake";
process.env.SETTLEMENT_POLL_SECONDS = "0";
process.env.WALLET_API_URL = "https://wallet.test";
process.env.WALLET_SERVICE_TOKEN = "test-token";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: "test" });

const { ApiError } = await import("../src/errors.js");
const { convertNaira } = await import("../src/routes/ngn-wallet.js");
const { creditNaira, getNairaBalanceKobo } = await import("../src/trading/ledger.js");
const { FxRate, LedgerEntry, ensureTradingIndexes } = await import("../src/trading/models.js");
await ensureTradingIndexes();

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed += 1;
    console.log("  ✓", name);
  } else {
    failed += 1;
    console.log("  ✗", name);
  }
}

async function outcomeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    const res = (await fn()) as { data?: { alreadyProcessed?: boolean } };
    return res.data?.alreadyProcessed ? "alreadyProcessed" : "ok";
  } catch (err) {
    return err instanceof ApiError ? err.code : String((err as Error).message);
  }
}

const log = { info() {}, warn() {}, error() {} } as unknown as import("fastify").FastifyBaseLogger;

await FxRate.create({ usdToNgn: 1_450, setBy: "smoke" });
await creditNaira({
  authUserId: "u-cust",
  amountKobo: 7_951_146, // ₦79,511.46
  type: "conversion_in",
  refKey: "fund:u-cust",
  description: "test funds",
});

/* ---------------- canned wallet ---------------- */
let creditsFail = true;
const calls = { credits: 0, charges: 0, refunds: 0 };
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.pathname.endsWith("/credits")) {
    calls.credits += 1;
    return creditsFail
      ? json({ ok: false, code: "FORBIDDEN", error: "credits are not enabled for this platform" }, 403)
      : json({ ok: true, credit: { id: `cr-${calls.credits}` } });
  }
  if (url.pathname.endsWith("/refund")) {
    calls.refunds += 1;
    return json({ ok: true });
  }
  if (url.pathname.endsWith("/charges")) {
    calls.charges += 1;
    // the wallet dedupes by key: a replay gets the same charge back
    return json({ ok: true, charge: { id: "ch-1", amountMinor: 1000, currency: "USD", description: "", createdAt: "" } });
  }
  return json({ ok: false, code: "NOT_FOUND", error: "not found" }, 404);
}) as typeof fetch;

/* ---------------- credit → dollars, wallet refusing ---------------- */
console.log("withdrawal the wallet refuses");
const withdraw = (key: string) =>
  outcomeOf(() =>
    convertNaira("u-cust", { direction: "ngn_to_usd", amountMinor: 4_500_000, idempotencyKey: key }, log),
  );

check("the refusal surfaces as WALLET_UNAVAILABLE", (await withdraw("withdraw-key-1")) === "WALLET_UNAVAILABLE");
check("…and the credit is returned in full", (await getNairaBalanceKobo("u-cust")) === 7_951_146);
check(
  "pressing again with the same key is refused, not reported as done",
  (await withdraw("withdraw-key-1")) === "CONVERSION_REVERSED",
);
check("…and still nothing moved", (await getNairaBalanceKobo("u-cust")) === 7_951_146);

creditsFail = false;
check("a fresh attempt goes through once the wallet accepts", (await withdraw("withdraw-key-2")) === "ok");
check("…taking the ₦45,000", (await getNairaBalanceKobo("u-cust")) === 7_951_146 - 4_500_000);
check("resending that one reports it done without charging again", (await withdraw("withdraw-key-2")) === "alreadyProcessed");
check("…balance unchanged", (await getNairaBalanceKobo("u-cust")) === 7_951_146 - 4_500_000);

/* ---------------- dollars → credit, naira side failing ---------------- */
console.log("funding whose naira credit fails");
const fund = (key: string) =>
  outcomeOf(() =>
    convertNaira("u-cust", { direction: "usd_to_ngn", amountMinor: 1_000, idempotencyKey: key }, log),
  );
const before = await getNairaBalanceKobo("u-cust");
const realCreate = LedgerEntry.create.bind(LedgerEntry);
let failNext = true;
(LedgerEntry as unknown as { create: typeof LedgerEntry.create }).create = (async (
  ...args: Parameters<typeof LedgerEntry.create>
) => {
  if (failNext) {
    failNext = false;
    throw new Error("simulated ledger failure");
  }
  return realCreate(...args);
}) as typeof LedgerEntry.create;

check("the failed credit surfaces as an error", (await fund("fund-key-1")) === "simulated ledger failure");
check("…and the dollar charge is refunded", calls.refunds === 1);
const replay = await fund("fund-key-1");
check(
  `replaying the key can't credit naira for refunded dollars (got ${replay})`,
  replay === "CONVERSION_REVERSED",
);
check("…no naira added", (await getNairaBalanceKobo("u-cust")) === before);

console.log(`\n${passed} passed, ${failed} failed`);

await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
