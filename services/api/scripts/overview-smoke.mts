/**
 * The admin desk's overview, FX and traders endpoints, through the real
 * app (fastify inject) with an admin access key — no Clerk session, on an
 * in-memory database.
 *
 *   npx tsx scripts/overview-smoke.mts
 */
import { randomBytes } from "node:crypto";

const KEY = randomBytes(24).toString("base64url");
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://placeholder";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk";
process.env.CLERK_SECRET_KEY = "sk_test_fake";
process.env.ADMIN_ACCESS_KEYS = `smoke:${KEY}`;
process.env.SETTLEMENT_POLL_SECONDS = "0";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: "test" });

const { buildApp } = await import("../src/app.js");
const { User } = await import("../src/models.js");
const { FxRate, NairaAccount, Position, ensureTradingIndexes } = await import(
  "../src/trading/models.js"
);
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

async function get(path: string) {
  const res = await app.inject({ method: "GET", url: path, headers: { "x-admin-key": KEY } });
  return { status: res.statusCode, body: res.json() as { data: any } };
}

const HOUR = 3_600_000;
const ago = (h: number) => new Date(Date.now() - h * HOUR);

// three people: two have staked, one never has
for (const [id, name] of [["u1", "ada"], ["u2", "bayo"], ["u3", "chi"]] as const) {
  await User.create({
    authUserId: id,
    username: name,
    displayName: name.toUpperCase(),
    email: `${name}@test.dev`,
  } as never);
}
await NairaAccount.create({ authUserId: "u1", balanceKobo: 50_000 } as never);
await NairaAccount.create({ authUserId: "u3", balanceKobo: 20_000 } as never);

let n = 0;
async function bet(p: {
  user: string;
  market: string;
  stake: number;
  price: number;
  status: "open" | "won" | "lost";
  placedHoursAgo: number;
  settledHoursAgo?: number;
}) {
  n += 1;
  const shares = p.stake / p.price;
  const doc = await Position.create({
    authUserId: p.user,
    eventId: "3f2b1c4e-9a7d-4e2b-8c1a-0b5d6e7f8a90",
    marketId: p.market,
    outcomeId: `${p.market}-yes`,
    outcomeLabel: "Yes",
    eventSlug: "ev",
    eventTitle: "Event",
    marketTitle: p.market,
    stakeKobo: p.stake,
    priceKobo: p.price,
    shares,
    potentialPayoutKobo: Math.floor(shares * 10_000),
    status: p.status,
    ...(p.settledHoursAgo !== undefined ? { settledAt: ago(p.settledHoursAgo) } : {}),
    idempotencyKey: `k${n}`,
  });
  // createdAt is set by mongoose; backdate it to when the bet was "placed"
  await Position.collection.updateOne({ _id: doc._id }, { $set: { createdAt: ago(p.placedHoursAgo) } });
}
// ada: a ₦60 win settled 2h ago (placed 3 days ago), and ₦50 open now
await bet({ user: "u1", market: "m1", stake: 6_000, price: 6_000, status: "won", placedHoursAgo: 72, settledHoursAgo: 2 });
await bet({ user: "u1", market: "m2", stake: 5_000, price: 5_000, status: "open", placedHoursAgo: 1 });
// bayo: a ₦40 loss settled 40 days ago (placed 41 days ago)
await bet({ user: "u2", market: "m1", stake: 4_000, price: 4_000, status: "lost", placedHoursAgo: 24 * 41, settledHoursAgo: 24 * 40 });
await FxRate.create({ usdToNgn: 1_450, setBy: "smoke" });

/* ---------------- overview ---------------- */
console.log("overview");
const o = await get("/v1/admin/overview");
const p = o.body.data?.periods;
check("admin key opens it", o.status === 200);
check(
  "all time: staked, bets, traders",
  p?.allTime.stakedKobo === 15_000 && p.allTime.bets === 3 && p.allTime.traders === 2,
);
check(
  "all time result: kept ₦100, paid ₦100, profit ₦0",
  p?.allTime.settledStakesKobo === 10_000 && p.allTime.payoutsKobo === 10_000 && p.allTime.profitKobo === 0,
);
check(
  "24h counts the bet PLACED today, and the win that FINISHED today",
  p?.last24h.stakedKobo === 5_000 &&
    p.last24h.bets === 1 &&
    p.last24h.payoutsKobo === 10_000 &&
    p.last24h.profitKobo === -4_000,
);
check("margin is profit over finished stakes", p?.last24h.marginPct === -66.7);
check(
  "7 days: the 3-day-old bet counts, the 41-day-old one doesn't",
  p?.last7Days.stakedKobo === 11_000 && p.last7Days.bets === 2 && p.last7Days.traders === 1,
);
check(
  "30 days leaves out the loss that finished 40 days ago",
  p?.last30Days.settledStakesKobo === 6_000 && p.last30Days.profitKobo === -4_000,
);
check(
  "money in play now",
  o.body.data?.open.bets === 1 && o.body.data.open.stakeKobo === 5_000 && o.body.data.open.markets === 1,
);
check(
  "accounts, stakers and credit held",
  o.body.data?.accounts === 3 &&
    o.body.data.tradersWithStakes === 2 &&
    o.body.data.creditHeldKobo === 70_000,
);
check("FX mid for the ₦/$ switch", o.body.data?.fx?.usdToNgnMid === 1_450);

/* ---------------- fx ---------------- */
console.log("fx");
const fx = await get("/v1/admin/fx");
check("admin FX quote without a Clerk login", fx.status === 200 && fx.body.data.fx?.mid === 1_450);

/* ---------------- traders ---------------- */
console.log("traders");
const all = await get("/v1/admin/traders?activeOnly=false");
check("activeOnly=false really lists everyone (was read as true)", all.body.data?.total === 3);
const active = await get("/v1/admin/traders?activeOnly=true");
check("activeOnly=true lists only people who staked", active.body.data?.total === 2);
const losers = await get("/v1/admin/traders?activeOnly=true&sort=losers");
check("biggest losers first", losers.body.data?.traders[0]?.username === "bayo");
const open = await get("/v1/admin/traders?activeOnly=true&sort=open");
check("most money in play first", open.body.data?.traders[0]?.username === "ada");
const refused = await app.inject({ method: "GET", url: "/v1/admin/overview" });
check("no key, no login → refused", refused.statusCode === 401 || refused.statusCode === 403);

console.log(`\n${passed} passed, ${failed} failed`);

await app.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(failed > 0 ? 1 : 0);
