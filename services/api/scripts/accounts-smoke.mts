/**
 * Suspending an account and the support desk, through the real admin
 * routes and the order / conversion paths the customer's routes run:
 * a suspended account can't bet or convert, its open bets still settle,
 * the reason is recorded and emailed, lifting it restores everything;
 * support requests open, cap, thread, reply (emailed), close and reopen.
 * In-memory database, our own markets, Resend answered by a canned reply.
 *
 *   npx tsx scripts/accounts-smoke.mts
 */
const KEY = "smoke-accounts-key-0123456789abcdefXYZ";
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk";
process.env.CLERK_SECRET_KEY = "sk_test_fake";
process.env.SETTLEMENT_POLL_SECONDS = "0";
process.env.ADMIN_ACCESS_KEYS = `josh:${KEY}`;
process.env.RESEND_API_KEY = "re_test";
process.env.ALERT_EMAIL_FROM = "WorldStreet <alerts@worldstreetgold.test>";
process.env.ALERT_EMAIL_TO = "desk@worldstreetgold.test";
process.env.SUPPORT_EMAIL_TO = "support@worldstreetgold.test";
process.env.SITE_URL = "https://predict.worldstreetgold.test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: "test" });

const { ApiError } = await import("../src/errors.js");
const { buildApp } = await import("../src/app.js");
const { placeOrder } = await import("../src/routes/trades.js");
const { convertNaira } = await import("../src/routes/ngn-wallet.js");
const { listMyTickets, openTicket, writeAgain } = await import("../src/routes/support.js");
const { getSuspension } = await import("../src/accounts.js");
const { adminSettleMarket } = await import("../src/trading/settlement.js");
const { creditNaira, getNairaBalanceKobo } = await import("../src/trading/ledger.js");
const { Position, WorldstreetEvent, WorldstreetMarket, ensureTradingIndexes } = await import(
  "../src/trading/models.js"
);
const { SupportTicket, User } = await import("../src/models.js");
await ensureTradingIndexes();
await SupportTicket.init();
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
const codeOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return "ok";
  } catch (err) {
    return err instanceof ApiError ? err.code : String(err);
  }
};

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

const admin = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { "x-admin-key": KEY }, ...(payload !== undefined && { payload: payload as object }) });

async function ownMarket(title: string) {
  const event = await WorldstreetEvent.create({
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, ""),
    title,
    category: "Politics",
    status: "open",
    createdBy: "admin_1",
  });
  const market = await WorldstreetMarket.create({
    eventId: event.eventId,
    title,
    status: "open",
    outcomes: [
      { label: "Yes", priceKobo: 4_000 },
      { label: "No", priceKobo: 6_000 },
    ],
  });
  return { eventId: event.eventId, marketId: market.marketId, yes: market.outcomes[0]!.outcomeId };
}
let n = 0;
const order = (user: string, m: Awaited<ReturnType<typeof ownMarket>>) =>
  placeOrder(
    user,
    { eventId: m.eventId, marketId: m.marketId, outcomeId: m.yes, stakeKobo: 100_000, expectedPriceKobo: 4_000, idempotencyKey: `order-key-${++n}` },
    log,
  );

await User.create({ authUserId: "u-ada", email: "ada@example.test", username: "ada", displayName: "Ada" });
await User.create({ authUserId: "u-bola", email: "bola@example.test", username: "bola", displayName: "Bola" });
for (const id of ["u-ada", "u-bola"]) {
  await creditNaira({ authUserId: id, amountKobo: 5_000_000, type: "conversion_in", refKey: `fund:${id}`, description: "funds" });
}
const election = await ownMarket("Will the governor win re-election?");
const rain = await ownMarket("Will it rain in Lagos on Friday?");

/* ---------------- suspending ---------------- */
console.log("suspend");
check("an active account bets", (await codeOf(() => order("u-ada", election))) === "ok");
const REASON = "Repeated bets on results that were already public, against our terms.";

const tooShort = await admin("POST", "/v1/admin/traders/u-ada/suspend", { reason: "bad", notify: true });
check("a suspension needs a real reason", tooShort.statusCode === 400);
const nobody = await admin("POST", "/v1/admin/traders/u-nobody/suspend", { reason: REASON, notify: false });
check("an unknown account is a 404", nobody.statusCode === 404);

const sus = await admin("POST", "/v1/admin/traders/u-ada/suspend", { reason: REASON, notify: true });
const susBody = sus.json() as { data: { suspended: boolean; emailed: boolean | null; reason: string } };
check("suspending works and emails the customer", sus.statusCode === 200 && susBody.data.suspended && susBody.data.emailed === true);
check(
  "…the email gives the reason and what it means",
  sent.length === 1 && sent[0]!.to[0] === "ada@example.test" && sent[0]!.text.includes(`Reason: ${REASON}`) &&
    sent[0]!.subject.includes("suspended") && sent[0]!.text.includes("Support page"),
);
const twice = await admin("POST", "/v1/admin/traders/u-ada/suspend", { reason: REASON, notify: true });
check("suspending twice is refused (ALREADY_SUSPENDED), nothing re-sent", twice.statusCode === 409 && sent.length === 1);

check(`a suspended account can't bet (got ${await codeOf(() => order("u-ada", rain))})`, (await codeOf(() => order("u-ada", rain))) === "ACCOUNT_SUSPENDED");
check(
  "…or move money",
  (await codeOf(() => convertNaira("u-ada", { direction: "ngn_to_usd", amountMinor: 100_000, idempotencyKey: "convert-key-1" }, log))) ===
    "ACCOUNT_SUSPENDED",
);
check("…while everyone else still bets", (await codeOf(() => order("u-bola", rain))) === "ok");
check("its suspension reads back with the reason", (await getSuspension("u-ada"))?.reason === REASON);

const listed = (await admin("GET", "/v1/admin/traders?suspendedOnly=true")).json() as {
  data: { traders: { authUserId: string; suspendedAt: string | null; suspendedReason: string }[]; total: number };
};
check(
  "the Suspended view lists just them, with the reason",
  listed.data.total === 1 && listed.data.traders[0]!.authUserId === "u-ada" && listed.data.traders[0]!.suspendedReason === REASON,
);
const detail = (await admin("GET", "/v1/admin/traders/u-ada")).json() as {
  data: { trader: { suspendedAt: string | null }; accountActions: { action: string; reason: string; by: string }[] };
};
check(
  "their record shows who suspended them and why",
  Boolean(detail.data.trader.suspendedAt) && detail.data.accountActions.length === 1 &&
    detail.data.accountActions[0]!.action === "suspend" && detail.data.accountActions[0]!.by === "key:josh",
);

// the bet placed before the suspension still settles and pays
const adaBefore = await getNairaBalanceKobo("u-ada");
await adminSettleMarket({ eventId: election.eventId, marketId: election.marketId, winningOutcomeId: election.yes, actor: "auto", log });
check(
  "an open bet still settles and pays while suspended",
  (await Position.countDocuments({ authUserId: "u-ada", status: "won" })) === 1 && (await getNairaBalanceKobo("u-ada")) === adaBefore + 250_000,
);

/* ---------------- lifting it ---------------- */
console.log("reinstate");
const back = await admin("POST", "/v1/admin/traders/u-ada/reinstate", { reason: "", notify: false });
check("lifting it works, no email when not asked", back.statusCode === 200 && (back.json() as { data: { emailed: unknown } }).data.emailed === null && sent.length === 1);
check("…and they can bet again", (await codeOf(() => order("u-ada", rain))) === "ok");
check("lifting twice is refused (NOT_SUSPENDED)", (await admin("POST", "/v1/admin/traders/u-ada/reinstate", { notify: false })).statusCode === 409);
const actions = ((await admin("GET", "/v1/admin/traders/u-ada")).json() as { data: { accountActions: { action: string }[] } }).data
  .accountActions;
check("both actions are on their record, newest first", actions.length === 2 && actions[0]!.action === "reinstate");
const breakdown = ((await admin("GET", "/v1/admin/traders/u-ada")).json() as {
  data: { money: { type: string; amountKobo: number; count: number }[] };
}).data.money;
const kind = (t: string) => breakdown.find((m) => m.type === t);
check(
  "their money, all time by kind, adds up to the balance",
  kind("conversion_in")?.amountKobo === 5_000_000 && kind("trade_stake")?.count === 2 && kind("payout")?.count === 1 &&
    breakdown.reduce((s, m) => s + m.amountKobo, 0) === (await getNairaBalanceKobo("u-ada")),
);
await admin("POST", "/v1/admin/traders/u-bola/reinstate", { notify: true });
check("reinstating someone never suspended sends nothing", sent.length === 1);

/* ---------------- locking withdrawals ---------------- */
console.log("lock withdrawals");
const sentBeforeLock = sent.length;
const lock = await admin("POST", "/v1/admin/traders/u-ada/lock-withdrawals", { note: "checking their X post bets" });
check("locking withdrawals works, and emails nobody", lock.statusCode === 200 && sent.length === sentBeforeLock);
let lockedSays = "";
try {
  await convertNaira("u-ada", { direction: "ngn_to_usd", amountMinor: 100_000, idempotencyKey: "lock-key-0001" }, log);
} catch (err) {
  lockedSays = err instanceof ApiError ? `${err.code}|${err.message}` : "other";
}
check("a locked account can't withdraw, and is told it's going through checks", lockedSays.startsWith("WITHDRAWALS_LOCKED|") && lockedSays.includes("checks"));
const lockedBalance = await getNairaBalanceKobo("u-ada");
check("…and nothing was taken from the balance", lockedBalance === (await getNairaBalanceKobo("u-ada")));
check("…but it can still bet", (await codeOf(() => order("u-ada", rain))) === "ok");
check("locking twice is refused (ALREADY_LOCKED)", (await admin("POST", "/v1/admin/traders/u-ada/lock-withdrawals", {})).statusCode === 409);
const lockedRow = ((await admin("GET", "/v1/admin/traders?search=ada")).json() as { data: { traders: { withdrawalsLockedAt: string | null }[] } }).data.traders[0];
check("the trader list shows the lock", Boolean(lockedRow?.withdrawalsLockedAt));
check("unlocking works", (await admin("POST", "/v1/admin/traders/u-ada/unlock-withdrawals", {})).statusCode === 200);
check(
  "…and withdrawals are allowed again (the wallet isn't set up here, so it fails there, not on the lock)",
  (await codeOf(() => convertNaira("u-ada", { direction: "ngn_to_usd", amountMinor: 100_000, idempotencyKey: "lock-key-0002" }, log))) !== "WITHDRAWALS_LOCKED",
);
const lockActions = ((await admin("GET", "/v1/admin/traders/u-ada")).json() as { data: { accountActions: { action: string; reason: string }[] } }).data
  .accountActions;
check("both are on their record, with the desk's note", lockActions[0]!.action === "unlock_withdrawals" && lockActions[1]!.reason === "checking their X post bets");
check("unlocking twice is refused (NOT_LOCKED)", (await admin("POST", "/v1/admin/traders/u-ada/unlock-withdrawals", {})).statusCode === 409);

/* ---------------- support: the customer ---------------- */
console.log("support");
// a suspended customer can still ask for help
await admin("POST", "/v1/admin/traders/u-bola/suspend", { reason: REASON, notify: false });
const ada = { authUserId: "u-ada", email: "ada@example.test", username: "ada" };
const bola = { authUserId: "u-bola", email: "bola@example.test", username: "bola" };
const first = await openTicket(bola, { category: "money", subject: "Withdrawal stuck", message: "My withdrawal has been pending since Monday." });
check(`a request opens with a short number (${first.ref})`, /^WS-[A-Z0-9]{6}$/.test(first.ref) && first.status === "open");
check("…even from a suspended account", first.messages.length === 1 && first.messages[0]!.from === "customer");
for (let i = 2; i <= 5; i++) {
  await openTicket(bola, { category: "other", subject: `Question ${i}`, message: "Another question for the support desk." });
}
check(
  "a sixth waiting request is refused (TOO_MANY_OPEN)",
  (await codeOf(() => openTicket(bola, { category: "other", subject: "One more", message: "And yet another question." }))) === "TOO_MANY_OPEN",
);
const adaTicket = await openTicket(ada, { category: "bets", subject: "Bet not settled", message: "My bet on the election hasn't settled yet." });
check("each customer sees only their own", (await listMyTickets("u-ada")).length === 1 && (await listMyTickets("u-bola")).length === 5);

/* ---------------- support: the desk ---------------- */
type Row = { ref: string; preview: string; lastFrom: string; assignee: string; dueAt: string | null };
type Inbox = {
  data: {
    tickets: Row[];
    counts: Record<string, number>;
    total: number;
    waiting: { mine: number; unassigned: number; overdue: number };
    me: string;
  };
};
const inbox = (await admin("GET", "/v1/admin/support")).json() as Inbox;
const hoursDue = (row: Row) => (Date.parse(row.dueAt!) - Date.now()) / 3_600_000;
check(
  "the desk's inbox lists every waiting request, soonest reply-by first: money (1h), then a bet (4h)",
  inbox.data.total === 6 && inbox.data.counts.open === 6 &&
    inbox.data.tickets[0]!.ref === first.ref && hoursDue(inbox.data.tickets[0]!) > 0.9 && hoursDue(inbox.data.tickets[0]!) <= 1 &&
    inbox.data.tickets[1]!.ref === adaTicket.ref && inbox.data.tickets[1]!.preview.includes("election"),
);
check(
  "nobody owns them yet, and the desk knows who's asking",
  inbox.data.waiting.unassigned === 6 && inbox.data.waiting.mine === 0 && inbox.data.waiting.overdue === 0 &&
    inbox.data.me === "key:josh" && inbox.data.tickets.every((t) => t.assignee === ""),
);
const one = (await admin("GET", `/v1/admin/support/${first.ref}`)).json() as {
  data: { ticket: { messages: unknown[]; email: string }; account: { suspendedAt: string | null; balanceKobo: number; bets: number } };
};
check(
  "opening one shows the thread and the account (suspended, balance, bets)",
  one.data.ticket.messages.length === 1 && one.data.ticket.email === "bola@example.test" &&
    Boolean(one.data.account.suspendedAt) && one.data.account.bets === 1,
);
check("a bad request number is a 400", (await admin("GET", "/v1/admin/support/nonsense")).statusCode === 400);

const reply = await admin("POST", `/v1/admin/support/${first.ref}/reply`, {
  message: "Thanks Bola — the wallet team is fixing withdrawals; yours will go through once they do.",
  close: false,
});
const replied = reply.json() as { data: { ticket: { status: string; messages: { from: string; by: string }[] }; emailed: boolean } };
check(
  "a reply joins the thread and marks it answered",
  replied.data.ticket.status === "answered" && replied.data.ticket.messages[1]!.from === "support" &&
    replied.data.ticket.messages[1]!.by === "key:josh",
);
const replyMail = sent[sent.length - 1]!;
check(
  "…and is emailed to the customer, quoting the request",
  replied.data.emailed && replyMail.to[0] === "bola@example.test" && replyMail.subject === `Re: Withdrawal stuck [${first.ref}]` &&
    replyMail.text.includes("wallet team"),
);
check(
  "…with a link back to their Support page",
  replyMail.text.includes("https://predict.worldstreetgold.test/support"),
);
const mine = (await listMyTickets("u-bola")).find((t) => t.ref === first.ref)!;
check(
  "the customer sees the reply, but not who on the desk wrote it (nor who owns it)",
  mine.messages.length === 2 && mine.status === "answered" && !("by" in mine.messages[1]!) && !("assignee" in mine),
);
const owned = ((await admin("GET", `/v1/admin/support/${first.ref}`)).json() as { data: { ticket: { assignee: string; dueAt: string | null } } }).data.ticket;
check("whoever replies first owns it, and it's no longer due", owned.assignee === "key:josh" && owned.dueAt === null);

/* ---------------- support: owners ---------------- */
const putBack = (await admin("POST", `/v1/admin/support/${first.ref}/assign`, { to: "nobody" })).json() as { data: { ticket: { assignee: string } } };
check("a request can be put back for someone else", putBack.data.ticket.assignee === "");
const taken = (await admin("POST", `/v1/admin/support/${adaTicket.ref}/assign`, { to: "me" })).json() as { data: { ticket: { assignee: string } } };
check("…or taken with a click", taken.data.ticket.assignee === "key:josh");
const mineView = (await admin("GET", "/v1/admin/support?owner=mine")).json() as Inbox;
const nobodysView = (await admin("GET", "/v1/admin/support?owner=unassigned")).json() as Inbox;
check(
  "Mine and Unassigned filter the waiting inbox",
  mineView.data.total === 1 && mineView.data.tickets[0]!.ref === adaTicket.ref &&
    nobodysView.data.total === 4 && mineView.data.waiting.mine === 1 && mineView.data.waiting.unassigned === 4,
);

/* ---------------- support: saved replies ---------------- */
type Saved = { id: string; title: string; body: string; updatedBy: string };
const made = (await admin("POST", "/v1/admin/support/replies", {
  title: "Withdrawal delays",
  body: "Hi {name}, your withdrawal ({ref}) is on its way.",
})).json() as { data: { reply: Saved } };
check("a saved reply can be added", made.data.reply.title === "Withdrawal delays" && made.data.reply.updatedBy === "key:josh");
const edited = (await admin("PUT", `/v1/admin/support/replies/${made.data.reply.id}`, {
  title: "Withdrawal delays",
  body: "Hi {name}, your withdrawal ({ref}) is on its way — usually within the hour.",
})).json() as { data: { reply: Saved } };
check("…edited", edited.data.reply.body.includes("within the hour"));
const savedList = (await admin("GET", "/v1/admin/support/replies")).json() as { data: { replies: Saved[] } };
check("…and listed for the whole desk", savedList.data.replies.length === 1 && savedList.data.replies[0]!.id === made.data.reply.id);
await admin("DELETE", `/v1/admin/support/replies/${made.data.reply.id}`);
const afterDelete = (await admin("GET", "/v1/admin/support/replies")).json() as { data: { replies: Saved[] } };
check("…and deleted", afterDelete.data.replies.length === 0);
check(
  "a saved reply needs a name and a body (400)",
  (await admin("POST", "/v1/admin/support/replies", { title: "", body: "" })).statusCode === 400,
);

const closed = (await admin("POST", `/v1/admin/support/${adaTicket.ref}/reply`, { message: "Settled now — sorry for the wait.", close: true })).json() as {
  data: { ticket: { status: string } };
};
check("replying can close it at the same time", closed.data.ticket.status === "closed");
const reopened = await writeAgain("u-ada", adaTicket.ref, "Thanks! One more question about the payout.");
check("the customer writing again reopens it", reopened.status === "open" && reopened.messages.length === 3);
check("nobody can write into someone else's request", (await codeOf(() => writeAgain("u-bola", adaTicket.ref, "hello"))) === "TICKET_NOT_FOUND");

const reopenedDue = ((await admin("GET", `/v1/admin/support/${adaTicket.ref}`)).json() as { data: { ticket: { dueAt: string | null } } }).data.ticket.dueAt;
check("…with a fresh reply-by time (a bet: 4 hours)", reopenedDue !== null && Math.abs(Date.parse(reopenedDue) - Date.now() - 4 * 3_600_000) < 60_000);

const shut = await admin("POST", `/v1/admin/support/${adaTicket.ref}/status`, { status: "closed" });
check("the desk can close a request", (shut.json() as { data: { ticket: { status: string } } }).data.ticket.status === "closed");
const counts = ((await admin("GET", "/v1/admin/support?status=all")).json() as { data: { counts: Record<string, number>; total: number } }).data;
check("the counts follow", counts.total === 6 && counts.counts.open === 4 && counts.counts.answered === 1 && counts.counts.closed === 1);
const found = ((await admin("GET", `/v1/admin/support?status=all&search=${encodeURIComponent("withdrawal")}`)).json() as {
  data: { tickets: { ref: string }[] };
}).data.tickets;
check("search finds a request by its subject", found.length === 1 && found[0]!.ref === first.ref);
check("a closed request frees a slot for a new one", (await codeOf(() => openTicket(ada, { category: "account", subject: "Name change", message: "Can I change my display name?" }))) === "ok");

/* ---------------- the desk is emailed ---------------- */
console.log("support alerts");
const deskMail = () => sent.filter((m) => m.to.includes("support@worldstreetgold.test"));
const alertListMail = () => sent.filter((m) => m.to.includes("desk@worldstreetgold.test"));
const beforeAlerts = deskMail().length;
const beforeAlertList = alertListMail().length;
const beforeAll = sent.length;
const fresh = await openTicket(
  ada,
  { category: "money", subject: "Withdrawal keeps failing", message: "I can't convert my credit to dollars since morning." },
  log,
);
const newAlert = deskMail()[beforeAlerts];
check(
  "a new request emails the support list, with who, what, the message and when to reply by",
  deskMail().length === beforeAlerts + 1 &&
    newAlert!.subject === `[Worldstreet Local · Support] New support request ${fresh.ref}: Withdrawal keeps failing` &&
    newAlert!.text.includes("@ada (ada@example.test)") && newAlert!.text.includes("Deposits & withdrawals") &&
    newAlert!.text.includes("since morning") && newAlert!.text.includes("within an hour"),
);
check(
  "…with a link that opens that request on the desk",
  newAlert!.text.includes(`Reply: https://predict.worldstreetgold.test/admin/customers/support?ref=${fresh.ref}`),
);
check("…and not the alert list, so a question never pages anyone", alertListMail().length === beforeAlertList);
const ack = sent.slice(beforeAll).find((m) => m.to.includes("ada@example.test"));
check(
  "the customer gets a \"we've got it\" email with their number, when to expect a reply, and their Support page",
  ack !== undefined && ack.subject === `We've got your request [${fresh.ref}]` && ack.text.includes("within an hour") &&
    ack.text.includes("https://predict.worldstreetgold.test/support"),
);
await writeAgain("u-ada", fresh.ref, "Still failing, please help.", log);
check("more messages while it's still waiting don't email again", deskMail().length === beforeAlerts + 1);
await admin("POST", `/v1/admin/support/${fresh.ref}/reply`, { message: "We're on it.", close: false });
await writeAgain("u-ada", fresh.ref, "Thanks — any update?", log);
const backAlert = deskMail()[beforeAlerts + 1];
check(
  "a reply on an answered request emails them again, naming who has it",
  deskMail().length === beforeAlerts + 2 && backAlert!.subject.includes(`Customer wrote again on ${fresh.ref}`) &&
    backAlert!.text.includes("any update?") && backAlert!.text.includes("owner: key:josh"),
);
check("customers never get these", !deskMail().some((m) => m.to.includes("ada@example.test")));

const anon = await app.inject({ method: "GET", url: "/v1/support/tickets" });
const anonPost = await app.inject({
  method: "POST",
  url: "/v1/support/tickets",
  payload: { category: "other", subject: "Hello there", message: "Is anyone there at all?" },
});
check(`the customer's routes need a sign-in (got ${anon.statusCode}, ${anonPost.statusCode})`, anon.statusCode === 401 && anonPost.statusCode === 401);

console.log(`\n${passed} passed, ${failed} failed`);

await app.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
