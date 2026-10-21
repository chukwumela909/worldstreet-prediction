/**
 * Order integrity: a refunded order can't be retried into a free bet,
 * simultaneous orders can't overrun a market's loss limit, and the
 * per-market lock behind that — on an in-memory database, driving the
 * real order path (placeOrder) on one of our own markets.
 *
 *   npx tsx scripts/orders-smoke.mts
 */
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk";
process.env.CLERK_SECRET_KEY = "sk_test_fake";
process.env.SETTLEMENT_POLL_SECONDS = "0";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: "test" });

const { ApiError } = await import("../src/errors.js");
const { placeOrder } = await import("../src/routes/trades.js");
const { withMarketLock } = await import("../src/trading/market-lock.js");
const { creditNaira, getNairaBalanceKobo, findExistingEntry } = await import(
  "../src/trading/ledger.js"
);
const settings = await import("../src/trading/settings.js");
const {
  MarketLock,
  Position,
  WorldstreetEvent,
  WorldstreetMarket,
  ensureTradingIndexes,
} = await import("../src/trading/models.js");
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

/** The ApiError code `fn` rejects with, "ok" when it resolves. */
async function outcomeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (err) {
    return err instanceof ApiError ? err.code : String((err as Error).message);
  }
}

const log = {
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as import("fastify").FastifyBaseLogger;

// fixed prices: no auto-rise, a loss limit of ₦1,000 per market
await settings.updateBookSettings(
  { autoSpreadStepKobo: 0, maxMarketExposureKobo: 100_000 },
  "smoke",
);

async function ownMarket(title: string) {
  const event = await WorldstreetEvent.create({
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title,
    category: "Politics",
    status: "open",
    createdBy: "admin_1",
  });
  const market = await WorldstreetMarket.create({
    eventId: event.eventId,
    title,
    status: "open",
    outcomes: [
      { label: "Yes", priceKobo: 5_500 },
      { label: "No", priceKobo: 5_000 },
    ],
  });
  return { eventId: event.eventId, marketId: market.marketId, yes: market.outcomes[0]!.outcomeId };
}

async function fund(authUserId: string, kobo: number) {
  await creditNaira({
    authUserId,
    amountKobo: kobo,
    type: "conversion_in",
    refKey: `fund:${authUserId}`,
    description: "test funds",
  });
}

/* ---------------- a refunded order can't come back free ---------------- */
console.log("retry after a failed fill");
const m1 = await ownMarket("Will it rain in Lagos tomorrow?");
await fund("u-retry", 100_000); // ₦1,000
const order = (key: string) => ({
  eventId: m1.eventId,
  marketId: m1.marketId,
  outcomeId: m1.yes,
  stakeKobo: 10_000, // ₦100
  expectedPriceKobo: 5_500,
  idempotencyKey: key,
});

// the position write fails once, after the stake is taken
const realCreate = Position.create.bind(Position);
let failNext = true;
(Position as unknown as { create: typeof Position.create }).create = (async (
  ...args: Parameters<typeof Position.create>
) => {
  if (failNext) {
    failNext = false;
    throw new Error("simulated write failure");
  }
  return realCreate(...args);
}) as typeof Position.create;

const first = await outcomeOf(() => placeOrder("u-retry", order("retry-key-0001"), log));
check("the failed fill surfaces as an error", first === "simulated write failure");
check("…and its stake is returned", (await getNairaBalanceKobo("u-retry")) === 100_000);
check(
  "…recorded as a reversal",
  Boolean(await findExistingEntry("trade:u-retry:retry-key-0001:reversal")),
);

const retry = await outcomeOf(() => placeOrder("u-retry", order("retry-key-0001"), log));
check("retrying that order is refused (ORDER_REFUNDED)", retry === "ORDER_REFUNDED");
check(
  "…with no position created",
  (await Position.countDocuments({ idempotencyKey: "u-retry:retry-key-0001" })) === 0,
);
check("…and no free stake", (await getNairaBalanceKobo("u-retry")) === 100_000);

const fresh = await outcomeOf(() => placeOrder("u-retry", order("retry-key-0002"), log));
check("a fresh order goes through", fresh === "ok");
check("…and is charged", (await getNairaBalanceKobo("u-retry")) === 90_000);
const again = (await placeOrder("u-retry", order("retry-key-0002"), log)) as {
  data: { alreadyProcessed?: boolean };
};
check(
  "resending a filled order returns it without charging again",
  again.data.alreadyProcessed === true && (await getNairaBalanceKobo("u-retry")) === 90_000,
);

/* ---------------- the loss limit holds under simultaneous orders ---------------- */
console.log("loss limit under load");
const m2 = await ownMarket("Will Super Eagles win on Saturday?");
// ₦100 at ₦55 pays ₦181.81: ₦81.81 of exposure each, so the ₦1,000 limit fits 12
const USERS = 30;
await Promise.all(Array.from({ length: USERS }, (_, i) => fund(`u-load-${i}`, 100_000)));
const results = await Promise.all(
  Array.from({ length: USERS }, (_, i) =>
    outcomeOf(() =>
      placeOrder(
        `u-load-${i}`,
        {
          eventId: m2.eventId,
          marketId: m2.marketId,
          outcomeId: m2.yes,
          stakeKobo: 10_000,
          expectedPriceKobo: 5_500,
          idempotencyKey: `load-key-${i}-xyz`,
        },
        log,
      ),
    ),
  ),
);
const filled = results.filter((r) => r === "ok").length;
const limited = results.filter((r) => r === "MARKET_LIMIT_REACHED").length;
const [agg] = await Position.aggregate<{ exposure: number }>([
  { $match: { marketId: m2.marketId, status: "open" } },
  { $group: { _id: null, exposure: { $sum: { $subtract: ["$potentialPayoutKobo", "$stakeKobo"] } } } },
]);
check(`30 orders at once: exactly 12 fill (got ${filled})`, filled === 12);
check(`…the other 18 hit the limit (got ${limited})`, limited === 18);
check(
  `…and the market stays within ₦1,000 (₦${((agg?.exposure ?? 0) / 100).toFixed(2)})`,
  (agg?.exposure ?? 0) <= 100_000,
);
const refusedBalances = await Promise.all(
  results.map((r, i) => (r === "ok" ? null : getNairaBalanceKobo(`u-load-${i}`))),
);
check(
  "refused orders charge nothing",
  refusedBalances.every((b) => b === null || b === 100_000),
);

/* ---------------- the lock itself ---------------- */
console.log("market lock");
let inside = 0;
let overlapped = false;
await Promise.all(
  Array.from({ length: 8 }, () =>
    withMarketLock("lock-market-a", async () => {
      inside += 1;
      if (inside > 1) overlapped = true;
      await new Promise((r) => setTimeout(r, 5));
      inside -= 1;
    }),
  ),
);
check("one holder at a time per market", !overlapped);

await MarketLock.create({ marketId: "lock-market-b", token: "dead", expiresAt: new Date(Date.now() + 20_000) });
const t0 = Date.now();
const other = await outcomeOf(() => withMarketLock("lock-market-c", async () => undefined));
check("another market isn't held up", other === "ok" && Date.now() - t0 < 1_000);

await MarketLock.updateOne(
  { marketId: "lock-market-b" },
  { $set: { expiresAt: new Date(Date.now() + 300) } },
);
const revived = await outcomeOf(() => withMarketLock("lock-market-b", async () => undefined));
check("a dead holder's lock frees itself", revived === "ok");

await MarketLock.updateOne(
  { marketId: "lock-market-b" },
  { $set: { token: "stuck", expiresAt: new Date(Date.now() + 20_000) } },
);
const busy = await outcomeOf(() => withMarketLock("lock-market-b", async () => undefined));
check("a market held too long answers MARKET_BUSY", busy === "MARKET_BUSY");

/* ---------------- the highest price we sell ---------------- */
console.log("near-certain sides");
const decided = await WorldstreetEvent.create({
  slug: "count-already-past-60",
  title: "Will the count reach 60 today?",
  category: "Social",
  status: "open",
  createdBy: "admin_1",
});
const decidedMarket = await WorldstreetMarket.create({
  eventId: decided.eventId,
  title: "60 or more",
  status: "open",
  outcomes: [
    { label: "Yes", priceKobo: 9_500 },
    // priced so a ₦100 bet fits under this suite's ₦1,000 loss limit
    { label: "No", priceKobo: 4_000 },
  ],
});
await fund("u-late", 1_000_000);
const lateBet = (side: 0 | 1, key: string) =>
  outcomeOf(() =>
    placeOrder(
      "u-late",
      {
        eventId: decided.eventId,
        marketId: decidedMarket.marketId,
        outcomeId: decidedMarket.outcomes[side]!.outcomeId,
        stakeKobo: 10_000,
        expectedPriceKobo: side === 0 ? 9_500 : 4_000,
        idempotencyKey: key,
      },
      log,
    ),
  );
check("ships with a ₦90 ceiling", (await settings.getBookSettings()).maxQuoteKobo === 9_000);
check("a side priced ₦95 isn't sold (NEAR_CERTAIN)", (await lateBet(0, "late-key-0001")) === "NEAR_CERTAIN");
check("…nothing charged", (await getNairaBalanceKobo("u-late")) === 1_000_000);
const otherSide = await lateBet(1, "late-key-0002");
check(`the other side still is (got ${otherSide})`, otherSide === "ok");
await settings.updateBookSettings({ maxQuoteKobo: 0 }, "smoke");
check("with the ceiling off, it sells", (await lateBet(0, "late-key-0003")) === "ok");
check(
  "a ceiling under ₦50 (other than 0) is refused",
  (await outcomeOf(() => settings.updateBookSettings({ maxQuoteKobo: 4_000 }, "smoke"))) === "INVALID_SETTINGS",
);

console.log(`\n${passed} passed, ${failed} failed`);

await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
