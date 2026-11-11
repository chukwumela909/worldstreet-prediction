/**
 * Abuse watch, through the real admin route: each scan finds the pattern
 * planted for it — and leaves fair players alone — and held withdrawals
 * can be settled from it. In-memory database, positions written directly.
 *
 *   npx tsx scripts/abuse-smoke.mts
 */
const KEY = "smoke-abuse-key-0123456789abcdefXYZ";
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk";
process.env.CLERK_SECRET_KEY = "sk_test_fake";
process.env.SETTLEMENT_POLL_SECONDS = "0";
process.env.ADMIN_ACCESS_KEYS = `josh:${KEY}`;

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: "test" });

const { buildApp } = await import("../src/app.js");
const { adjustNaira, creditNaira, debitNaira, getNairaBalanceKobo, writeOffDebt } = await import("../src/trading/ledger.js");
const { NairaAccount, Position, WithdrawalCheck, ensureTradingIndexes } = await import("../src/trading/models.js");
const { AlertRecord, User } = await import("../src/models.js");
const { checkAbuseAlerts } = await import("../src/trading/abuse-alerts.js");
const { isFlagged } = await import("../src/trading/withdrawals.js");
const log = { info() {}, warn() {}, error() {}, debug() {} } as unknown as import("fastify").FastifyBaseLogger;
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
const admin = (method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { "x-admin-key": KEY }, ...(payload !== undefined && { payload: payload as object }) });

for (const name of ["lucky", "fair", "near", "twin1", "twin2", "cash", "gap", "owes", "waived"]) {
  await User.create({ authUserId: `u-${name}`, email: `${name}@example.test`, username: name, displayName: name });
}

let n = 0;
const now = Date.now();
async function bet(user: string, opts: { market?: string; outcome?: string; priceKobo: number; won: boolean | null; at?: number; reversed?: boolean }) {
  n += 1;
  const market = opts.market ?? `m-${n}`;
  const stakeKobo = 100_000;
  await Position.create({
    authUserId: user,
    eventId: `e-${market}`,
    marketId: market,
    outcomeId: opts.outcome ?? "yes",
    outcomeLabel: "Yes",
    eventSlug: `event-${market}`,
    eventTitle: `Event ${market}`,
    marketTitle: `Event ${market}`,
    stakeKobo,
    priceKobo: opts.priceKobo,
    shares: stakeKobo / opts.priceKobo,
    potentialPayoutKobo: Math.floor((stakeKobo / opts.priceKobo) * 10_000),
    status: opts.won === null ? "open" : opts.reversed ? "voided" : opts.won ? "won" : "lost",
    ...(opts.reversed ? { reversedFrom: "won" } : {}),
    idempotencyKey: `bet-${n}`,
    createdAt: new Date(opts.at ?? now - n * 60_000),
  });
}

// lucky: 15 wins in 20 at ₦30 — the prices said about 6
for (let i = 0; i < 20; i++) await bet("u-lucky", { priceKobo: 3_000, won: i < 15 });
// …plus reversed bets, which are left out
for (let i = 0; i < 5; i++) await bet("u-lucky", { priceKobo: 3_000, won: true, reversed: true });
// fair: 10 wins in 20 at ₦50 — just what the prices said
for (let i = 0; i < 20; i++) await bet("u-fair", { priceKobo: 5_000, won: i % 2 === 0 });
// near: 12 bets at ₦95, never losing
for (let i = 0; i < 12; i++) await bet("u-near", { priceKobo: 9_500, won: true });
// twins: the same side of six markets, 30 seconds apart; twin1 and fair share two
for (let i = 0; i < 6; i++) {
  const at = now - (100 + i) * 3_600_000;
  await bet("u-twin1", { market: `t-${i}`, priceKobo: 6_000, won: null, at });
  await bet("u-twin2", { market: `t-${i}`, priceKobo: 6_000, won: null, at: at + 30_000 });
  if (i < 2) await bet("u-fair", { market: `t-${i}`, priceKobo: 6_000, won: null, at: at + 45_000 });
}
// …and the other side of a seventh doesn't count
await bet("u-twin1", { market: "t-x", outcome: "yes", priceKobo: 6_000, won: null, at: now - 10_000 });
await bet("u-twin2", { market: "t-x", outcome: "no", priceKobo: 4_000, won: null, at: now - 5_000 });

// cash: added ₦10,000, withdrew ₦50,000 (one ₦5,000 withdrawal failed and came back)
await creditNaira({ authUserId: "u-cash", amountKobo: 1_000_000, type: "conversion_in", refKey: "convert:u-cash:in-1", description: "in" });
await creditNaira({ authUserId: "u-cash", amountKobo: 5_000_000, type: "payout", refKey: "payout:cash-1", description: "won" });
await debitNaira({ authUserId: "u-cash", amountKobo: 5_000_000, type: "conversion_out", refKey: "convert:u-cash:out-1", description: "out" });
await debitNaira({ authUserId: "u-cash", amountKobo: 500_000, type: "conversion_out", refKey: "convert:u-cash:out-2", description: "out" });
await creditNaira({ authUserId: "u-cash", amountKobo: 500_000, type: "refund", refKey: "convert:u-cash:out-2:reversal", description: "back" });
// fair added and withdrew evenly
await creditNaira({ authUserId: "u-fair", amountKobo: 2_000_000, type: "conversion_in", refKey: "convert:u-fair:in-1", description: "in" });
await debitNaira({ authUserId: "u-fair", amountKobo: 1_000_000, type: "conversion_out", refKey: "convert:u-fair:out-1", description: "out" });
// gap: ₦5 appears on the balance with no ledger entry behind it
await creditNaira({ authUserId: "u-gap", amountKobo: 100_000, type: "conversion_in", refKey: "convert:u-gap:in-1", description: "in" });
await NairaAccount.updateOne({ authUserId: "u-gap" }, { $inc: { balanceKobo: 500 } });

// owes: a reversal took back more than the balance held
await creditNaira({ authUserId: "u-owes", amountKobo: 200_000, type: "conversion_in", refKey: "convert:u-owes:in-1", description: "in" });
await adjustNaira({ authUserId: "u-owes", amountKobo: -700_000, type: "reversal", refKey: "reverse:owes-1", description: "reversed", metadata: {} });
await bet("u-owes", { priceKobo: 9_500, won: true, reversed: true });
// waived: a debt written off before, then below zero again
await adjustNaira({ authUserId: "u-waived", amountKobo: -300_000, type: "reversal", refKey: "reverse:waived-1", description: "reversed", metadata: {} });
await writeOffDebt({ authUserId: "u-waived", refKey: "writeoff:waived-1", description: "waived", metadata: {} });
await adjustNaira({ authUserId: "u-waived", amountKobo: -100_000, type: "reversal", refKey: "reverse:waived-2", description: "reversed", metadata: {} });

// a withdrawal the wallet never confirmed, credit already taken
await creditNaira({ authUserId: "u-fair", amountKobo: 400_000, type: "conversion_in", refKey: "convert:u-fair:in-2", description: "in" });
await debitNaira({ authUserId: "u-fair", amountKobo: 300_000, type: "conversion_out", refKey: "convert:u-fair:out-9", description: "out" });
await WithdrawalCheck.create({ refKey: "convert:u-fair:out-9", authUserId: "u-fair", amountKobo: 300_000, amountUsdMinor: 205, rate: 1_464.5, lastCode: "UNREACHABLE", lastMessage: "timeout" });
await WithdrawalCheck.create({ refKey: "convert:u-fair:out-8", authUserId: "u-fair", amountKobo: 1, amountUsdMinor: 1, rate: 1_464.5 });

/* ---------------- the scans ---------------- */
type Watch = {
  beatingOdds: { username: string; won: number; bets: number; expectedWins: number; z: number }[];
  nearCertain: { username: string; bets: number; won: number; profitKobo: number }[];
  twins: { a: { username: string }; b: { username: string }; sharedMarkets: number }[];
  cashOut: { username: string; addedKobo: number; withdrawnKobo: number; extraKobo: number }[];
  ledgerGaps: { username: string; gapKobo: number }[];
  withdrawals: { refKey: string; status: string; username: string }[];
  belowZero: { username: string; owedKobo: number; walletUsdMinor: number | null; reversedBets: number; waivedKobo: number }[];
};
const res = await admin("GET", "/v1/admin/abuse?days=0");
const w = (res.json() as { data: Watch }).data;
console.log("scans");
check("the route answers", res.statusCode === 200);
const lucky = w.beatingOdds.find((r) => r.username === "lucky");
check(
  `beating the odds: lucky, 15 of 20 where the prices said ~6 (z ${lucky?.z})`,
  Boolean(lucky && lucky.won === 15 && lucky.bets === 20 && lucky.expectedWins === 6 && lucky.z >= 3),
);
check("…not the fair player, nor the near-certain buyer", !w.beatingOdds.some((r) => r.username === "fair" || r.username === "near"));
check(
  "near-certain: near, 12 of 12 at ₦95 and in profit",
  w.nearCertain.length === 1 && w.nearCertain[0]!.username === "near" && w.nearCertain[0]!.won === 12 && w.nearCertain[0]!.profitKobo > 0,
);
const pair = w.twins.find((t) => [t.a.username, t.b.username].sort().join() === "twin1,twin2");
check("twins: twin1 and twin2, the same side of 6 markets", w.twins.length === 1 && pair?.sharedMarkets === 6);
const cash = w.cashOut.find((r) => r.username === "cash");
check(
  "cash-out: ₦10,000 in, ₦50,000 out (the failed one netted off), ₦40,000 extra",
  w.cashOut.length === 1 && cash?.addedKobo === 1_000_000 && cash.withdrawnKobo === 5_000_000 && cash.extraKobo === 4_000_000,
);
check("ledger gap: gap's ₦5 that no entry explains, and nobody else", w.ledgerGaps.length === 1 && w.ledgerGaps[0]!.username === "gap" && w.ledgerGaps[0]!.gapKobo === 500);
check("held withdrawals are listed, waiting first", w.withdrawals.length === 2 && w.withdrawals[0]!.status === "unconfirmed");
const owes = w.belowZero.find((r) => r.username === "owes");
const waived = w.belowZero.find((r) => r.username === "waived");
check(
  "below zero: owes ₦5,000 from a reversal, largest debt first",
  w.belowZero.length === 2 && w.belowZero[0]!.username === "owes" && owes?.owedKobo === 500_000 && owes.reversedBets === 1,
);
check(
  "…waived shows the ₦3,000 already written off, so it's clear they were told they owe nothing",
  waived?.owedKobo === 100_000 && waived.waivedKobo === 300_000 && owes?.waivedKobo === 0,
);
check("…and with no wallet to ask, their dollar balance reads unknown — nothing is charged", owes?.walletUsdMinor === null);

const recent = (await admin("GET", "/v1/admin/abuse?days=1")).json() as { data: Watch };
check("a 1-day window leaves out the twins from days ago", recent.data.twins.length === 0);

/* ---------------- the hourly scan ---------------- */
console.log("hourly scan");
const raised = await checkAbuseAlerts(log, { force: true });
const keys = (await AlertRecord.find({ kind: "abuse" }).lean()).map((r) => r.key).sort();
check(
  `the scan alerts on each flagged person once (${raised})`,
  raised === 4 &&
    JSON.stringify(keys) === JSON.stringify(["abuse:near:u-near", "abuse:odds:u-lucky", "abuse:twins:u-twin1|u-twin2"]),
);
check(
  "a balance off its ledger is filed as a system fault, not abuse — and still holds their withdrawals",
  (await AlertRecord.exists({ key: "abuse:ledger:u-gap", kind: "fault" })) !== null && (await isFlagged("u-gap")),
);
check("…and an hour hasn't passed, so it doesn't run again yet", (await checkAbuseAlerts(log)) === 0);
check(
  "a flagged person's withdrawals now wait for approval — both twins included",
  (await isFlagged("u-near")) && (await isFlagged("u-twin2")) && !(await isFlagged("u-fair")),
);
const levelOf = async (id: string) => (await User.findOne({ authUserId: id }).lean())?.stakeLevel ?? "none";
check(
  "the scan limits who it flags at once, gently: a first flag → reduced, the pair → reduced",
  (await levelOf("u-near")) === "reduced" &&
    (await levelOf("u-lucky")) === "reduced" &&
    (await levelOf("u-twin1")) === "reduced" &&
    (await levelOf("u-twin2")) === "reduced",
);
await checkAbuseAlerts(log, { force: true });
check("…and still flagged an hour later, they stay on reduced (no climbing within one spell)", (await levelOf("u-near")) === "reduced");
check(
  "…and leaves everyone else, and a ledger gap (our fault), alone",
  (await levelOf("u-fair")) === "normal" && (await levelOf("u-gap")) === "normal",
);
const nearUser = await User.findOne({ authUserId: "u-near" }).lean();
check(
  "…kept on their history, by the scan, with why",
  nearUser?.stakeLevelBy === "system:abuse" &&
    Boolean(nearUser.stakeLevelReason?.startsWith("Buying near-certain sides")) &&
    (nearUser.accountActions ?? []).some((a) => a.action === "stake_level" && a.by === "system:abuse"),
);
const nearAlert = await AlertRecord.findOne({ key: "abuse:near:u-near" }).lean();
const cleared = await admin("POST", "/v1/admin/alerts/resolve", { id: String(nearAlert!._id), note: "checked" });
check("settling the alert lifts the hold", cleared.statusCode === 200 && !(await isFlagged("u-near")));
check(
  "…and puts back the level the scan set",
  (cleared.json() as { data: { restored: number } }).data.restored === 1 && (await levelOf("u-near")) === "normal",
);
const pairAlert = await AlertRecord.findOne({ key: "abuse:twins:u-twin1|u-twin2" }).lean();
await admin("POST", "/v1/admin/alerts/resolve", { id: String(pairAlert!._id), note: "" });
check("settling the pair's alert puts both back", (await levelOf("u-twin1")) === "normal" && (await levelOf("u-twin2")) === "normal");

const set = await admin("POST", "/v1/admin/traders/u-fair/stake-level", { level: "reduced", reason: "Watching their late bets" });
const fair = await User.findOne({ authUserId: "u-fair" }).lean();
check(
  "the desk sets a level, with its reason, on the account's history",
  set.statusCode === 200 &&
    fair?.stakeLevel === "reduced" &&
    fair.stakeLevelBy === "key:josh" &&
    (fair.accountActions ?? []).some((a) => a.action === "stake_level" && a.reason === "Reduced: Watching their late bets"),
);
const again = await admin("POST", "/v1/admin/traders/u-fair/stake-level", { level: "reduced", reason: "Again, same" });
check("setting the level it's already on is refused", again.statusCode === 409);
const noWhy = await admin("POST", "/v1/admin/traders/u-fair/stake-level", { level: "normal", reason: "" });
check("…and a level needs a reason", noWhy.statusCode === 400);
const limited = (await admin("GET", "/v1/admin/traders?limitedOnly=true")).json() as {
  data: { traders: { username: string; stakeLevel: string }[] };
};
check(
  "the Limited view lists who's on a reduced or restricted level, with it",
  limited.data.traders.some((t) => t.username === "fair" && t.stakeLevel === "reduced") &&
    limited.data.traders.every((t) => t.stakeLevel !== "normal"),
);
await User.updateOne({ authUserId: "u-lucky" }, { $set: { suspendedAt: new Date() } });
await AlertRecord.deleteMany({ kind: { $in: ["abuse", "fault"] } });
await checkAbuseAlerts(log, { force: true });
check(
  "someone already suspended isn't alerted on",
  !(await AlertRecord.exists({ key: "abuse:odds:u-lucky" })) && Boolean(await AlertRecord.exists({ key: "abuse:near:u-near" })),
);
check(
  "a level a person set this week isn't lowered again by the next scan",
  (await levelOf("u-near")) === "normal",
);

console.log("alerts name who they're about");
const alertsView = (await admin("GET", "/v1/admin/alerts?status=open")).json() as {
  data: { alerts: { kind: string; people: { username: string; email: string }[] }[] };
};
const twinAlert = alertsView.data.alerts.find((a) => a.people.length === 2);
check(
  "a customer alert carries the people it's about, so the desk can act on them",
  twinAlert !== undefined && twinAlert.people.some((p) => p.username === "twin1") && twinAlert.people.every((p) => p.email.includes("@")),
);

/* ---------------- a customer's high-price bets ---------------- */
console.log("a customer's high-price bets");
await User.create({ authUserId: "u-review", email: "review@example.test", username: "review", displayName: "Review" });
await creditNaira({ authUserId: "u-review", amountKobo: 3_000, type: "conversion_in", refKey: "fund:u-review", description: "funds" });
const beforeTerms = Date.parse("2026-10-20T12:00:00Z");
const fromTerms = Date.parse("2026-10-22T12:00:00Z");
// two wins at ₦95 before the Terms (₦52.63 profit each), one loss at ₦90 after them
await bet("u-review", { market: "m-review", priceKobo: 9_500, won: true, at: beforeTerms });
await bet("u-review", { market: "m-review", priceKobo: 9_500, won: true, at: beforeTerms + 60_000 });
await bet("u-review", { market: "m-review-2", priceKobo: 9_000, won: false, at: fromTerms });
// not counted: a low price, one still open, one reversed, one refunded
await bet("u-review", { priceKobo: 5_000, won: true, at: beforeTerms });
await bet("u-review", { priceKobo: 9_500, won: null, at: beforeTerms });
await bet("u-review", { priceKobo: 9_500, won: true, at: beforeTerms, reversed: true });
await bet("u-review", { market: "m-review-void", priceKobo: 9_500, won: null, at: beforeTerms });
await Position.updateOne({ authUserId: "u-review", marketId: "m-review-void" }, { $set: { status: "voided" } });
const reviewRes = await admin("GET", "/v1/admin/traders/u-review/high-price-bets");
const reviewRow = (reviewRes.json() as {
  data: {
    allBets: number;
    highReversed: number;
    highRefunded: number;
    high: { bets: number; won: number; lost: number; stakedKobo: number; profitKobo: number };
    beforeTerms: { bets: number; profitKobo: number };
    afterTerms: { bets: number };
    markets: { bets: number; firstAt: string; lastAt: string }[];
  };
}).data;
check(
  "it counts settled ₦90+ bets only, from all their bets",
  reviewRow.allBets === 7 && reviewRow.high.bets === 3 && reviewRow.high.won === 2 && reviewRow.high.lost === 1,
);
check("…with the amount staked and the profit, losses taken off", reviewRow.high.stakedKobo === 300_000 && reviewRow.high.profitKobo === 2 * 5_263 - 100_000);
check("…split at the day the Terms went live", reviewRow.beforeTerms.bets === 2 && reviewRow.beforeTerms.profitKobo === 10_526 && reviewRow.afterTerms.bets === 1);
check("…reversed and refunded ones shown apart", reviewRow.highReversed === 1 && reviewRow.highRefunded === 1);
const reviewMarket = reviewRow.markets.find((m) => m.bets === 2)!;
check("each market shows its exact first and last bet time", reviewMarket.firstAt === new Date(beforeTerms).toISOString() && reviewMarket.lastAt === new Date(beforeTerms + 60_000).toISOString());
check("an unknown customer is a 404", (await admin("GET", "/v1/admin/traders/nobody/high-price-bets")).statusCode === 404);
check("…and it needs an admin", (await app.inject({ method: "GET", url: "/v1/admin/traders/u-review/high-price-bets" })).statusCode === 401);

/* ---------------- the Withdrawals tab ---------------- */
console.log("the Withdrawals tab");
const desk = (await admin("GET", "/v1/admin/withdrawals")).json() as {
  data: { people: { authUserId: string; betProfitKobo: number; verdict: string; requests: unknown[] }[] };
};
const fairRow = desk.data.people.find((x) => x.authUserId === "u-fair");
check("the route lists who's waiting, with what their bets made", fairRow?.requests.length === 2 && fairRow.verdict === "clear" && fairRow.betProfitKobo === 0);

/* ---------------- settling a held withdrawal ---------------- */
console.log("withdrawals");
const fairBefore = await getNairaBalanceKobo("u-fair");
const ret = await admin("POST", "/v1/admin/withdrawal-checks/resolve", { refKey: "convert:u-fair:out-9", action: "return" });
check(
  "returning one puts the credit back",
  ret.statusCode === 200 && (await getNairaBalanceKobo("u-fair")) === fairBefore + 300_000,
);
const twice = await admin("POST", "/v1/admin/withdrawal-checks/resolve", { refKey: "convert:u-fair:out-9", action: "return" });
check("…once only (ALREADY_SETTLED)", twice.statusCode === 409 && (await getNairaBalanceKobo("u-fair")) === fairBefore + 300_000);
// no wallet is configured here: asking again can't tell, so it stays held
const retry = await admin("POST", "/v1/admin/withdrawal-checks/resolve", { refKey: "convert:u-fair:out-8", action: "retry" });
check(
  "asking again with no wallet to ask keeps it held, credit untouched",
  (retry.json() as { data: { status: string } }).data.status === "unconfirmed" &&
    (await getNairaBalanceKobo("u-fair")) === fairBefore + 300_000,
);
const paid = await admin("POST", "/v1/admin/withdrawal-checks/resolve", { refKey: "convert:u-fair:out-8", action: "paid" });
check("marking one paid moves no money", paid.statusCode === 200 && (await getNairaBalanceKobo("u-fair")) === fairBefore + 300_000);

/* ---------------- a repeat goes harder; the week brings them back ---------------- */
console.log("repeats and the week's return");
const { lowerStakeLevelAutomatically, returnAutoStakeLevels } = await import("../src/accounts.js");
const DAY = 86_400_000;
const lvl = async (id: string) => (await User.findOne({ authUserId: id }).lean())?.stakeLevel;
for (const name of ["first", "repeat", "still", "old", "desk"]) {
  await User.create({ authUserId: `u-${name}`, email: `${name}@example.test`, username: name, displayName: name });
}
await lowerStakeLevelAutomatically({ authUserId: "u-first", level: "reduced", repeatLevel: "restricted", reason: "test", log });
check("a first flag puts them on reduced", (await lvl("u-first")) === "reduced");
// limited by the scan 10 days ago, and back on normal since
await User.updateOne(
  { authUserId: "u-repeat" },
  {
    $set: { stakeLevel: "normal", stakeLevelBy: "system:review", stakeLevelAt: new Date(Date.now() - 3 * DAY) },
    $push: {
      accountActions: {
        $each: [
          { action: "stake_level", reason: "Reduced: test", by: "system:abuse", at: new Date(Date.now() - 10 * DAY) },
          { action: "stake_level", reason: "Normal: back", by: "system:review", at: new Date(Date.now() - 3 * DAY) },
        ],
      },
    },
  },
);
await lowerStakeLevelAutomatically({ authUserId: "u-repeat", level: "reduced", repeatLevel: "restricted", reason: "test", log });
const repeatUser = await User.findOne({ authUserId: "u-repeat" }).lean();
check(
  "flagged again within 30 days of an earlier limit → restricted, saying so",
  repeatUser?.stakeLevel === "restricted" && Boolean(repeatUser.stakeLevelReason?.startsWith("Flagged again within 30 days")),
);
// limited 40 days ago: long enough ago that it's a first flag again
await User.updateOne(
  { authUserId: "u-old" },
  { $push: { accountActions: { action: "stake_level", reason: "Reduced: test", by: "system:abuse", at: new Date(Date.now() - 40 * DAY) } } },
);
await lowerStakeLevelAutomatically({ authUserId: "u-old", level: "reduced", repeatLevel: "restricted", reason: "test", log });
check("…but an earlier limit over 30 days ago doesn't count", (await lvl("u-old")) === "reduced");

// eight days on the scan's limit: u-first is no longer flagged, u-still is
for (const id of ["u-first", "u-still"]) {
  await User.updateOne(
    { authUserId: id },
    { $set: { stakeLevel: "reduced", stakeLevelBy: "system:abuse", stakeLevelAt: new Date(Date.now() - 8 * DAY) } },
  );
}
await AlertRecord.create({
  key: "abuse:near:u-still",
  kind: "abuse",
  subject: "Buying near-certain sides: @still",
  authUserIds: ["u-still"],
  firstAt: new Date(Date.now() - 8 * DAY),
  lastAt: new Date(),
  status: "open",
});
// the desk limited u-desk by hand 8 days ago
await User.updateOne(
  { authUserId: "u-desk" },
  { $set: { stakeLevel: "restricted", stakeLevelBy: "key:josh", stakeLevelAt: new Date(Date.now() - 8 * DAY) } },
);
const returned = await returnAutoStakeLevels(log);
const firstUser = await User.findOne({ authUserId: "u-first" }).lean();
check(
  `after 7 days, no longer flagged → back to normal on its own, on their history (${returned} back)`,
  firstUser?.stakeLevel === "normal" &&
    firstUser.stakeLevelBy === "system:review" &&
    (firstUser.accountActions ?? []).some((a) => a.reason === "Normal: 7 days on a limit, and no longer flagged"),
);
check("…someone still flagged stays where they are", (await lvl("u-still")) === "reduced");
check("…and a level the desk set by hand is never touched", (await lvl("u-desk")) === "restricted");
check("…nor one the scan set under 7 days ago", (await lvl("u-old")) === "reduced");

console.log(`\n${passed} passed, ${failed} failed`);
await app.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
