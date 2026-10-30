/**
 * The desk's wallet check, through the real admin route, against a fake
 * wallet that keeps a real balance and misbehaves in each way that has hurt
 * or could hurt customers. In-memory database.
 *
 *   npx tsx scripts/wallet-check-smoke.mts
 */
const KEY = "smoke-wallet-key-0123456789abcdefXYZ";
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk";
process.env.CLERK_SECRET_KEY = "sk_test_fake";
process.env.SETTLEMENT_POLL_SECONDS = "0";
process.env.ADMIN_ACCESS_KEYS = `josh:${KEY}`;
process.env.WALLET_API_URL = "https://wallet.test";
process.env.WALLET_SERVICE_TOKEN = "test-token";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: "test" });

const { buildApp } = await import("../src/app.js");
const { LedgerEntry, ensureTradingIndexes } = await import("../src/trading/models.js");
const { User } = await import("../src/models.js");
await ensureTradingIndexes();
const app = await buildApp();

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? "✓" : "✗ FAIL:"} ${name}`);
}

/* ---------------- a wallet with a real balance ---------------- */
type Mode =
  | "good" // pays once per reference and replays say OK
  | "duplicate" // pays once per reference and replays answer 409
  | "refuse" // 403s every credit, like the block customers hit
  | "false-paid" // 409s a brand-new reference and pays nothing
  | "yes-no-money" // says yes to a credit and pays nothing
  | "pays-twice" // ignores the reference and pays again
  | "replay-refused" // pays once, then refuses the replay
  | "down" // a gateway page for every credit
  | "no-charges" // credits fine, refuses charges
  | "charges-twice" // ignores the key on charges
  | "unreachable"; // can't even read a balance
let mode: Mode = "good";
let balance = 500;
const paid = new Set<string>();
const charged = new Set<string>();
const calls = { credits: 0, charges: 0 };

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.hostname === "api.resend.com") return json({ id: "email" });
  if (url.pathname.endsWith("/balances")) {
    if (mode === "unreachable") throw new TypeError("fetch failed");
    return json({
      ok: true,
      balances: { USD: { availableMinor: balance, lockedMinor: 0, available: balance / 100, locked: 0 } },
    });
  }
  const body = JSON.parse(String(init?.body ?? "{}")) as { reference?: string; amountMinor: number };
  if (url.pathname.endsWith("/credits")) {
    calls.credits += 1;
    const ref = body.reference!;
    if (mode === "refuse") {
      return json({ ok: false, code: "FORBIDDEN", error: "Branch prediction is not allowed to issue platform credits" }, 403);
    }
    if (mode === "false-paid") return json({ ok: false, code: "LOCKED", error: "wallet locked" }, 409);
    if (mode === "yes-no-money") return json({ ok: true, credit: { id: "c" } });
    if (mode === "down") return new Response("<html>502</html>", { status: 502 });
    if (paid.has(ref) && mode !== "pays-twice") {
      if (mode === "duplicate") return json({ ok: false, code: "DUPLICATE_REFERENCE", error: "reference already used" }, 409);
      if (mode === "replay-refused") return json({ ok: false, code: "BAD_REQUEST", error: "nope" }, 400);
      return json({ ok: true, credit: { id: "c" }, replayed: true });
    }
    paid.add(ref);
    balance += body.amountMinor;
    return json({ ok: true, credit: { id: "c" } });
  }
  if (url.pathname.endsWith("/charges")) {
    calls.charges += 1;
    if (mode === "no-charges") return json({ ok: false, code: "FORBIDDEN", error: "charges are off" }, 403);
    const key = (init?.headers as Record<string, string>)["Idempotency-Key"]!;
    if (!charged.has(key) || mode === "charges-twice") {
      charged.add(key);
      balance -= body.amountMinor;
    }
    return json({ ok: true, charge: { id: "ch", amountMinor: body.amountMinor, currency: "USD", description: "", createdAt: "" } });
  }
  return json({ ok: false, code: "NOT_FOUND", error: "not found" }, 404);
}) as typeof fetch;

await User.create({ authUserId: "u-me", email: "me@example.test", username: "TestMe", displayName: "me" });
await User.create({ authUserId: "u-sus", email: "sus@example.test", username: "sus", displayName: "sus", suspendedAt: new Date() });

interface Run {
  verdict: string;
  summary: string;
  leftoverMinor: number;
  ranBy: string;
  account: string;
  steps: { key: string; status: string; detail: string }[];
}
// a new address each time, so the route's rate limit doesn't stop the test
let caller = 0;
const post = (payload: unknown, key: string | null = KEY) =>
  app.inject({
    method: "POST",
    url: "/v1/admin/wallet-check",
    remoteAddress: `10.0.0.${++caller}`,
    headers: { "content-type": "application/json", ...(key ? { "x-admin-key": key } : {}) },
    payload: JSON.stringify(payload),
  });
async function runIn(m: Mode, start = 500): Promise<Run> {
  mode = m;
  balance = start;
  paid.clear();
  charged.clear();
  calls.credits = 0;
  calls.charges = 0;
  const res = await post({ account: "testme", confirm: "RUN" });
  if (res.statusCode !== 200) throw new Error(`${m}: ${res.statusCode} ${res.body}`);
  return (res.json() as { data: Run }).data;
}
const step = (r: Run, key: string) => r.steps.find((s) => s.key === key)!;

console.log("a healthy wallet");
const good = await runIn("good");
check(
  "it says working, with every step passed",
  good.verdict === "working" && good.steps.length === 5 && good.steps.every((s) => s.status === "pass"),
);
check("the balance is back where it started, nothing left over", balance === 500 && good.leftoverMinor === 0);
check("it found the account whatever the capitals, and recorded who ran it", good.account === "TestMe" && good.ranBy.includes("josh"));
check("the Predict ledger isn't touched", (await LedgerEntry.countDocuments({})) === 0);

console.log("a wallet that answers a repeat with a 409");
const dup = await runIn("duplicate");
check("it still counts as working", dup.verdict === "working");
check("…and shows the wallet's exact words", step(dup, "credit_again").detail.includes('409 DUPLICATE_REFERENCE: "reference already used"'));

console.log("the block customers have been hitting");
const refused = await runIn("refuse");
check("it says not working, and names withdrawals", refused.verdict === "not_working" && /Withdrawals from Predict/.test(refused.summary));
check("…quoting the wallet's reason", step(refused, "credit").detail.includes("Branch prediction is not allowed"));
check("…nothing was charged, and later steps read as not tested", calls.charges === 0 && balance === 500 && step(refused, "charge").status === "skip");

console.log("answers that would fool Predict");
const falsePaid = await runIn("false-paid");
check(
  "a 409 on a new reference fails, warning of credit kept with no dollars",
  falsePaid.verdict === "not_working" && /already paid/.test(step(falsePaid, "credit").detail),
);
const noMoney = await runIn("yes-no-money");
check("the wallet saying yes without the money moving fails", noMoney.verdict === "not_working" && step(noMoney, "credit").status === "fail");
check("…and it doesn't take a cent that never arrived", calls.charges === 0 && balance === 500);

console.log("paying twice");
const twice = await runIn("pays-twice");
check("a repeat that pays again fails", twice.verdict === "not_working" && /paid twice/.test(step(twice, "credit_again").detail));
check("…and both cents are taken back", balance === 500 && twice.leftoverMinor === 0);
const replayRefused = await runIn("replay-refused");
check(
  "a repeat answered with a refusal fails: Predict would hand the credit back",
  replayRefused.verdict === "not_working" && /give the credit back/.test(step(replayRefused, "credit_again").detail),
);
check("…and the cent still comes back", balance === 500);

console.log("the wallet being down");
const down = await runIn("down");
check("a gateway page fails as no clear answer", down.verdict === "not_working" && /No clear answer/.test(step(down, "credit").detail));
const gone = await runIn("unreachable");
check("not reaching it at all fails on the first step", gone.verdict === "not_working" && step(gone, "reach").status === "fail" && calls.credits === 0);

console.log("deposits");
const noCharges = await runIn("no-charges");
check(
  "charges refused: withdrawals work, deposits don't",
  noCharges.verdict === "not_working" && /deposits into Predict aren't working/.test(noCharges.summary),
);
check("…and it says the cent is still there", noCharges.leftoverMinor === 1 && balance === 501);
const chargedTwice = await runIn("charges-twice");
check("a repeat that charges again fails", chargedTwice.verdict === "not_working" && step(chargedTwice, "charge_again").status === "fail");

console.log("the guided test's balances");
mode = "good";
balance = 777;
const read = (await app.inject({ method: "GET", url: "/v1/admin/wallet-check/account?account=testme", headers: { "x-admin-key": KEY } })).json() as {
  data: { username: string; dollarsMinor: number; lockedMinor: number; balanceKobo: number; flagged: boolean; suspended: boolean };
};
check(
  "it reads the account's dollars, locked money and Predict balance",
  read.data.username === "TestMe" && read.data.dollarsMinor === 777 && read.data.lockedMinor === 0 && read.data.balanceKobo === 0,
);
check("…and says they're free to test with", !read.data.flagged && !read.data.suspended);
const noBalance = await app.inject({ method: "GET", url: "/v1/admin/wallet-check/account?account=nobody", headers: { "x-admin-key": KEY } });
check("an unknown account is a 404 there too", noBalance.statusCode === 404);

console.log("guards");
mode = "good";
const noKey = (await post({ account: "testme", confirm: "RUN" }, null)).statusCode;
check(`no key, no check (${noKey})`, noKey === 401 || noKey === 403);
check("it needs the confirmation", (await post({ account: "testme" })).statusCode === 400);
check("an unknown account is a 404", (await post({ account: "nobody", confirm: "RUN" })).statusCode === 404);
check("a suspended account is refused", (await post({ account: "sus", confirm: "RUN" })).statusCode === 409);

const list = await app.inject({ method: "GET", url: "/v1/admin/wallet-check", headers: { "x-admin-key": KEY } });
const runs = (list.json() as { data: { runs: Run[] } }).data.runs;
check("runs are kept, newest first, latest 10", runs.length === 10 && runs[0]!.verdict === "not_working");

console.log(`\n${passed} passed, ${failed} failed`);
await app.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
