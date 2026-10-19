/**
 * The house margin: base by book, the automatic rise on an exposed side,
 * the price rule's edges, and the public rises/pricing endpoints through
 * the real app — on an in-memory database.
 *
 *   npx tsx scripts/margin-smoke.mts
 */
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk";
process.env.CLERK_SECRET_KEY = "sk_test_fake";
process.env.SETTLEMENT_POLL_SECONDS = "0";
process.env.POLYMARKET_SPREAD_BPS = "300";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: "test" });

const { buildApp } = await import("../src/app.js");
const { Position, ensureTradingIndexes } = await import("../src/trading/models.js");
const settings = await import("../src/trading/settings.js");
const margin = await import("../src/trading/margin.js");
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

/* ---------------- defaults & base by book ---------------- */
console.log("base margin");
const s0 = await settings.getBookSettings();
check(
  "defaults: Local 2 pts, +1 pt per ₦40,000 at risk",
  s0.localSpreadBps === 200 && s0.autoSpreadStepKobo === 4_000_000,
);
check("Bayse markets get the Local spread", margin.baseMarginBps("bayse", s0) === 200);
check("international markets get the Polymarket spread", margin.baseMarginBps("polymarket", s0) === 300);
check("our own (desk-priced) markets get no base", margin.baseMarginBps("worldstreet", s0) === 0);

/* ---------------- the price rule ---------------- */
console.log("price rule");
check("60% Bayse outcome sells at ₦62", margin.quotedPriceKobo(6_000, 200, 0) === 6_200);
check("…and at ₦64.50 with a 2.5-pt rise", margin.quotedPriceKobo(6_000, 200, 250) === 6_450);
check("own market, nothing at risk: the desk's price", margin.quotedPriceKobo(5_800, 0, 0) === 5_800);
check("own market with a rise", margin.quotedPriceKobo(5_800, 0, 150) === 5_950);
check("capped below the ₦100 payout", margin.quotedPriceKobo(9_850, 200, 100) === 9_900);
check("a huge rise stops at ₦99", margin.quotedPriceKobo(6_000, 200, 25_000) === 9_900);
check("no room for a margin → not sold", margin.quotedPriceKobo(9_950, 200, 0) === 0);
check(
  "decided or missing prices → not sold",
  margin.quotedPriceKobo(0, 200, 0) === 0 &&
    margin.quotedPriceKobo(10_000, 200, 0) === 0 &&
    margin.quotedPriceKobo(Number.NaN, 200, 0) === 0,
);

/* ---------------- the rise ---------------- */
console.log("rise");
check("₦60,000 at risk → +1.5 pts", margin.riseBps(6_000_000, s0) === 150);
check("₦200,000 at risk → +5 pts", margin.riseBps(20_000_000, s0) === 500);
check("no cap: ₦1,000,000 at risk → +25 pts", margin.riseBps(100_000_000, s0) === 2_500);
check("nothing at risk → no rise", margin.riseBps(0, s0) === 0 && margin.riseBps(-5_000, s0) === 0);
check(
  "a step of 0 switches it off",
  margin.riseBps(100_000_000, { ...s0, autoSpreadStepKobo: 0 }) === 0,
);
let refused = false;
try {
  await settings.updateBookSettings({ autoSpreadStepKobo: 50_000 }, "smoke");
} catch {
  refused = true;
}
check("a step under ₦1,000 (other than 0) is refused", refused);

let n = 0;
async function bet(market: string, outcome: string, stakeKobo: number, priceKobo: number) {
  n += 1;
  const shares = stakeKobo / priceKobo;
  await Position.create({
    authUserId: `u${n}`,
    eventId: "3f2b1c4e-9a7d-4e2b-8c1a-0b5d6e7f8a90",
    marketId: market,
    outcomeId: outcome,
    outcomeLabel: "Yes",
    eventSlug: "ev",
    eventTitle: "Event",
    marketTitle: market,
    stakeKobo,
    priceKobo,
    shares,
    potentialPayoutKobo: Math.floor(shares * 10_000),
    idempotencyKey: `k${n}`,
  });
}
// one-sided: ₦600 on Yes at ₦30 (pays ₦2,000), ₦100 on No at ₦50 (pays ₦200).
// Yes winning costs the house ₦2,000 − ₦700 staked = ₦1,300.
await bet("11111111-1111-4111-8111-111111111111", "11111111-1111-4111-8111-1111111111a1", 60_000, 3_000);
await bet("11111111-1111-4111-8111-111111111111", "11111111-1111-4111-8111-1111111111b1", 10_000, 5_000);
// balanced: either side winning pays less than was staked
await bet("22222222-2222-4222-8222-222222222222", "22222222-2222-4222-8222-2222222222a2", 50_000, 5_000);
await bet("22222222-2222-4222-8222-222222222222", "22222222-2222-4222-8222-2222222222b2", 50_000, 5_000);

// +1 pt per ₦1,000 at risk, so ₦1,300 → 1.3 pts
await settings.updateBookSettings({ autoSpreadStepKobo: 100_000 }, "smoke");
const s1 = await settings.getBookSettings();
const rises = await margin.risesFor(["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"], s1);
check("the exposed side rises in proportion", rises.get("11111111-1111-4111-8111-111111111111")?.get("11111111-1111-4111-8111-1111111111a1") === 130);
check("the quiet side stays at base", !rises.get("11111111-1111-4111-8111-111111111111")?.has("11111111-1111-4111-8111-1111111111b1"));
check("a balanced market has no rise", !rises.has("22222222-2222-4222-8222-222222222222"));
check("a market with no bets has no rise", !rises.has("33333333-3333-4333-8333-333333333333"));

/* ---------------- public endpoints ---------------- */
console.log("endpoints");
const r = await app.inject({ method: "GET", url: "/v1/markets/rises?marketIds=11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222" });
const body = r.json() as { data: { rises: Record<string, Record<string, number>> } };
check(
  "GET /v1/markets/rises lists the rise per side",
  r.statusCode === 200 && body.data.rises["11111111-1111-4111-8111-111111111111"]?.["11111111-1111-4111-8111-1111111111a1"] === 130 && !body.data.rises["22222222-2222-4222-8222-222222222222"],
);
const bad = await app.inject({ method: "GET", url: "/v1/markets/rises?marketIds=../admin" });
check("bad market ids are refused", bad.statusCode === 400);
const pricing = await app.inject({ method: "GET", url: "/v1/markets/pricing" });
const pd = (pricing.json() as { data: Record<string, number> }).data;
check(
  "pricing publishes the Local spread and the rise settings",
  pd.localSpreadBps === 200 && pd.autoSpreadStepKobo === 100_000,
);

console.log(`\n${passed} passed, ${failed} failed`);

await app.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
