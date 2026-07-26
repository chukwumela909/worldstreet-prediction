/**
 * Smoke test for Worldstreet's own fixed-odds markets against an
 * in-memory Mongo (no real DB or env needed):
 *
 *   npx tsx scripts/worldstreet-smoke.mts
 *
 * Covers what the route layer can't be trusted to get right on its own:
 * the pricing guard (a book that pays anyone who buys both sides), slug
 * uniqueness, the origin dispatcher that lets one trade path serve two
 * kinds of market, the per-side risk arithmetic the desk prices off,
 * and the close-out that follows a settlement.
 */
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_fake";
process.env.CLERK_SECRET_KEY = "sk_test_fake";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: "test" });

const { ApiError } = await import("../src/errors.js");
const {
  Position,
  WorldstreetEvent,
  WorldstreetMarket,
  ensureTradingIndexes,
} = await import("../src/trading/models.js");
const ws = await import("../src/trading/worldstreet.js");
const events = await import("../src/trading/events.js");
const settlement = await import("../src/trading/settlement.js");
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

/** True when `fn` throws an ApiError carrying `code`. */
function rejects(fn: () => void, code: string): boolean {
  try {
    fn();
    return false;
  } catch (err) {
    return err instanceof ApiError && err.code === code;
  }
}

const log = {
  info: () => {},
  warn: () => {},
  error: (...args: unknown[]) => console.error("    log.error", ...args),
} as unknown as import("fastify").FastifyBaseLogger;

/* ---------------- pricing ---------------- */

check(
  "margin is the overround in bps",
  ws.bookMarginBps([5_500, 5_000]) === 500 && ws.bookMarginBps([5_000, 5_000]) === 0,
);
check(
  "a fair book is allowed",
  (() => {
    ws.assertPriceable([
      { label: "Yes", priceKobo: 5_000 },
      { label: "No", priceKobo: 5_000 },
    ]);
    return true;
  })(),
);
check(
  "a short book is refused",
  rejects(
    () =>
      ws.assertPriceable([
        { label: "Yes", priceKobo: 4_800 },
        { label: "No", priceKobo: 5_000 },
      ]),
    "BAD_PRICE",
  ),
);
check(
  "a book over the margin cap is refused",
  rejects(
    () =>
      ws.assertPriceable([
        { label: "Yes", priceKobo: 7_000 },
        { label: "No", priceKobo: 7_000 },
      ]),
    "BAD_PRICE",
  ),
);
check(
  "an out-of-range price is refused",
  rejects(
    () =>
      ws.assertPriceable([
        { label: "Yes", priceKobo: 9_950 },
        { label: "No", priceKobo: 100 },
      ]),
    "BAD_PRICE",
  ),
);
check(
  "two outcomes with the same label are refused",
  rejects(
    () =>
      ws.assertPriceable([
        { label: "Yes", priceKobo: 5_500 },
        { label: "yes ", priceKobo: 5_000 },
      ]),
    "BAD_MARKET",
  ),
);
check(
  "a one-sided market is refused",
  rejects(() => ws.assertPriceable([{ label: "Yes", priceKobo: 5_500 }]), "BAD_MARKET"),
);

/* ---------------- slugs ---------------- */

const slug1 = await ws.uniqueSlug("Will Lagos Ban Okada Again?");
check("slug is url-safe", slug1 === "will-lagos-ban-okada-again");

const event = await WorldstreetEvent.create({
  slug: slug1,
  title: "Will Lagos ban okada again?",
  category: "Politics",
  status: "open",
  createdBy: "admin_1",
  resolutionDate: new Date(Date.now() - 86_400_000),
});
const market = await WorldstreetMarket.create({
  eventId: event.eventId,
  title: "Will Lagos ban okada again?",
  status: "open",
  outcomes: [
    { label: "Yes", priceKobo: 5_500 },
    { label: "No", priceKobo: 5_000 },
  ],
});

const slug2 = await ws.uniqueSlug("Will Lagos Ban Okada Again?");
check("a taken slug gets suffixed", slug2 === "will-lagos-ban-okada-again-2");
check(
  "renaming an event keeps its own slug",
  (await ws.uniqueSlug("Will Lagos Ban Okada Again?", event.eventId)) === slug1,
);

/* ---------------- the dispatcher ---------------- */

const tradable = await events.fetchTradableEvent(event.eventId);
check("our event resolves without touching Bayse", tradable.origin === "worldstreet");
check(
  "prices come through as kobo per ₦100 share",
  tradable.markets[0]?.outcomes[0]?.priceKobo === 5_500 &&
    tradable.markets[0]?.outcomes[1]?.priceKobo === 5_000,
);
check(
  "outcome ids are the ones stored",
  tradable.markets[0]?.outcomes[0]?.id === market.outcomes[0]?.outcomeId,
);
check("an unresolved market has no winner", tradable.markets[0]?.resolvedOutcomeId === null);

const batch = await events.fetchTradableEvents([event.eventId, "not-an-event-of-ours"]);
check("a batch keeps ours and drops what it can't reach", batch.size === 1);

/* ---------------- the open book ---------------- */

const yesId = market.outcomes[0]!.outcomeId;
const noId = market.outcomes[1]!.outcomeId;

await Position.create({
  authUserId: "user_a",
  eventId: event.eventId,
  marketId: market.marketId,
  outcomeId: yesId,
  outcomeLabel: "Yes",
  eventSlug: event.slug,
  eventTitle: event.title,
  marketTitle: market.title,
  stakeKobo: 55_000,
  priceKobo: 5_500,
  shares: 10,
  potentialPayoutKobo: 100_000,
  idempotencyKey: "user_a:ws-1",
});
await Position.create({
  authUserId: "user_b",
  eventId: event.eventId,
  marketId: market.marketId,
  outcomeId: noId,
  outcomeLabel: "No",
  eventSlug: event.slug,
  eventTitle: event.title,
  marketTitle: market.title,
  stakeKobo: 50_000,
  priceKobo: 5_000,
  shares: 10,
  potentialPayoutKobo: 100_000,
  idempotencyKey: "user_b:ws-1",
});

/* ---------------- risk, before anything settles ---------------- */

// balanced: ₦105,000 collected against ₦100,000 owed either way, so the
// house keeps ₦5,000 whichever side lands — the margin, actually earned
const balanced = await risk.openRiskByMarket();
check("the open market is measured", balanced.length === 1);
check("both sides are broken out", balanced[0]?.outcomes.length === 2);
check("all stakes are counted", balanced[0]?.stakeKobo === 105_000);
check(
  "a balanced book wins either way",
  balanced[0]?.outcomes.every((o) => o.profitIfWinsKobo === 5_000) === true,
);
check("nothing is short", (balanced[0]?.worstCaseKobo ?? -1) === 5_000);

const balancedBook = await risk.getBookRisk();
check("the book holds what was staked", balancedBook.openStakeKobo === 105_000);
check("the book's floor is a profit", balancedBook.worstCaseKobo === 5_000);
check("nothing is flagged as a risk", balancedBook.worstMarket === null);

// now tip it: four more Yes stakes and no No money against them
for (let i = 0; i < 4; i += 1) {
  await Position.create({
    authUserId: `user_pile_${i}`,
    eventId: event.eventId,
    marketId: market.marketId,
    outcomeId: yesId,
    outcomeLabel: "Yes",
    eventSlug: event.slug,
    eventTitle: event.title,
    marketTitle: market.title,
    stakeKobo: 55_000,
    priceKobo: 5_500,
    shares: 10,
    potentialPayoutKobo: 100_000,
    idempotencyKey: `user_pile_${i}:ws-1`,
  });
}

// ₦325,000 in; Yes landing owes ₦500,000
const lopsided = (await risk.openRiskByMarket())[0]!;
const yesSide = lopsided.outcomes.find((o) => o.outcomeId === yesId)!;
const noSide = lopsided.outcomes.find((o) => o.outcomeId === noId)!;
check("the heavy side is priced out", yesSide.profitIfWinsKobo === -175_000);
check("the light side is all upside", noSide.profitIfWinsKobo === 225_000);
check("the worst side is the heavy one", lopsided.worstOutcomeId === yesId);
check(
  "the sides are ordered worst-first",
  lopsided.outcomes[0]?.outcomeId === yesId,
);

const tippedBook = await risk.getBookRisk();
check("the book reports the loss", tippedBook.worstCaseKobo === -175_000);
check(
  "and names the market carrying it",
  tippedBook.worstMarket?.marketId === market.marketId,
);
check("open positions are counted", tippedBook.openPositions === 6);

/* ---------------- settlement + close-out ---------------- */

const result = await settlement.adminSettleMarket({
  eventId: event.eventId,
  marketId: market.marketId,
  winningOutcomeId: yesId,
  actor: "admin_1",
  log,
});
check("every open position settles", result.positionsSettled === 6);
// the five Yes holders are paid ₦1,000 each, the one No holder nothing
check("only the winning side is paid", result.payoutTotalKobo === 500_000);

const closed = await WorldstreetMarket.findOne({ marketId: market.marketId });
check("the market records its winner", closed?.resolvedOutcomeId === yesId);
check("the market stops taking stakes", closed?.status === "resolved");
const rolled = await WorldstreetEvent.findOne({ eventId: event.eventId });
check("the event rolls to resolved", rolled?.status === "resolved");

const again = await settlement.adminSettleMarket({
  eventId: event.eventId,
  marketId: market.marketId,
  winningOutcomeId: noId,
  actor: "admin_1",
  log,
});
check("a second settlement is refused", again.outcome === "already_settled");

// a pass over an already-settled event must not double-pay or throw
await settlement.runSettlementPass(log);
check(
  "the poller leaves a settled market alone",
  (await Position.countDocuments({ marketId: market.marketId, status: "open" })) === 0,
);

console.log(`\n${passed} passed, ${failed} failed`);

await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
