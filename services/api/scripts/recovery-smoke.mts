/**
 * Recovery: reversing every settled bet on the 15-minute crypto markets
 * — winnings taken back, stakes returned, balances allowed below zero or
 * capped at what's there — through the real admin routes, plus the
 * report, its incidents, the customer email quoting the desk's reason,
 * and reversing one finished market by its slug. In-memory database, our
 * own markets, Resend answered by a canned reply.
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
const { getPausedRefunds } = await import("../src/trading/pause-refunds.js");
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
const REASON = "Prices on the 15-minute crypto markets were wrong because of a glitch, and it was being exploited.";

// one round still open — a reversal waits for its markets to be paused
const ada2 = await ownMarket("Cardano Up or Down - 15 minutes?");
await User.create({ authUserId: "u-open", email: "femi@example.test", username: "femi", displayName: "femi" });
await creditNaira({ authUserId: "u-open", amountKobo: 1_000_000, type: "conversion_in", refKey: "fund:u-open", description: "funds" });
await bet(ada2, "u-open", "up", 500_000, 5_000);

/* ---------------- preview ---------------- */
console.log("preview");
const pv = (await admin("POST", "/v1/admin/recovery/preview", { topics: TOPICS, sinceDays: null })).json() as {
  data: Record<string, unknown> & { events: { title: string }[] };
};
const p = pv.data as unknown as {
  bets: number; won: number; lost: number; customers: number; takeBackKobo: number; returnKobo: number;
  netKobo: number; shortCustomers: number; paused: boolean; openBets: number; events: { title: string }[];
};
check(`all-time preview finds the 4 round bets, not the other market (got ${p.bets})`, p.bets === 4 && p.won === 3 && p.lost === 1 && p.customers === 3);
check(
  "…with what comes back and what goes out",
  p.takeBackKobo === 3 * (payout - 5_000_000) && p.returnKobo === 3_000_000 && p.netKobo === p.takeBackKobo - p.returnKobo,
);
check("…who'd go below zero", p.shortCustomers === 1);
check("…which markets matched", p.events.length === 2 && !p.events.some((e) => e.title.includes("Friday")));
check("…that they aren't paused yet, with one bet still open", p.paused === false && p.openBets === 1);

const blocked = await admin("POST", "/v1/admin/recovery/run", { topics: TOPICS, sinceDays: null, shortfall: "negative", reason: REASON, confirm: "REVERSE" });
check("with bets open, running needs the markets paused first (NOT_PAUSED)", blocked.statusCode === 409 && (blocked.json() as { code: string }).code === "NOT_PAUSED");
const noConfirm = await admin("POST", "/v1/admin/recovery/run", { topics: TOPICS, sinceDays: null, shortfall: "negative", reason: REASON, confirm: "yes" });
check("…the typed REVERSE confirmation", noConfirm.statusCode === 400);
const noReason = await admin("POST", "/v1/admin/recovery/run", { topics: TOPICS, sinceDays: null, shortfall: "negative", confirm: "REVERSE" });
const shortReason = await admin("POST", "/v1/admin/recovery/run", { topics: TOPICS, sinceDays: null, shortfall: "negative", reason: "glitch", confirm: "REVERSE" });
check("…and a reason the customer can read", noReason.statusCode === 400 && shortReason.statusCode === 400);

/* ---------------- run ---------------- */
console.log("run");
// the ₦95 test market would also hit the price ceiling; this suite is about balances
await settings.updateBookSettings({ pausedTopics: [...TOPICS], maxQuoteKobo: 0 }, "smoke");
const run = (await admin("POST", "/v1/admin/recovery/run", { topics: TOPICS, sinceDays: null, shortfall: "negative", reason: REASON, confirm: "REVERSE" })).json() as {
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
check("…each bet keeping the reason", (await Position.countDocuments({ reversalReason: REASON })) === 4);
check("the open bet isn't reversed", (await Position.countDocuments({ authUserId: "u-open", status: "open" })) === 1);

const again = (await admin("POST", "/v1/admin/recovery/run", { topics: TOPICS, sinceDays: null, shortfall: "negative", reason: REASON, confirm: "REVERSE" })).json() as {
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
    const fresh = await ownMarket("Will it rain in Abuja tomorrow?");
    await placeOrder("u-spent", { eventId: fresh.eventId, marketId: fresh.marketId, outcomeId: fresh.down, stakeKobo: 10_000, expectedPriceKobo: 1_000, idempotencyKey: "after-key-1" }, log);
    return "ok";
  } catch (err) {
    return err instanceof ApiError ? err.code : "error";
  }
})();
check(`a negative balance can't bet (got ${negativeBet})`, negativeBet === "INSUFFICIENT_FUNDS");

/* ---------------- the Recovery report ---------------- */
console.log("report");
// ada's two read as the first reversals did, before reasons were kept
await Position.updateMany({ authUserId: "u-win" }, { $unset: { reversalReason: 1 } });
const rep = (await admin("GET", "/v1/admin/recovery")).json() as {
  data: {
    totals: Record<string, number>;
    incidents: { reason: string; bets: number; customers: number; netKobo: number; untoldBets: number }[];
    customers: { username: string; balanceKobo: number; emailedAt: string | null }[];
  };
};
const inc = rep.data.incidents;
const withReason = inc.find((i) => i.reason === REASON);
const unrecorded = inc.find((i) => i.reason === "");
check(
  `incidents: one per reason, each with its own bets and people (got ${inc.length})`,
  inc.length === 2 && withReason?.bets === 2 && withReason.customers === 2 && unrecorded?.bets === 2 &&
    unrecorded.customers === 1 && unrecorded.netKobo === 2 * (payout - 5_000_000) && withReason.untoldBets === 2,
);
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
const toAda = sent.find((m) => m.to[0] === "ada@example.test");
check("sending emails each of them once", real.data.emailed === 3 && sent.length === 3);
check(
  "…quoting the desk's reason, with what changed",
  Boolean(
    toKemi?.text.includes(`Why: ${REASON}`) && toKemi.text.includes("Ethereum Up or Down") &&
      toKemi.text.includes("below zero") && toKemi.subject === "Important: some of your bets have been reversed",
  ),
);
check(
  "…and the first reversals keep their own email",
  Boolean(toAda?.text.includes("glitch in our system") && toAda.subject.includes("15-minute crypto") && !toAda.text.includes("Why:")),
);
check("…and nobody twice", ((await admin("POST", "/v1/admin/recovery/notify", { dryRun: false })).json() as { data: { emailed: number } }).data.emailed === 0);
check(
  "the report shows them emailed",
  ((await admin("GET", "/v1/admin/recovery")).json() as { data: { totals: { emailed: number } } }).data.totals.emailed === 3,
);

/* ---------------- the refund email mix-up ---------------- */
console.log("refund email mix-up");
const refundReport = await getPausedRefunds(TOPICS, 72);
check(
  `the paused-markets refund report leaves reversed bets out (got ${refundReport.totals.bets})`,
  refundReport.totals.bets === 0 && refundReport.totals.notEmailed === 0,
);
const gone = await admin("POST", "/v1/admin/notify-paused-refunds", { dryRun: true });
check("…and the desk button that emailed them is gone (404)", gone.statusCode === 404);
// before that fix, kemi and tunde were told their reversed bets were refunded
await Position.updateMany(
  { authUserId: { $in: ["u-spent", "u-lose"] }, reversedFrom: { $exists: true } },
  { $set: { refundNotifiedAt: new Date() } },
);
const corrDry = (await admin("POST", "/v1/admin/recovery/correct-refund-email", { dryRun: true })).json() as {
  data: { customers: number; owing: number };
};
check("the correction finds the two told wrongly, one still below zero", corrDry.data.customers === 2 && corrDry.data.owing === 1);
const corrBlocked = await admin("POST", "/v1/admin/recovery/correct-refund-email", { dryRun: false });
check(
  "…and won't send while someone still owes (DEBTS_NOT_CLEARED)",
  corrBlocked.statusCode === 409 && (corrBlocked.json() as { code: string }).code === "DEBTS_NOT_CLEARED",
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

/* ---------------- the correction, once debts are cleared ---------------- */
console.log("correction");
sent.length = 0;
const corr = (await admin("POST", "/v1/admin/recovery/correct-refund-email", { dryRun: false })).json() as {
  data: { emailed: number };
};
const kemiFix = sent.find((m) => m.to[0] === "kemi@example.test");
const tundeFix = sent.find((m) => m.to[0] === "tunde@example.test");
const owedNaira = `₦${(owedBefore / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
check("the correction goes to both", corr.data.emailed === 2 && sent.length === 2);
check(
  "…kemi's apologises and says what she owed is waived",
  Boolean(
    kemiFix?.subject.startsWith("Correction") && kemiFix.text.includes("sent by mistake") &&
      kemiFix.text.includes(`the ${owedNaira} you owed has been cleared`) && kemiFix.text.includes("Your balance now: ₦0.00"),
  ),
);
check(
  "…saying when the wrong email went, in Lagos time",
  /^On \d{1,2} [A-Z][a-z]+ at \d{1,2}:\d{2} (AM|PM), we sent you an email titled "Your bet has been refunded"/m.test(kemiFix?.text ?? ""),
);
check("…tunde's, who never owed, doesn't mention a debt", Boolean(tundeFix?.text.includes("sent by mistake") && !tundeFix.text.includes("waived")));
check(
  "…and nobody gets it twice",
  ((await admin("POST", "/v1/admin/recovery/correct-refund-email", { dryRun: false })).json() as { data: { emailed: number } }).data
    .emailed === 0,
);
const fixState = ((await admin("GET", "/v1/admin/recovery")).json() as { data: { refundCorrection: { waiting: number; corrected: number } } })
  .data.refundCorrection;
check("the report shows them corrected", fixState.waiting === 0 && fixState.corrected === 2);

/* ---------------- capped: take only what's there ---------------- */
console.log("cap");
await User.create({ authUserId: "u-cap", email: "chidi@example.test", username: "chidi", displayName: "chidi" });
await creditNaira({ authUserId: "u-cap", amountKobo: 5_000_000, type: "conversion_in", refKey: "fund:u-cap", description: "funds" });
const sol = await ownMarket("Solana Up or Down - 15 minutes?");
await bet(sol, "u-cap", "up", 5_000_000, 9_500);
await adminSettleMarket({ eventId: sol.eventId, marketId: sol.marketId, winningOutcomeId: sol.up, actor: "auto", log });
await debitNaira({ authUserId: "u-cap", amountKobo: 5_000_000, type: "trade_stake", refKey: "cap-spent", description: "spent" });
const capBefore = await bal("u-cap"); // payout − 5,000,000 = 263,157 left
const capRun = (await admin("POST", "/v1/admin/recovery/run", { topics: TOPICS, sinceDays: null, shortfall: "cap", reason: REASON, confirm: "REVERSE" })).json() as {
  data: { reversed: number; writtenOffKobo: number };
};
check(
  `capped: takes the ₦${capBefore / 100} that's there, stops at zero, writes off the rest`,
  capRun.data.reversed === 1 && (await bal("u-cap")) === 0 && capRun.data.writtenOffKobo === payout - 5_000_000 - capBefore,
);

/* ---------------- any market, by its link ---------------- */
console.log("one market by its slug");
const tv = await ownMarket("Channels TV number of X posts today - 60 or more?");
const tvSlug = tv.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
await bet(tv, "u-other", "up", 1_000_000, 9_500);
await adminSettleMarket({ eventId: tv.eventId, marketId: tv.marketId, winningOutcomeId: tv.up, actor: "auto", log });
const TV_REASON = "The post count was public before the market closed, so the result was already known.";
const tvPreview = (await admin("POST", "/v1/admin/recovery/preview", { topics: [tvSlug], sinceDays: null })).json() as {
  data: { bets: number; paused: boolean; openBets: number; events: { title: string }[] };
};
check(
  "its slug finds that one market, unpaused, nothing open",
  tvPreview.data.bets === 1 && !tvPreview.data.paused && tvPreview.data.openBets === 0 && tvPreview.data.events.length === 1,
);
const bolaBeforeTv = await bal("u-other");
const tvRun = (await admin("POST", "/v1/admin/recovery/run", { topics: [tvSlug], sinceDays: null, shortfall: "negative", reason: TV_REASON, confirm: "REVERSE" })).json() as {
  data: { reversed: number };
};
check(
  "a finished market reverses without pausing",
  tvRun.data.reversed === 1 && (await bal("u-other")) === bolaBeforeTv - (Math.floor((1_000_000 / 9_500) * 10_000) - 1_000_000),
);
check(
  "…and leaves bola's other market alone",
  (await Position.countDocuments({ authUserId: "u-other", status: "won" })) === 1,
);
sent.length = 0;
await admin("POST", "/v1/admin/recovery/notify", { dryRun: false });
// chidi (the capped run) is told in the same send
const toBola = sent.filter((m) => m.to[0] === "bola@example.test");
check(
  "bola's email gives that market's reason",
  toBola.length === 1 && toBola[0]!.text.includes(`Why: ${TV_REASON}`) && toBola[0]!.text.includes("Market: Channels TV") &&
    sent.length === 2,
);
const incidents = ((await admin("GET", "/v1/admin/recovery")).json() as { data: { incidents: { reason: string }[] } }).data.incidents;
check("the report now has three incidents, newest first", incidents.length === 3 && incidents[0]!.reason === TV_REASON);

console.log(`\n${passed} passed, ${failed} failed`);

await app.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
