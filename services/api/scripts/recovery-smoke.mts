/**
 * Recovery: reversing every settled bet on the 15-minute crypto markets
 * — winnings taken back, stakes returned, balances allowed below zero or
 * capped at what's there — through the real admin routes, plus the
 * report and the customer email. In-memory database, our own markets,
 * Resend answered by a canned reply.
 *
 *   npx tsx scripts/recovery-smoke.mts
 */
const KEY = "smoke-recovery-key-0123456789abcdefXYZ";
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk";
process.env.CLERK_SECRET_KEY = "sk_test_fake";
process.env.SETTLEMENT_POLL_SECONDS = "0";
process.env.ADMIN_ACCESS_KEYS = `josh:${KEY}`;
process.env.RESEND_API_KEY = "re_test";
process.env.ALERT_EMAIL_FROM = "WorldStreet <alerts@worldstreetgold.test>";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: "test" });

const { ApiError } = await import("../src/errors.js");
const { buildApp } = await import("../src/app.js");
const { placeOrder } = await import("../src/routes/trades.js");
const settings = await import("../src/trading/settings.js");
const { adminSettleMarket } = await import("../src/trading/settlement.js");
const { creditNaira, debitNaira, getNairaBalanceKobo } = await import("../src/trading/ledger.js");
const { getAdminOverview } = await import("../src/trading/overview.js");
const { LedgerEntry, Position, WorldstreetEvent, WorldstreetMarket, ensureTradingIndexes } = await import(
  "../src/trading/models.js"
);
const { User } = await import("../src/models.js");
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
const log = { info() {}, warn() {}, error() {} } as unknown as import("fastify").FastifyBaseLogger;

// Resend, answered here
const sent: { to: string[]; subject: string; text: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.resend.com/")) {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "email" }), { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;

const admin = (method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { "x-admin-key": KEY }, ...(payload !== undefined && { payload: payload as object }) });

/* ---------------- a book with 15-minute crypto bets ---------------- */
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
      { label: "Up", priceKobo: 9_500 },
      { label: "Down", priceKobo: 1_000 },
    ],
  });
  return { eventId: event.eventId, marketId: market.marketId, up: market.outcomes[0]!.outcomeId, down: market.outcomes[1]!.outcomeId, title };
}
let n = 0;
/** A bet as the order route leaves it: stake debited, position open. */
async function bet(m: Awaited<ReturnType<typeof ownMarket>>, user: string, side: "up" | "down", stakeKobo: number, priceKobo: number) {
  n += 1;
  await debitNaira({ authUserId: user, amountKobo: stakeKobo, type: "trade_stake", refKey: `stake-${n}`, description: "bet" });
  await Position.create({
    authUserId: user,
    eventId: m.eventId,
    marketId: m.marketId,
    outcomeId: side === "up" ? m.up : m.down,
    outcomeLabel: side === "up" ? "Up" : "Down",
    eventSlug: m.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    eventTitle: m.title,
    marketTitle: m.title,
    stakeKobo,
    priceKobo,
    shares: stakeKobo / priceKobo,
    potentialPayoutKobo: Math.floor((stakeKobo / priceKobo) * 10_000),
    idempotencyKey: `bet-${n}`,
  });
}
for (const [id, name] of [["u-win", "ada"], ["u-lose", "tunde"], ["u-spent", "kemi"], ["u-other", "bola"]] as const) {
  await User.create({ authUserId: id, email: `${name}@example.test`, username: name, displayName: name });
  await creditNaira({ authUserId: id, amountKobo: 10_000_000, type: "conversion_in", refKey: `fund:${id}`, description: "funds" });
}

const btc = await ownMarket("Bitcoin Up or Down - 15 minutes?");
const eth = await ownMarket("Ethereum Up or Down - 15 minutes?");
const other = await ownMarket("Will BTC close above $120k on Friday?");
// ada: two near-certain wins at ₦95 (₦50k each pays ₦52,631)
await bet(btc, "u-win", "up", 5_000_000, 9_500);
await bet(eth, "u-win", "up", 5_000_000, 9_500);
// tunde: a ₦30k loss
await bet(btc, "u-lose", "down", 3_000_000, 1_000);
// kemi: a ₦50k win, then spends more than her stake elsewhere
await bet(eth, "u-spent", "up", 5_000_000, 9_500);
// bola: a bet on a market that isn't a 15-minute round
await bet(other, "u-other", "up", 1_000_000, 9_500);
for (const m of [btc, eth, other]) {
  await adminSettleMarket({ eventId: m.eventId, marketId: m.marketId, winningOutcomeId: m.up, actor: "auto", log });
}
await debitNaira({ authUserId: "u-spent", amountKobo: 10_200_000, type: "trade_stake", refKey: "spent-elsewhere", description: "spent" });

const bal = (id: string) => getNairaBalanceKobo(id);
const adaBefore = await bal("u-win"); // 10,000,000 − 10,000,000 + 2 × 5,263,157
const tundeBefore = await bal("u-lose"); // 7,000,000
const kemiBefore = await bal("u-spent"); // 10,000,000 − 5,000,000 + 5,263,157 − 10,000,000
const bolaBefore = await bal("u-other");
const payout = Math.floor((5_000_000 / 9_500) * 10_000); // 5,263,157

const TOPICS = ["up or down 15 minutes", "up or down 15m"];

/* ---------------- preview ---------------- */
console.log("preview");
const pv = (await admin("POST", "/v1/admin/recovery/preview", { topics: TOPICS, sinceDays: null })).json() as {
  data: Record<string, unknown> & { events: { title: string }[] };
};
const p = pv.data as unknown as {
  bets: number; won: number; lost: number; customers: number; takeBackKobo: number; returnKobo: number;
  netKobo: number; shortCustomers: number; paused: boolean; events: { title: string }[];
};
check(`all-time preview finds the 4 round bets, not the other market (got ${p.bets})`, p.bets === 4 && p.won === 3 && p.lost === 1 && p.customers === 3);
check(
  "…with what comes back and what goes out",
  p.takeBackKobo === 3 * (payout - 5_000_000) && p.returnKobo === 3_000_000 && p.netKobo === p.takeBackKobo - p.returnKobo,
);
check("…who'd go below zero", p.shortCustomers === 1);
check("…which markets matched", p.events.length === 2 && !p.events.some((e) => e.title.includes("Friday")));
check("…and that they aren't paused yet", p.paused === false);

const blocked = await admin("POST", "/v1/admin/recovery/run", { topics: TOPICS, sinceDays: null, shortfall: "negative", confirm: "REVERSE" });
check("running needs the topics paused first (NOT_PAUSED)", blocked.statusCode === 409 && (blocked.json() as { code: string }).code === "NOT_PAUSED");
const noConfirm = await admin("POST", "/v1/admin/recovery/run", { topics: TOPICS, sinceDays: null, shortfall: "negative", confirm: "yes" });
check("…and the typed REVERSE confirmation", noConfirm.statusCode === 400);

/* ---------------- run ---------------- */
console.log("run");
await settings.updateBookSettings({ pausedTopics: [...TOPICS] }, "smoke");
const run = (await admin("POST", "/v1/admin/recovery/run", { topics: TOPICS, sinceDays: null, shortfall: "negative", confirm: "REVERSE" })).json() as {
  data: { reversed: number; remaining: number; changeKobo: number };
};
check(`one batch reverses all 4 (got ${run.data.reversed}, ${run.data.remaining} left)`, run.data.reversed === 4 && run.data.remaining === 0);
check("the winner gives back the winnings, keeps the stakes", (await bal("u-win")) === adaBefore - 2 * (payout - 5_000_000));
check("the loser gets the stake back", (await bal("u-lose")) === tundeBefore + 3_000_000);
check("the one who spent it goes below zero", (await bal("u-spent")) === kemiBefore - (payout - 5_000_000) && (await bal("u-spent")) < 0);
check("the other market is untouched", (await bal("u-other")) === bolaBefore);
check(
  "the bets now read as reversed",
  (await Position.countDocuments({ reversedFrom: { $in: ["won", "lost"] }, status: "voided" })) === 4,
);
check("each in the ledger as a reversal", (await LedgerEntry.countDocuments({ type: "reversal" })) === 4);

const again = (await admin("POST", "/v1/admin/recovery/run", { topics: TOPICS, sinceDays: null, shortfall: "negative", confirm: "REVERSE" })).json() as {
  data: { reversed: number };
};
check("running again reverses nothing twice", again.data.reversed === 0 && (await bal("u-lose")) === tundeBefore + 3_000_000);

/* ---------------- what that does to the book ---------------- */
const overview = await getAdminOverview();
check(
  "the overview no longer counts the reversed payouts",
  overview.periods.allTime.payoutsKobo === Math.floor((1_000_000 / 9_500) * 10_000),
);

const negativeBet = await (async () => {
  try {
    await placeOrder("u-spent", { eventId: other.eventId, marketId: other.marketId, outcomeId: other.up, stakeKobo: 10_000, expectedPriceKobo: 9_500, idempotencyKey: "after-key-1" }, log);
    return "ok";
  } catch (err) {
    return err instanceof ApiError ? err.code : "error";
  }
})();
check("a negative balance can't bet", negativeBet !== "ok");

/* ---------------- the Recovery report ---------------- */
console.log("report");
const rep = (await admin("GET", "/v1/admin/recovery")).json() as {
  data: { totals: Record<string, number>; customers: { username: string; balanceKobo: number; emailedAt: string | null }[] };
};
const rt = rep.data.totals;
check(
  `totals: taken back, returned, net, owed (got ${rt.takenBackKobo}/${rt.returnedKobo}/${rt.netKobo}/${rt.owedKobo})`,
  rt.bets === 4 && rt.customers === 3 && rt.takenBackKobo === 3 * (payout - 5_000_000) && rt.returnedKobo === 3_000_000 &&
    rt.netKobo === rt.takenBackKobo - rt.returnedKobo && rt.owedKobo === -(await bal("u-spent")) && rt.owingCustomers === 1,
);
check("…nobody emailed yet", rt.notEmailed === 3);

/* ---------------- the email ---------------- */
console.log("email");
const dry = (await admin("POST", "/v1/admin/recovery/notify", { dryRun: true })).json() as { data: { customers: number; emailed: number } };
check("the preview counts 3, sends none", dry.data.customers === 3 && dry.data.emailed === 0 && sent.length === 0);
const real = (await admin("POST", "/v1/admin/recovery/notify", { dryRun: false })).json() as { data: { emailed: number } };
const toKemi = sent.find((m) => m.to[0] === "kemi@example.test");
check("sending emails each of them once", real.data.emailed === 3 && sent.length === 3);
check(
  "…saying why and what changed",
  Boolean(toKemi?.text.includes("glitch in our system") && toKemi.text.includes("below zero") && toKemi.subject.includes("reversed")),
);
check("…and nobody twice", ((await admin("POST", "/v1/admin/recovery/notify", { dryRun: false })).json() as { data: { emailed: number } }).data.emailed === 0);
check(
  "the report shows them emailed",
  ((await admin("GET", "/v1/admin/recovery")).json() as { data: { totals: { emailed: number } } }).data.totals.emailed === 3,
);

/* ---------------- clearing what's owed ---------------- */
console.log("clear debts");
const owedBefore = -(await bal("u-spent"));
const clearDry = (await admin("POST", "/v1/admin/recovery/clear-debts", { dryRun: true })).json() as {
  data: { customers: number; owedKobo: number };
};
check("the preview finds the one customer below zero and what's owed", clearDry.data.customers === 1 && clearDry.data.owedKobo === owedBefore);
check("…without moving money", (await bal("u-spent")) === -owedBefore);
const cleared = (await admin("POST", "/v1/admin/recovery/clear-debts", { dryRun: false })).json() as {
  data: { customers: number; owedKobo: number };
};
check("clearing brings them back to exactly zero", cleared.data.customers === 1 && (await bal("u-spent")) === 0);
check("…recorded as a write-off", (await LedgerEntry.countDocuments({ type: "debt_writeoff", authUserId: "u-spent" })) === 1);
check("…and nobody else's balance moves", (await bal("u-win")) === adaBefore - 2 * (payout - 5_000_000));
const afterClear = ((await admin("GET", "/v1/admin/recovery")).json() as { data: { totals: Record<string, number> } }).data.totals;
check(
  "the report: nothing owed, the write-off counted, recovered net of it",
  afterClear.owedKobo === 0 && afterClear.writtenOffKobo === owedBefore &&
    afterClear.netKobo === afterClear.takenBackKobo - afterClear.returnedKobo - owedBefore,
);
check(
  "clearing again does nothing",
  ((await admin("POST", "/v1/admin/recovery/clear-debts", { dryRun: false })).json() as { data: { customers: number } }).data.customers === 0,
);

/* ---------------- capped: take only what's there ---------------- */
console.log("cap");
await User.create({ authUserId: "u-cap", email: "chidi@example.test", username: "chidi", displayName: "chidi" });
await creditNaira({ authUserId: "u-cap", amountKobo: 5_000_000, type: "conversion_in", refKey: "fund:u-cap", description: "funds" });
const sol = await ownMarket("Solana Up or Down - 15 minutes?");
await bet(sol, "u-cap", "up", 5_000_000, 9_500);
await adminSettleMarket({ eventId: sol.eventId, marketId: sol.marketId, winningOutcomeId: sol.up, actor: "auto", log });
await debitNaira({ authUserId: "u-cap", amountKobo: 5_000_000, type: "trade_stake", refKey: "cap-spent", description: "spent" });
const capBefore = await bal("u-cap"); // payout − 5,000,000 = 263,157 left
const capRun = (await admin("POST", "/v1/admin/recovery/run", { topics: TOPICS, sinceDays: null, shortfall: "cap", confirm: "REVERSE" })).json() as {
  data: { reversed: number; writtenOffKobo: number };
};
check(
  `capped: takes the ₦${capBefore / 100} that's there, stops at zero, writes off the rest`,
  capRun.data.reversed === 1 && (await bal("u-cap")) === 0 && capRun.data.writtenOffKobo === payout - 5_000_000 - capBefore,
);

console.log(`\n${passed} passed, ${failed} failed`);

await app.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
