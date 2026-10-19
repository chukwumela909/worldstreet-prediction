/**
 * Local games close at kickoff: the kickoff read from Bayse's games list
 * and from the market rules, and the order path refusing a game that has
 * started (or whose kickoff nothing states) — on an in-memory database,
 * with Relay answered by canned responses instead of the network.
 *
 *   npx tsx scripts/kickoff-smoke.mts
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
const { kickoffFromRules, fetchBayseEvent } = await import("../src/trading/bayse.js");
const { creditNaira } = await import("../src/trading/ledger.js");
const { ensureTradingIndexes } = await import("../src/trading/models.js");
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
    await fn();
    return "ok";
  } catch (err) {
    return err instanceof ApiError ? err.code : String((err as Error).message);
  }
}

/** "October 20, 2026 at 7:00 PM" — how Bayse's rules state a kickoff. */
function rulesTime(ms: number): string {
  const d = new Date(ms);
  const month = d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const h = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${d.getUTCDate()}, ${d.getUTCFullYear()} at ${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
}
const rules = (ms: number) =>
  `If Roma wins the Roma vs Slovan Bratislava game originally scheduled for ${rulesTime(ms)} UTC after 90 minutes, the market resolves to Yes.`;

/* ---------------- reading kickoff from the rules ---------------- */
console.log("rules text");
check(
  "Bayse's wording parses to the stated UTC time",
  kickoffFromRules(
    "…soccer game originally scheduled for October 20, 2026 at 7:00 PM UTC after 90 minutes…",
  ) === Date.parse("2026-10-20T19:00:00Z"),
);
check(
  "a morning kickoff",
  kickoffFromRules("scheduled for March 3, 2027 at 11:30 AM UTC") === Date.parse("2027-03-03T11:30:00Z"),
);
check("rules with no kickoff → none", Number.isNaN(kickoffFromRules("Resolves Yes if the bill passes.")));

/* ---------------- canned Relay ---------------- */
const now = Date.now();
const HOUR = 3_600_000;
// rules state whole minutes, so the listed kickoff is on one too
const SOON = Math.floor((now + HOUR) / 60_000) * 60_000;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GAME_SOON = id(901);
const GAME_STARTED = id(902);
const GAME_UNLISTED = id(903);

const games = [
  { id: GAME_SOON, startDate: new Date(SOON).toISOString() },
  { id: GAME_STARTED, startDate: new Date(now - 10 * 60_000).toISOString() },
];

function event(n: number, extra: { sportGameId?: string; rules?: string }) {
  return {
    id: id(n),
    slug: `ev-${n}`,
    title: `Event ${n}`,
    status: "open",
    // Bayse's own close: three hours after kickoff, still ahead
    closingDate: new Date(now + 3 * HOUR).toISOString(),
    resolutionDate: new Date(now + 4 * HOUR).toISOString(),
    ...(extra.sportGameId && { sportGameId: extra.sportGameId }),
    markets: [
      {
        id: id(n + 100),
        title: "Yes",
        status: "open",
        outcome1Id: id(n + 200),
        outcome1Label: "Yes",
        outcome1Price: 0.5,
        outcome2Id: id(n + 300),
        outcome2Label: "No",
        outcome2Price: 0.5,
        ...(extra.rules && { rules: extra.rules }),
      },
    ],
  };
}
const EVENTS = {
  upcoming: event(1, { sportGameId: GAME_SOON, rules: rules(SOON) }),
  started: event(2, { sportGameId: GAME_STARTED }),
  rulesOnly: event(3, { sportGameId: GAME_UNLISTED, rules: rules(now - 5 * 60_000) }),
  unknown: event(4, { sportGameId: id(904) }),
  notAGame: event(5, {}),
  // the list says later, the rules say it already began: earliest wins
  disagree: event(6, { sportGameId: GAME_SOON, rules: rules(now - 60_000) }),
};

let gameListCalls = 0;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/v1/pm/sports/games") {
    gameListCalls += 1;
    return json({ games, pagination: { lastPage: 1 } });
  }
  const ev = Object.values(EVENTS).find((e) => url.pathname === `/v1/pm/events/${e.id}`);
  return ev ? json(ev) : json({ message: "not found" }, 404);
}) as typeof fetch;

/* ---------------- kickoff on the fetched event ---------------- */
console.log("kickoff on the event");
const upcoming = await fetchBayseEvent(EVENTS.upcoming.id);
check(
  "a listed game carries its kickoff",
  upcoming.kickoff === new Date(Date.parse(games[0]!.startDate)).toISOString(),
);
check("a non-game has none", (await fetchBayseEvent(EVENTS.notAGame.id)).kickoff === undefined);
check("an unlisted game falls back to its rules", typeof (await fetchBayseEvent(EVENTS.rulesOnly.id)).kickoff === "string");
check("a game no source dates is null", (await fetchBayseEvent(EVENTS.unknown.id)).kickoff === null);
check("the games list is fetched once and reused", gameListCalls === 1);

/* ---------------- the order path ---------------- */
console.log("orders");
await creditNaira({
  authUserId: "u-fan",
  amountKobo: 1_000_000,
  type: "conversion_in",
  refKey: "fund:u-fan",
  description: "test funds",
});
let k = 0;
const bet = (e: ReturnType<typeof event>) =>
  outcomeOf(() =>
    placeOrder(
      "u-fan",
      {
        eventId: e.id,
        marketId: e.markets[0]!.id,
        outcomeId: e.markets[0]!.outcome1Id,
        stakeKobo: 10_000,
        expectedPriceKobo: 5_200, // 50% + the 2-point Local spread
        idempotencyKey: `kickoff-key-${++k}`,
      },
      { info() {}, warn() {}, error() {} } as unknown as import("fastify").FastifyBaseLogger,
    ),
  );

check("before kickoff a game takes bets", (await bet(EVENTS.upcoming)) === "ok");
check("after kickoff it's refused (GAME_STARTED)", (await bet(EVENTS.started)) === "GAME_STARTED");
check("a kickoff found only in the rules still closes it", (await bet(EVENTS.rulesOnly)) === "GAME_STARTED");
check("the earlier of the two sources wins", (await bet(EVENTS.disagree)) === "GAME_STARTED");
check("a game with no known kickoff is refused", (await bet(EVENTS.unknown)) === "GAME_START_UNKNOWN");
check("a non-game market is unaffected", (await bet(EVENTS.notAGame)) === "ok");

console.log(`\n${passed} passed, ${failed} failed`);

await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
