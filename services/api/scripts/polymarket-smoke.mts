/**
 * Smoke test for the international (Polymarket) book against an
 * in-memory Mongo and LIVE Gamma (no real DB, env or money):
 *
 *   npx tsx scripts/polymarket-smoke.mts
 *
 * Covers the pieces that decide money on this book: the spread, the
 * statuses that stop trading (closed, kickoff), reading a FINAL result
 * (and ignoring a merely proposed one), the 50/50 void, the id rules,
 * the origin dispatch by id shape — and then an actual settlement pass
 * over positions on markets Polymarket has already resolved, checked
 * down to the kobo in the ledger.
 */
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_fake";
process.env.CLERK_SECRET_KEY = "sk_test_fake";
process.env.POLYMARKET_SPREAD_BPS = "300";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: "test" });

const { Position, ensureTradingIndexes } = await import("../src/trading/models.js");
const { getNairaBalanceKobo } = await import("../src/trading/ledger.js");
const { buyPriceKobo } = await import("../src/trading/polymarket/pricing.js");
const { finalResolution } = await import("../src/trading/polymarket/resolution.js");
const pm = await import("../src/trading/polymarket/index.js");
const { eventOrMarketId, outcomeId } = await import("../src/trading/ids.js");
const events = await import("../src/trading/events.js");
const settlement = await import("../src/trading/settlement.js");

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

const log = {
  info: () => {},
  warn: () => {},
  error: (...args: unknown[]) => console.error("    log.error", ...args),
} as unknown as import("fastify").FastifyBaseLogger;

/* ---------------- pricing ---------------- */
console.log("pricing");
check("60% sells at 63 (3-point spread)", buyPriceKobo(0.6, 300) === 6_300);
check("both sides carry the spread", buyPriceKobo(0.4, 300) === 4_300);
check("near-certain outcome is capped below the payout", buyPriceKobo(0.985, 300) === 9_900);
check("decided outcomes aren't quoted", buyPriceKobo(1, 300) === 0 && buyPriceKobo(0, 300) === 0);
check("garbage isn't quoted", buyPriceKobo(Number.NaN, 300) === 0);

/* ---------------- resolution ---------------- */
console.log("resolution");
const base = { id: "1", outcomes: '["Yes","No"]', clobTokenIds: '["111","222"]' };
check(
  "final 1/0 → winner index 0",
  JSON.stringify(
    finalResolution({ ...base, closed: true, umaResolutionStatus: "resolved", outcomePrices: '["1","0"]' }),
  ) === JSON.stringify({ kind: "winner", index: 0 }),
);
check(
  "final 0/1 → winner index 1",
  finalResolution({ ...base, closed: true, umaResolutionStatus: "resolved", outcomePrices: '["0","1"]' })
    ?.kind === "winner",
);
check(
  "50/50 → void",
  finalResolution({ ...base, closed: true, umaResolutionStatus: "resolved", outcomePrices: '["0.5","0.5"]' })
    ?.kind === "void",
);
check(
  "a proposed answer is not final",
  finalResolution({ ...base, closed: true, umaResolutionStatus: "proposed", outcomePrices: '["1","0"]' }) === null,
);
check(
  "an open market has no result",
  finalResolution({ ...base, closed: false, outcomePrices: '["0.6","0.4"]' }) === null,
);

/* ---------------- mapping ---------------- */
console.log("mapping");
const now = Date.parse("2026-10-15T12:00:00Z");
const mapped = pm.fromPolymarket(
  {
    id: 42,
    slug: "game",
    title: "Game",
    active: true,
    closed: false,
    endDate: "2026-10-20T00:00:00Z",
    markets: [
      { ...base, id: 7, active: true, closed: false, outcomePrices: '["0.6","0.4"]' },
      {
        id: 8,
        outcomes: '["Yes","No"]',
        clobTokenIds: '["333","444"]',
        active: true,
        closed: false,
        outcomePrices: '["0.5","0.5"]',
        gameStartTime: "2026-10-15 11:00:00+00",
      },
      {
        id: 9,
        outcomes: '["Yes","No"]',
        clobTokenIds: '["555","666"]',
        closed: true,
        umaResolutionStatus: "resolved",
        outcomePrices: '["0.5","0.5"]',
      },
    ],
  },
  now,
);
const [open, started, split] = mapped.markets;
check("origin and ids are Gamma's", mapped.origin === "polymarket" && mapped.id === "42");
check("open market is open, priced with spread", open?.status === "open" && open.outcomes[0]?.priceKobo === 6_300);
check("outcome ids are the CLOB tokens", open?.outcomes[1]?.id === "222");
check("a game stops trading at kickoff", started?.status === "closed");
check("a 50/50 market resolves as a void", split?.status === "resolved" && split.voided === true);

/* ---------------- ids + dispatch ---------------- */
console.log("ids");
check("Gamma event id is a Polymarket id", pm.isPolymarketId("1115111"));
check("a UUID is not", !pm.isPolymarketId("3f2b1c4e-9a7d-4e2b-8c1a-0b5d6e7f8a90"));
check("routes accept Gamma and UUID ids", eventOrMarketId.safeParse("5187252").success && eventOrMarketId.safeParse("3f2b1c4e-9a7d-4e2b-8c1a-0b5d6e7f8a90").success);
check("routes accept a 77-digit token id", outcomeId.safeParse("8".repeat(77)).success);
check("routes reject path tricks", !eventOrMarketId.safeParse("../admin").success && !outcomeId.safeParse("1/2").success);

/* ---------------- live Gamma ---------------- */
console.log("live Gamma");
let live: Awaited<ReturnType<typeof events.fetchTradableEvent>> | null = null;
try {
  // the busiest event is often a game already in play, whose markets we
  // close at kickoff — so take the first of the top ten that's still open
  const list = (await (
    await fetch(
      "https://gamma-api.polymarket.com/events?limit=10&closed=false&active=true&order=volume24hr&ascending=false",
      { signal: AbortSignal.timeout(15_000) },
    )
  ).json()) as { id: string }[];
  for (const { id } of list) {
    const ev = await events.fetchTradableEvent(String(id));
    live ??= ev;
    if (ev.markets.some((m) => m.status === "open")) {
      live = ev;
      break;
    }
  }
} catch (err) {
  console.log("    (Gamma unreachable — live checks skipped)", (err as Error).message);
}
if (live) {
  check("an all-digit id dispatches to Polymarket", live.origin === "polymarket");
  const priced = live.markets.find((m) => m.status === "open");
  if (priced) {
    check(
      "a live open market is priced on our book",
      priced.outcomes.every((o) => o.priceKobo >= 0 && o.priceKobo <= 9_900),
    );
  } else {
    console.log("    (no open market among the top ten right now — pricing check skipped)");
  }
}

/* ---------------- settlement on real results ---------------- */
// "Who will be Trump's next Attorney General?" — resolved on Polymarket:
// Todd Blanche (market 3244600) Yes, Lee Zeldin (3244599) No.
console.log("settlement (resolved Polymarket event 777919)");
let resolved: Awaited<ReturnType<typeof events.fetchTradableEvent>> | null = null;
try {
  resolved = await events.fetchTradableEvent("777919");
} catch (err) {
  console.log("    (Gamma unreachable — settlement checks skipped)", (err as Error).message);
}
if (resolved) {
  const blanche = resolved.markets.find((m) => m.id === "3244600");
  const zeldin = resolved.markets.find((m) => m.id === "3244599");
  check("Blanche resolved with a winner", blanche?.status === "resolved" && Boolean(blanche.resolvedOutcomeId));
  check("Zeldin resolved with a winner", zeldin?.status === "resolved" && Boolean(zeldin.resolvedOutcomeId));

  if (blanche && zeldin) {
    const yes = (m: typeof blanche) => m.outcomes[0]!.id;
    const no = (m: typeof blanche) => m.outcomes[1]!.id;
    const position = (user: string, market: typeof blanche, outcome: string, label: string) =>
      Position.create({
        authUserId: user,
        eventId: "777919",
        marketId: market.id,
        outcomeId: outcome,
        outcomeLabel: label,
        eventSlug: resolved!.slug,
        eventTitle: resolved!.title,
        marketTitle: market.title,
        stakeKobo: 5_000,
        priceKobo: 5_000,
        shares: 1,
        potentialPayoutKobo: 10_000,
        status: "open",
        source: "polymarket",
        idempotencyKey: `${user}:${market.id}:${outcome}`,
      });
    // alice backs both winners, bob both losers
    await position("alice", blanche, yes(blanche), "Yes");
    await position("alice", zeldin, no(zeldin), "No");
    await position("bob", blanche, no(blanche), "No");
    await position("bob", zeldin, yes(zeldin), "Yes");

    await settlement.runSettlementPass(log);

    const left = await Position.countDocuments({ status: "open" });
    const won = await Position.countDocuments({ authUserId: "alice", status: "won" });
    const lost = await Position.countDocuments({ authUserId: "bob", status: "lost" });
    check("every position settled", left === 0);
    check("winners won", won === 2);
    check("losers lost", lost === 2);
    check("winner paid ₦100 per share, twice", (await getNairaBalanceKobo("alice")) === 20_000);
    check("loser paid nothing", (await getNairaBalanceKobo("bob")) === 0);

    await settlement.runSettlementPass(log);
    check("a second pass pays nothing more", (await getNairaBalanceKobo("alice")) === 20_000);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
await mongoose.disconnect();
await mongod.stop();
process.exit(failed ? 1 : 0);
