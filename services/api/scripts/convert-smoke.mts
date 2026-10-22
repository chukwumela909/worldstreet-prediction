/**
 * Credit ⇄ dollar conversions when the central wallet fails: the money is
 * put back when the wallet refuses, held (never put back on a guess) when
 * its answer is lost, and the same key can't be replayed into a false
 * "done" or a free credit; the desk settles held withdrawals — on an
 * in-memory database, with the wallet service answered by canned
 * responses instead of the network.
 *
 *   npx tsx scripts/convert-smoke.mts
 */
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk";
process.env.CLERK_SECRET_KEY = "sk_test_fake";
process.env.SETTLEMENT_POLL_SECONDS = "0";
process.env.WALLET_API_URL = "https://wallet.test";
process.env.RESEND_API_KEY = "re_test";
process.env.ALERT_EMAIL_FROM = "WorldStreet <alerts@worldstreetgold.test>";
process.env.WALLET_SERVICE_TOKEN = "test-token";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: "test" });

const { ApiError } = await import("../src/errors.js");
const { convertNaira } = await import("../src/routes/ngn-wallet.js");
const { creditNaira, getNairaBalanceKobo } = await import("../src/trading/ledger.js");
const { FxRate, LedgerEntry, WithdrawalCheck, ensureTradingIndexes } = await import("../src/trading/models.js");
const { resolveWithdrawalCheck } = await import("../src/trading/withdrawals.js");
const settings = await import("../src/trading/settings.js");
const { AlertRecord, User } = await import("../src/models.js");
await ensureTradingIndexes();
// the approval limit has its own section below; until then, withdrawals go straight out
await settings.updateBookSettings({ withdrawalReviewKobo: 0 }, "smoke");

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
    const res = (await fn()) as { data?: { alreadyProcessed?: boolean } };
    return res.data?.alreadyProcessed ? "alreadyProcessed" : "ok";
  } catch (err) {
    return err instanceof ApiError ? err.code : String((err as Error).message);
  }
}

const log = { info() {}, warn() {}, error() {} } as unknown as import("fastify").FastifyBaseLogger;

await FxRate.create({ usdToNgn: 1_450, setBy: "smoke" });
await creditNaira({
  authUserId: "u-cust",
  amountKobo: 7_951_146, // ₦79,511.46
  type: "conversion_in",
  refKey: "fund:u-cust",
  description: "test funds",
});

/* ---------------- canned wallet ---------------- */
let creditsFail = true;
/**
 * How the wallet treats a credit: "refuse" says no (403); "ok" pays;
 * "lose-answer" pays, then the reply never arrives (a network error);
 * "down" answers with a gateway page and pays nothing; "duplicate" says a
 * reference it already paid is a duplicate (409). It dedupes on the
 * reference: one reference is only ever paid once.
 */
let creditMode: "refuse" | "ok" | "lose-answer" | "down" | "duplicate" = "refuse";
const paidRefs = new Map<string, number>();
const calls = { credits: 0, charges: 0, refunds: 0 };
const mails: { to: string[]; subject: string; text: string }[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.hostname === "api.resend.com") {
    mails.push(JSON.parse(String(init?.body)));
    return json({ id: "email" });
  }
  if (url.pathname.endsWith("/credits")) {
    calls.credits += 1;
    const { reference, amountMinor } = JSON.parse(String(init?.body ?? "{}")) as { reference: string; amountMinor: number };
    const mode = creditsFail ? "refuse" : creditMode;
    if (mode === "refuse") return json({ ok: false, code: "FORBIDDEN", error: "credits are not enabled for this platform" }, 403);
    if (mode === "down") return new Response("<html>502 Bad Gateway</html>", { status: 502 });
    if (paidRefs.has(reference)) {
      return mode === "duplicate"
        ? json({ ok: false, code: "DUPLICATE_REFERENCE", error: "reference already used" }, 409)
        : json({ ok: true, credit: { id: `cr-${reference}` }, replayed: true });
    }
    paidRefs.set(reference, amountMinor);
    if (mode === "lose-answer") {
      creditMode = "ok";
      throw new TypeError("fetch failed: socket hang up");
    }
    return json({ ok: true, credit: { id: `cr-${reference}` } });
  }
  if (url.pathname.endsWith("/refund")) {
    calls.refunds += 1;
    return json({ ok: true });
  }
  if (url.pathname.endsWith("/charges")) {
    calls.charges += 1;
    // the wallet dedupes by key: a replay gets the same charge back
    return json({ ok: true, charge: { id: "ch-1", amountMinor: 1000, currency: "USD", description: "", createdAt: "" } });
  }
  return json({ ok: false, code: "NOT_FOUND", error: "not found" }, 404);
}) as typeof fetch;

/* ---------------- credit → dollars, wallet refusing ---------------- */
console.log("withdrawal the wallet refuses");
const withdraw = (key: string) =>
  outcomeOf(() =>
    convertNaira("u-cust", { direction: "ngn_to_usd", amountMinor: 4_500_000, idempotencyKey: key }, log),
  );

check("the refusal surfaces as WALLET_UNAVAILABLE", (await withdraw("withdraw-key-1")) === "WALLET_UNAVAILABLE");
check("…and the credit is returned in full", (await getNairaBalanceKobo("u-cust")) === 7_951_146);
check(
  "pressing again with the same key is refused, not reported as done",
  (await withdraw("withdraw-key-1")) === "CONVERSION_REVERSED",
);
check("…and still nothing moved", (await getNairaBalanceKobo("u-cust")) === 7_951_146);

creditsFail = false;
creditMode = "ok";
check("a fresh attempt goes through once the wallet accepts", (await withdraw("withdraw-key-2")) === "ok");
check("…taking the ₦45,000", (await getNairaBalanceKobo("u-cust")) === 7_951_146 - 4_500_000);
check("resending that one reports it done without charging again", (await withdraw("withdraw-key-2")) === "alreadyProcessed");
check("…balance unchanged", (await getNairaBalanceKobo("u-cust")) === 7_951_146 - 4_500_000);

/* ---------------- dollars → credit, naira side failing ---------------- */
console.log("funding whose naira credit fails");
const fund = (key: string) =>
  outcomeOf(() =>
    convertNaira("u-cust", { direction: "usd_to_ngn", amountMinor: 1_000, idempotencyKey: key }, log),
  );
const before = await getNairaBalanceKobo("u-cust");
const realCreate = LedgerEntry.create.bind(LedgerEntry);
let failNext = true;
(LedgerEntry as unknown as { create: typeof LedgerEntry.create }).create = (async (
  ...args: Parameters<typeof LedgerEntry.create>
) => {
  if (failNext) {
    failNext = false;
    throw new Error("simulated ledger failure");
  }
  return realCreate(...args);
}) as typeof LedgerEntry.create;

check("the failed credit surfaces as an error", (await fund("fund-key-1")) === "simulated ledger failure");
check("…and the dollar charge is refunded", calls.refunds === 1);
const replay = await fund("fund-key-1");
check(
  `replaying the key can't credit naira for refunded dollars (got ${replay})`,
  replay === "CONVERSION_REVERSED",
);
check("…no naira added", (await getNairaBalanceKobo("u-cust")) === before);

/* ---------------- a lost answer is never refunded on a guess ---------------- */
console.log("withdrawal whose answer is lost");
await creditNaira({ authUserId: "u-cust", amountKobo: 50_000_000, type: "conversion_in", refKey: "fund:more", description: "more test funds" });
const bal = () => getNairaBalanceKobo("u-cust");
const start = await bal();
creditMode = "lose-answer";
check("paid, but the reply never arrived: asking again confirms it", (await withdraw("withdraw-key-3")) === "ok");
check(
  "…the credit stays withdrawn and the dollars were paid exactly once",
  (await bal()) === start - 4_500_000 && paidRefs.size === 2 && !(await WithdrawalCheck.exists({})),
);

creditMode = "duplicate";
paidRefs.set("convert:u-cust:withdraw-key-4", 3_000);
// the wallet already paid this reference: its 409 means done, not "put it back"
const dupe = await withdraw("withdraw-key-4");
check(`a duplicate refusal reads as already paid (got ${dupe})`, dupe === "ok" && (await bal()) === start - 9_000_000);

creditMode = "down";
const beforeDown = await bal();
check("wallet down: the withdrawal is held, not refunded (WITHDRAWAL_UNCONFIRMED)", (await withdraw("withdraw-key-5")) === "WITHDRAWAL_UNCONFIRMED");
const held = await WithdrawalCheck.findOne({ refKey: "convert:u-cust:withdraw-key-5" }).lean();
check(
  "…the credit stays taken and the desk has it to confirm",
  (await bal()) === beforeDown - 4_500_000 && held?.status === "unconfirmed" && held.lastCode === "UNKNOWN",
);
check(
  "pressing again with that key reports it, without taking more",
  (await withdraw("withdraw-key-5")) === "alreadyProcessed" && (await bal()) === beforeDown - 4_500_000,
);

const retryDown = await resolveWithdrawalCheck({ refKey: "convert:u-cust:withdraw-key-5", action: "retry", actor: "key:josh", log });
check("the desk asks again while it's still down: it stays held", retryDown.status === "unconfirmed");
creditMode = "ok";
const creditsBefore = paidRefs.size;
const retryUp = await resolveWithdrawalCheck({ refKey: "convert:u-cust:withdraw-key-5", action: "retry", actor: "key:josh", log });
check(
  "…and once it's back, asking again pays it — once",
  retryUp.status === "paid" && paidRefs.size === creditsBefore + 1 && (await bal()) === beforeDown - 4_500_000,
);
const again = await resolveWithdrawalCheck({ refKey: "convert:u-cust:withdraw-key-5", action: "retry", actor: "key:josh", log }).catch(
  (err: unknown) => (err instanceof ApiError ? err.code : "error"),
);
check("a settled withdrawal can't be settled twice (ALREADY_SETTLED)", again === "ALREADY_SETTLED");

creditMode = "down";
const beforeReturn = await bal();
await withdraw("withdraw-key-6");
const returned = await resolveWithdrawalCheck({ refKey: "convert:u-cust:withdraw-key-6", action: "return", actor: "key:josh", log });
check(
  "the desk can return a held credit once it's sure the dollars never arrived",
  returned.status === "returned" && (await bal()) === beforeReturn,
);
check("…and that key can't be replayed into a payout", (await withdraw("withdraw-key-6")) === "CONVERSION_REVERSED");

creditMode = "down";
await withdraw("withdraw-key-7");
const markedPaid = await resolveWithdrawalCheck({ refKey: "convert:u-cust:withdraw-key-7", action: "paid", actor: "key:josh", log });
check("…or mark one paid after seeing the dollars arrived", markedPaid.status === "paid");

/* ---------------- big or flagged withdrawals wait for approval ---------------- */
console.log("withdrawals waiting for approval");
await settings.updateBookSettings({ withdrawalReviewKobo: 10_000_000 }, "smoke"); // ₦100,000 a day
creditMode = "ok";
await User.create({ authUserId: "u-rev", email: "rev@example.test", username: "rev", displayName: "rev" });
await creditNaira({ authUserId: "u-rev", amountKobo: 50_000_000, type: "conversion_in", refKey: "fund:u-rev", description: "funds" });
const revBal = () => getNairaBalanceKobo("u-rev");
const rev = (key: string, kobo: number) =>
  outcomeOf(() => convertNaira("u-rev", { direction: "ngn_to_usd", amountMinor: kobo, idempotencyKey: key }, log));
check("a withdrawal under the day's limit goes straight out", (await rev("rev-key-0001", 6_000_000)) === "ok");
const paidBefore = paidRefs.size;
check(
  "the one taking the day to ₦100,000 waits for approval (WITHDRAWAL_IN_REVIEW), nothing sent",
  (await rev("rev-key-0002", 4_000_000)) === "WITHDRAWAL_IN_REVIEW" && paidRefs.size === paidBefore,
);
const waitingOne = await WithdrawalCheck.findOne({ refKey: "convert:u-rev:rev-key-0002" }).lean();
check(
  "…its credit set aside, with the reason",
  waitingOne?.status === "review" && waitingOne.reason.includes("24 hours") && (await revBal()) === 50_000_000 - 10_000_000,
);
check("…and the admins have it on the Alerts tab", Boolean(await AlertRecord.exists({ key: "withdrawal-review:convert:u-rev:rev-key-0002" })));
const approved = await resolveWithdrawalCheck({ refKey: "convert:u-rev:rev-key-0002", action: "retry", actor: "key:josh", log });
check(
  "approving sends it, once, and emails the customer",
  approved.status === "paid" && paidRefs.has("convert:u-rev:rev-key-0002") && paidRefs.size === paidBefore + 1 &&
    mails.some((m) => m.to[0] === "rev@example.test" && m.subject === "Your withdrawal has been sent"),
);
check("splitting doesn't get round it: a small one the same day waits too", (await rev("rev-key-0003", 1_000_000)) === "WITHDRAWAL_IN_REVIEW");
const rejected = await resolveWithdrawalCheck({ refKey: "convert:u-rev:rev-key-0003", action: "return", actor: "key:josh", log });
check(
  "rejecting returns the credit and tells them",
  rejected.status === "returned" && (await revBal()) === 50_000_000 - 10_000_000 &&
    mails.some((m) => m.to[0] === "rev@example.test" && m.subject === "Your withdrawal wasn't approved"),
);

await User.create({ authUserId: "u-flag", email: "flag@example.test", username: "flag", displayName: "flag" });
await creditNaira({ authUserId: "u-flag", amountKobo: 1_000_000, type: "conversion_in", refKey: "fund:u-flag", description: "funds" });
const flagAlert = await AlertRecord.create({
  key: "abuse:near:u-flag",
  kind: "abuse",
  subject: "Buying near-certain sides: @flag",
  firstAt: new Date(),
  lastAt: new Date(),
  authUserIds: ["u-flag"],
});
const flagged = (key: string) =>
  outcomeOf(() => convertNaira("u-flag", { direction: "ngn_to_usd", amountMinor: 100_000, idempotencyKey: key }, log));
check("a flagged account's ₦1,000 withdrawal waits for approval", (await flagged("flag-key-0001")) === "WITHDRAWAL_IN_REVIEW");
check(
  "…saying why",
  (await WithdrawalCheck.findOne({ refKey: "convert:u-flag:flag-key-0001" }).lean())?.reason === "Flagged on Abuse watch",
);
await AlertRecord.updateOne({ _id: flagAlert._id }, { $set: { status: "resolved" } });
check("once the alert is settled, their withdrawals go straight out again", (await flagged("flag-key-0002")) === "ok");
await settings.updateBookSettings({ withdrawalReviewKobo: 0 }, "smoke");

console.log(`\n${passed} passed, ${failed} failed`);

await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
