/**
 * The no-database half of polymarket-smoke.mts, for a quick run: pricing,
 * result reading, mapping, id rules and the live dispatch.
 *
 *   npx tsx scripts/polymarket-quick.mts
 */
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_fake";
process.env.CLERK_SECRET_KEY = "sk_test_fake";
process.env.POLYMARKET_SPREAD_BPS = "300";

const { buyPriceKobo } = await import("../src/trading/polymarket/pricing.js");
const { finalResolution } = await import("../src/trading/polymarket/resolution.js");
const pm = await import("../src/trading/polymarket/index.js");
const { fetchGammaEvent } = await import("../src/trading/polymarket/client.js");
const { eventOrMarketId, outcomeId } = await import("../src/trading/ids.js");

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

check("60% sells at 63", buyPriceKobo(0.6, 300) === 6_300);
check("40% sells at 43", buyPriceKobo(0.4, 300) === 4_300);
check("capped at 99", buyPriceKobo(0.985, 300) === 9_900);
check("decided outcomes unquoted", buyPriceKobo(1, 300) === 0 && buyPriceKobo(0, 300) === 0);

const base = { id: "1", outcomes: '["Yes","No"]', clobTokenIds: '["111","222"]' };
check("final 1/0 → winner 0", finalResolution({ ...base, closed: true, umaResolutionStatus: "resolved", outcomePrices: '["1","0"]' })?.kind === "winner");
check("50/50 → void", finalResolution({ ...base, closed: true, umaResolutionStatus: "resolved", outcomePrices: '["0.5","0.5"]' })?.kind === "void");
check("proposed is not final", finalResolution({ ...base, closed: true, umaResolutionStatus: "proposed", outcomePrices: '["1","0"]' }) === null);

const now = Date.parse("2026-10-15T12:00:00Z");
const ev = pm.fromPolymarket(
  {
    id: 42, slug: "g", title: "G", active: true, closed: false, endDate: "2026-10-20T00:00:00Z",
    markets: [
      { ...base, id: 7, active: true, closed: false, outcomePrices: '["0.6","0.4"]' },
      { id: 8, outcomes: '["Yes","No"]', clobTokenIds: '["3","4"]', active: true, closed: false, outcomePrices: '["0.5","0.5"]', gameStartTime: "2026-10-15 11:00:00+00" },
    ],
  },
  now,
);
check("open market priced with spread", ev.markets[0]?.status === "open" && ev.markets[0].outcomes[0]?.priceKobo === 6_300);
check("kickoff closes a game market", ev.markets[1]?.status === "closed");
check("ids accepted", eventOrMarketId.safeParse("5187252").success && outcomeId.safeParse("8".repeat(77)).success);
check("path tricks rejected", !eventOrMarketId.safeParse("../x").success);

try {
  // straight from Gamma: fetchPolymarketEvent also reads the desk settings, which needs a database
  const resolved = pm.fromPolymarket(await fetchGammaEvent("777919"));
  const blanche = resolved.markets.find((m) => m.id === "3244600");
  check("live: resolved market reads its winner", blanche?.status === "resolved" && blanche.resolvedOutcomeLabel === "Yes");
  const zeldin = resolved.markets.find((m) => m.id === "3244599");
  check("live: losing market reads No", zeldin?.resolvedOutcomeLabel === "No");
} catch (err) {
  console.log("  (Gamma unreachable)", (err as Error).message);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
