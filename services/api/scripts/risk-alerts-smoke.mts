/**
 * Profit/loss on finished markets and the admin risk alerts, on an
 * in-memory database. No email or webhook is configured, so "sent" is
 * read off the alert throttle (AlertState), which records every
 * condition the API decided to alert on.
 *
 *   npx tsx scripts/risk-alerts-smoke.mts
 */
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_fake";
process.env.CLERK_SECRET_KEY = "sk_test_fake";
process.env.ALERT_REPEAT_HOURS = "6";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: "test" });

const { Position, ensureTradingIndexes } = await import("../src/trading/models.js");
const { AlertRecord, AlertState } = await import("../src/models.js");
const { listAlerts, resolveAlert, sendAlert } = await import("../src/alerts.js");
const settings = await import("../src/trading/settings.js");
const { getProfitAndLoss } = await import("../src/trading/pnl.js");
const { checkRiskAlerts } = await import("../src/trading/risk-alerts.js");

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

const warned: string[] = [];
const log = {
  warn: (obj: { alert?: string }) => {
    if (obj?.alert) warned.push(obj.alert);
  },
  info() {},
  error() {},
  debug() {},
} as never;

let n = 0;
async function position(p: {
  eventId: string;
  marketId: string;
  stakeKobo: number;
  priceKobo: number;
  status: "open" | "won" | "lost" | "voided";
  settledDaysAgo?: number;
}) {
  n += 1;
  const shares = p.stakeKobo / p.priceKobo;
  await Position.create({
    authUserId: `user_${n}`,
    eventId: p.eventId,
    marketId: p.marketId,
    outcomeId: `${p.marketId}-yes`,
    outcomeLabel: "Yes",
    eventSlug: `ev-${p.eventId}`,
    eventTitle: `Event ${p.eventId}`,
    marketTitle: `Market ${p.marketId}`,
    stakeKobo: p.stakeKobo,
    priceKobo: p.priceKobo,
    shares,
    potentialPayoutKobo: Math.floor(shares * 10_000),
    status: p.status,
    ...(p.settledDaysAgo !== undefined
      ? { settledAt: new Date(Date.now() - p.settledDaysAgo * 86_400_000) }
      : {}),
    idempotencyKey: `user_${n}:k${n}`,
  });
}

const LOCAL = "3f2b1c4e-9a7d-4e2b-8c1a-0b5d6e7f8a90";
const INTL = "5187252";

/* ---------------- profit / loss ---------------- */
console.log("profit / loss");
// local, this week: a ₦60 win (pays ₦100 on ₦60 staked) and a ₦40 loss
await position({ eventId: LOCAL, marketId: "l1", stakeKobo: 6_000, priceKobo: 6_000, status: "won", settledDaysAgo: 1 });
await position({ eventId: LOCAL, marketId: "l1", stakeKobo: 4_000, priceKobo: 4_000, status: "lost", settledDaysAgo: 1 });
// local, refunded — moves nothing
await position({ eventId: LOCAL, marketId: "l2", stakeKobo: 5_000, priceKobo: 5_000, status: "voided", settledDaysAgo: 2 });
// international, 40 days ago: a ₦30 loss for the user
await position({ eventId: INTL, marketId: "i1", stakeKobo: 3_000, priceKobo: 3_000, status: "lost", settledDaysAgo: 40 });
// still open — not in profit/loss at all
await position({ eventId: LOCAL, marketId: "l3", stakeKobo: 9_999, priceKobo: 5_000, status: "open" });

const pnl = await getProfitAndLoss();
check(
  "all time: stakes in, payouts out, refunds aside",
  pnl.allTime.stakesKobo === 13_000 && pnl.allTime.payoutsKobo === 10_000 && pnl.allTime.refundsKobo === 5_000,
);
check("all time profit = stakes − payouts (₦30)", pnl.allTime.profitKobo === 3_000);
check(
  "split by book",
  pnl.allTime.local.profitKobo === 0 && pnl.allTime.international.profitKobo === 3_000,
);
check(
  "last 7 days leaves out the 40-day-old market",
  pnl.last7Days.profitKobo === 0 && pnl.last7Days.positions === 3 && pnl.last7Days.markets === 2,
);
check("open bets aren't counted", pnl.allTime.positions === 4);

/* ---------------- risk alerts ---------------- */
console.log("risk alerts");
await Position.deleteMany({});
await settings.updateBookSettings(
  { maxMarketExposureKobo: 100_000, lossAlertKobo: 100_000 },
  "admin@worldstreet.test",
);
// pays ₦1,000 on ₦100 staked → ₦900 of the ₦1,000 cap (critical)
await position({ eventId: LOCAL, marketId: "m-critical", stakeKobo: 10_000, priceKobo: 1_000, status: "open" });
// ₦700 of ₦1,000 (watch)
await position({ eventId: LOCAL, marketId: "m-watch", stakeKobo: 30_000, priceKobo: 3_000, status: "open" });
// ₦500 (calm)
await position({ eventId: LOCAL, marketId: "m-calm", stakeKobo: 50_000, priceKobo: 5_000, status: "open" });

const raised = await checkRiskAlerts(log);
const keys = (await AlertState.find().lean()).map((a) => a.key).sort();
check("three alerts raised (critical, watch, whole book)", raised === 3);
check(
  "one condition each",
  JSON.stringify(keys) ===
    JSON.stringify(["risk:book-worst", "risk:limit:critical:m-critical", "risk:limit:watch:m-watch"]),
);
check(
  "subjects say what's wrong",
  warned.includes("Market at its loss limit") &&
    warned.includes("Market nearing its loss limit") &&
    warned.includes("The book's possible loss has passed the alert line"),
);
check("the half-used market stays quiet", !keys.some((k) => k.includes("m-calm")));

await checkRiskAlerts(log);
const again = await AlertState.find().lean();
check(
  "a repeat check is throttled, not re-sent",
  again.length === 3 && again.every((a) => a.suppressedCount === 1),
);

/* ---------------- the desk's record ---------------- */
console.log("alert records");
const records = await AlertRecord.find().lean();
const critical = records.find((r) => r.key === "risk:limit:critical:m-critical");
const book = records.find((r) => r.key === "risk:book-worst");
check(
  "every firing is kept on its condition's row, emailed or not (3 rows, seen twice each)",
  records.length === 3 && records.every((r) => r.count === 2 && r.kind === "risk" && r.status === "open"),
);
check(
  "a market alert knows its market, so the desk can act on it",
  critical?.marketId === "m-critical" && critical.eventId === LOCAL,
);
check("the whole-book alert points at the market carrying the most downside", book?.marketId === "m-critical");

const listed = await listAlerts("open");
check(
  "the list shows them open and still happening",
  listed.counts.open === 3 && listed.alerts.every((a) => a.active),
);
await resolveAlert(String(critical!._id), "key:josh", "Repriced it");
const afterResolve = await listAlerts("open");
check("settling one takes it off the open list", afterResolve.counts.open === 2 && afterResolve.counts.resolved === 1);
const twice = await resolveAlert(String(critical!._id), "key:josh", "").catch((err: { code?: string }) => err.code);
check("…and it can't be settled twice (ALREADY_SETTLED)", twice === "ALREADY_SETTLED");
await checkRiskAlerts(log);
const back = await AlertRecord.findOne({ key: "risk:limit:critical:m-critical" }).lean();
check(
  "if the condition fires again it opens back up, keeping who settled it",
  back?.status === "open" && back.count === 3 && back.resolvedBy === "key:josh" && back.note === "Repriced it",
);

await sendAlert(log, "New support request WS-TEST01: hi", {}, { kind: "support" });
await sendAlert(log, "Test alert", {}, { kind: "test" });
await sendAlert(log, "Test alert", {}, { kind: "test" });
const kinds = (await AlertRecord.find().lean()).map((r) => r.kind);
check(
  "support requests aren't kept here (the inbox is their record); one-off alerts get a row each",
  !kinds.includes("support" as never) && kinds.filter((k) => k === "test").length === 2,
);

await AlertState.deleteMany({});
await settings.updateBookSettings({ lossAlertKobo: 0 }, "admin@worldstreet.test");
await checkRiskAlerts(log);
const offKeys = (await AlertState.find().lean()).map((a) => a.key);
check(
  "Book loss alert at ₦0 turns the whole-book alert off (market alerts still run)",
  !offKeys.includes("risk:book-worst") && offKeys.length === 2,
);

console.log(`\n${passed} passed, ${failed} failed`);

await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
