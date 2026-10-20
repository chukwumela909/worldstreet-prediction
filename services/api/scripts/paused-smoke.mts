/**
 * Paused topics (the Bitcoin pause): the matching rule, the setting, bets
 * refused, open bets voided and refunded — by the desk's action and by
 * the settlement pass on its own — and paused markets off the listing.
 * On an in-memory database, our own markets only (no network).
 *
 *   npx tsx scripts/paused-smoke.mts
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
const { buildApp } = await import("../src/app.js");
const { placeOrder } = await import("../src/routes/trades.js");
const { isPausedMarket } = await import("../src/trading/paused.js");
const settings = await import("../src/trading/settings.js");
const { voidPausedMarkets, runSettlementPass } = await import("../src/trading/settlement.js");
const { creditNaira, getNairaBalanceKobo } = await import("../src/trading/ledger.js");
const { Position, WorldstreetEvent, WorldstreetMarket, ensureTradingIndexes } = await import(
  "../src/trading/models.js"
);
await ensureTradingIndexes();
const app = await buildApp();

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
    await fn();
    return "ok";
  } catch (err) {
    return err instanceof ApiError ? err.code : String((err as Error).message);
  }
}
const log = { info() {}, warn() {}, error() {} } as unknown as import("fastify").FastifyBaseLogger;

/* ---------------- the rule ---------------- */
console.log("matching");
const btc = ["bitcoin", "btc"];
check("“Bitcoin Up or Down” is paused", isPausedMarket(btc, "Bitcoin Up or Down"));
check("a btc-… slug is paused", isPausedMarket(btc, "btc-up-or-down-15m-1792450800"));
check("“Will BTC close above $120k?” is paused", isPausedMarket(btc, "Will BTC close above $120k?"));
check("Ethereum isn't", !isPausedMarket(btc, "Ethereum Up or Down", "eth-up-or-down-15m-1"));
check("only whole words: “bitcoiners” isn't", !isPausedMarket(btc, "Will bitcoiners rally?"));
check("nothing paused → nothing matches", !isPausedMarket([], "Bitcoin Up or Down"));
check("a phrase matches across a slug's dashes", isPausedMarket(["up or down"], "eth-up-or-down-15m-1"));

/* ---------------- the setting ---------------- */
console.log("setting");
const s0 = await settings.getBookSettings();
check("ships with Bitcoin paused", JSON.stringify(s0.pausedTopics) === JSON.stringify(btc));
const saved = await settings.updateBookSettings({ pausedTopics: ["  Bitcoin ", "BTC", "btc", "ethereum"] }, "smoke");
check(
  "saved trimmed, lowercased, deduplicated",
  JSON.stringify(saved.settings.pausedTopics) === JSON.stringify(["bitcoin", "btc", "ethereum"]),
);
check("the change is in the history", saved.history.some((h) => h.field === "pausedTopics"));
check(
  "a junk topic is refused",
  (await outcomeOf(() => settings.updateBookSettings({ pausedTopics: ["$$"] }, "smoke"))) ===
    "INVALID_SETTINGS",
);
await settings.updateBookSettings({ pausedTopics: btc, autoSpreadStepKobo: 0 }, "smoke");

/* ---------------- markets and bets ---------------- */
async function ownMarket(title: string) {
  const event = await WorldstreetEvent.create({
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title,
    category: "Crypto",
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
let n = 0;
async function openBet(m: Awaited<ReturnType<typeof ownMarket>>, user: string, stakeKobo: number) {
  n += 1;
  await Position.create({
    authUserId: user,
    eventId: m.eventId,
    marketId: m.marketId,
    outcomeId: m.yes,
    outcomeLabel: "Yes",
    eventSlug: `slug-${n}`,
    eventTitle: (await WorldstreetEvent.findOne({ eventId: m.eventId }))!.title,
    marketTitle: (await WorldstreetMarket.findOne({ marketId: m.marketId }))!.title,
    stakeKobo,
    priceKobo: 5_500,
    shares: stakeKobo / 5_500,
    potentialPayoutKobo: Math.floor((stakeKobo / 5_500) * 10_000),
    idempotencyKey: `bet-${n}`,
  });
}

const btcMarket = await ownMarket("Will BTC close above $120k on Friday?");
const btcMarket2 = await ownMarket("Bitcoin above $130k by November?");
const ethMarket = await ownMarket("Will ETH close above $5k on Friday?");

console.log("bets");
await creditNaira({ authUserId: "u1", amountKobo: 1_000_000, type: "conversion_in", refKey: "fund:u1", description: "t" });
const order = (m: typeof btcMarket, key: string) =>
  outcomeOf(() =>
    placeOrder(
      "u1",
      { eventId: m.eventId, marketId: m.marketId, outcomeId: m.yes, stakeKobo: 10_000, expectedPriceKobo: 5_500, idempotencyKey: key },
      log,
    ),
  );
check("a new bet on a paused market is refused (MARKET_PAUSED)", (await order(btcMarket, "paused-key-1")) === "MARKET_PAUSED");
check("…and nothing is charged", (await getNairaBalanceKobo("u1")) === 1_000_000);
check("a bet elsewhere still goes through", (await order(ethMarket, "paused-key-2")) === "ok");

/* ---------------- voiding ---------------- */
console.log("voiding");
// bets placed before the pause
await openBet(btcMarket, "u2", 20_000);
await openBet(btcMarket, "u3", 30_000);
await openBet(btcMarket2, "u2", 50_000);
await openBet(ethMarket, "u3", 40_000);

const preview = await voidPausedMarkets({ topics: btc, actor: "smoke", reason: "test", dryRun: true, log });
check(
  `the preview counts 3 bets on 2 markets, ₦1,000 to refund (got ${preview.positions}/${preview.markets}/${preview.refundKobo})`,
  preview.positions === 3 && preview.markets === 2 && preview.refundKobo === 100_000,
);
check("…without moving money", (await getNairaBalanceKobo("u2")) === 0);

// the settlement pass does it on its own while the topic is paused
await runSettlementPass(log);
check("the pass refunds every open Bitcoin bet", (await getNairaBalanceKobo("u2")) === 70_000 && (await getNairaBalanceKobo("u3")) === 30_000);
check(
  "…marking them voided",
  (await Position.countDocuments({ marketId: { $in: [btcMarket.marketId, btcMarket2.marketId] }, status: "voided" })) === 3,
);
check(
  "…and leaves other markets' bets open",
  (await Position.countDocuments({ marketId: ethMarket.marketId, status: "open" })) === 2,
);
await runSettlementPass(log);
check("a second pass refunds nothing twice", (await getNairaBalanceKobo("u2")) === 70_000);
const after = await voidPausedMarkets({ topics: btc, actor: "smoke", reason: "test", dryRun: true, log });
check("nothing left to void", after.positions === 0);

/* ---------------- what the public sees ---------------- */
console.log("public");
const listing = await app.inject({ method: "GET", url: "/v1/markets" });
const titles = (listing.json() as { data: { events: { title: string }[] } }).data.events.map((e) => e.title);
check("paused markets are off the listing", !titles.some((t) => /btc|bitcoin/i.test(t)));
check("…the rest stay", titles.some((t) => t.includes("ETH")));
const pricing = await app.inject({ method: "GET", url: "/v1/markets/pricing" });
const pd = (pricing.json() as { data: { pausedTopics?: string[] } }).data;
check("pricing publishes the paused topics for the web", JSON.stringify(pd.pausedTopics) === JSON.stringify(btc));

console.log(`\n${passed} passed, ${failed} failed`);

await app.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
