/**
 * The desk's book settings end to end, on an in-memory database:
 * defaults from env, admin edits and their change log, the bounds and
 * cross-field checks, the spreads reaching FX and international prices,
 * and the risk desk's per-market limit flags.
 *
 *   npx tsx scripts/settings-smoke.mts
 */
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_fake";
process.env.CLERK_SECRET_KEY = "sk_test_fake";
process.env.POLYMARKET_SPREAD_BPS = "300";
process.env.FX_SPREAD_BPS = "100";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: "test" });

const { ApiError } = await import("../src/errors.js");
const { FxRate, Position, SettingsChange, ensureTradingIndexes } = await import(
  "../src/trading/models.js"
);
const settings = await import("../src/trading/settings.js");
const { getFxQuote } = await import("../src/trading/fx.js");
const pm = await import("../src/trading/polymarket/index.js");
const risk = await import("../src/trading/risk.js");

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

async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err.code : "not-an-ApiError";
  }
}

/* ---------------- defaults ---------------- */
console.log("defaults");
const fresh = await settings.getBookSettings();
check("international trading ships off", fresh.internationalTrading === false);
check("spreads come from env", fresh.polymarketSpreadBps === 300 && fresh.fxSpreadBps === 100);
check("₦100 minimum stake", fresh.minStakeKobo === 10_000);
check("price tolerance ₦2", fresh.priceToleranceKobo === 200);
const view0 = await settings.getSettingsView();
check("no history on a fresh book", view0.history.length === 0 && view0.updatedAt === null);

/* ---------------- edits + change log ---------------- */
console.log("edits");
const view1 = await settings.updateBookSettings(
  { polymarketSpreadBps: 400, internationalTrading: true },
  "admin@worldstreet.test",
);
check("edit applies", view1.settings.polymarketSpreadBps === 400 && view1.settings.internationalTrading);
check("defaults stay the env's", view1.defaults.polymarketSpreadBps === 300);
check("both moves logged", view1.history.length === 2);
const spreadLog = view1.history.find((h) => h.field === "polymarketSpreadBps");
check(
  "log records from → to and who",
  spreadLog?.from === 300 && spreadLog.to === 400 && spreadLog.by === "admin@worldstreet.test",
);
check("last editor shown", view1.updatedBy === "admin@worldstreet.test" && view1.updatedAt !== null);
check("readers see the edit at once in this process", (await settings.getBookSettings()).polymarketSpreadBps === 400);

await settings.updateBookSettings({ polymarketSpreadBps: 400 }, "admin@worldstreet.test");
check("an unchanged value isn't logged", (await SettingsChange.countDocuments()) === 2);

/* ---------------- validation ---------------- */
console.log("validation");
check(
  "above the bound is refused",
  (await rejects(() => settings.updateBookSettings({ polymarketSpreadBps: 2_500 }, "a"))) ===
    "INVALID_SETTINGS",
);
check(
  "fractions are refused",
  (await rejects(() => settings.updateBookSettings({ fxSpreadBps: 1.5 }, "a"))) ===
    "INVALID_SETTINGS",
);
check(
  "stake below ₦100 is refused",
  (await rejects(() => settings.updateBookSettings({ minStakeKobo: 5_000 }, "a"))) ===
    "INVALID_SETTINGS",
);
check(
  "min stake above max stake is refused",
  (await rejects(() =>
    settings.updateBookSettings({ minStakeKobo: 6_000_000, maxStakeKobo: 5_000_000 }, "a"),
  )) === "INVALID_SETTINGS",
);
const afterRefusals = await settings.getBookSettings();
check(
  "a refused edit writes nothing",
  afterRefusals.polymarketSpreadBps === 400 &&
    afterRefusals.minStakeKobo === 10_000 &&
    (await SettingsChange.countDocuments()) === 2,
);

/* ---------------- spreads reach prices ---------------- */
console.log("prices");
await FxRate.create({ usdToNgn: 1_500, setBy: "admin" });
check("FX uses the desk's spread", (await getFxQuote()).spreadBps === 100);
await settings.updateBookSettings({ fxSpreadBps: 200 }, "admin@worldstreet.test");
const fx = await getFxQuote();
check("FX follows an edit", fx.spreadBps === 200 && Math.abs(fx.usdToNgn - 1_470) < 1e-9);

const game = pm.fromPolymarket(
  {
    id: 42,
    slug: "g",
    title: "G",
    active: true,
    closed: false,
    endDate: "2099-01-01T00:00:00Z",
    markets: [
      {
        id: 7,
        outcomes: '["Yes","No"]',
        clobTokenIds: '["1","2"]',
        outcomePrices: '["0.6","0.4"]',
        active: true,
        closed: false,
      },
    ],
  },
  Date.now(),
  (await settings.getBookSettings()).polymarketSpreadBps,
);
check(
  "international price carries the desk's spread (60% → ₦64 at 4 points)",
  game.markets[0]?.outcomes[0]?.priceKobo === 6_400 &&
    game.markets[0]?.outcomes[1]?.priceKobo === 4_400,
);

/* ---------------- risk flags ---------------- */
console.log("risk flags");
await settings.updateBookSettings({ maxMarketExposureKobo: 100_000 }, "admin@worldstreet.test");
let n = 0;
async function position(marketId: string, stakeKobo: number, priceKobo: number) {
  n += 1;
  await Position.create({
    authUserId: `user_${n}`,
    eventId: `ev-${marketId}`,
    marketId,
    outcomeId: `${marketId}-yes`,
    outcomeLabel: "Yes",
    eventSlug: `ev-${marketId}`,
    eventTitle: `Event ${marketId}`,
    marketTitle: `Market ${marketId}`,
    stakeKobo,
    priceKobo,
    shares: stakeKobo / priceKobo,
    potentialPayoutKobo: Math.floor((stakeKobo / priceKobo) * 10_000),
    idempotencyKey: `user_${n}:k${n}`,
  });
}
await position("m-watch", 30_000, 3_000); // pays ₦1,000 on ₦300 → ₦700 used of ₦1,000
await position("m-critical", 10_000, 1_000); // ₦900 used
await position("m-calm", 50_000, 5_000); // ₦500 used

const book = await risk.getBookRisk();
check("risk carries the current cap", book.maxMarketExposureKobo === 100_000);
check(
  "70% and 90% markets flagged, fullest first",
  book.limitFlags.length === 2 &&
    book.limitFlags[0]?.marketId === "m-critical" &&
    book.limitFlags[0].level === "critical" &&
    book.limitFlags[1]?.marketId === "m-watch" &&
    book.limitFlags[1].level === "watch",
);
check(
  "flag reports use against the cap",
  book.limitFlags[0]?.usedKobo === 90_000 && Math.abs((book.limitFlags[0]?.share ?? 0) - 0.9) < 1e-9,
);
check("a half-used market isn't flagged", !book.limitFlags.some((f) => f.marketId === "m-calm"));

console.log(`\n${passed} passed, ${failed} failed`);

await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
