/**
 * Checks the leaderboard aggregation against a real in-memory MongoDB.
 *
 *   npm run verify:leaderboard
 *
 * The pipeline decides money — who profited, by how much — from four
 * position states across two independently-windowed clocks, and none of
 * that is provable by typechecking. Covers: won/lost/voided/open, a stake
 * placed in one window and settled in another, negative windows, and tie
 * ordering (which is why the sort carries a tie-break to _id).
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../src/models.js";
import { Position } from "../src/trading/models.js";
import { getLeaderboard } from "../src/trading/leaderboard.js";

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        got  ${g}\n        want ${w}`);
}

async function seedPosition(o: {
  authUserId: string;
  stakeKobo: number;
  payoutKobo: number;
  status: "open" | "won" | "lost" | "voided";
  createdAt: Date;
  settledAt?: Date;
  key: string;
}) {
  await Position.collection.insertOne({
    authUserId: o.authUserId,
    eventId: "e1",
    marketId: "m1",
    outcomeId: "o1",
    outcomeLabel: "Yes",
    eventSlug: "e",
    eventTitle: "E",
    marketTitle: "M",
    stakeKobo: o.stakeKobo,
    priceKobo: 5000,
    shares: o.stakeKobo / 5000,
    potentialPayoutKobo: o.payoutKobo,
    status: o.status,
    idempotencyKey: o.key,
    createdAt: o.createdAt,
    updatedAt: o.createdAt,
    ...(o.settledAt ? { settledAt: o.settledAt } : {}),
  } as never);
}

async function main() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: "verify" });

  await User.create([
    { authUserId: "u1", email: "a@x.com", username: "ada", displayName: "Ada L", avatar: "" },
    { authUserId: "u2", email: "b@x.com", username: "bem", displayName: "Bem O", avatar: "" },
    { authUserId: "u3", email: "c@x.com", username: "cee", displayName: "Cee N", avatar: "" },
  ]);

  // u1: won 500 -> 1200 today (+700), lost 200 today (-200) = +500, vol 700
  await seedPosition({ authUserId: "u1", stakeKobo: 500, payoutKobo: 1200, status: "won",
    createdAt: ago(2 * 60 * 60 * 1000), settledAt: ago(60 * 60 * 1000), key: "k1" });
  await seedPosition({ authUserId: "u1", stakeKobo: 200, payoutKobo: 900, status: "lost",
    createdAt: ago(3 * 60 * 60 * 1000), settledAt: ago(60 * 60 * 1000), key: "k2" });

  // u2: voided 1000 today — refund, so zero P&L but real volume
  await seedPosition({ authUserId: "u2", stakeKobo: 1000, payoutKobo: 3000, status: "voided",
    createdAt: ago(4 * 60 * 60 * 1000), settledAt: ago(60 * 60 * 1000), key: "k3" });

  // u2: open 400 today — volume only, no P&L
  await seedPosition({ authUserId: "u2", stakeKobo: 400, payoutKobo: 800, status: "open",
    createdAt: ago(5 * 60 * 60 * 1000), key: "k4" });

  // u3: won 100 -> 10000 twenty days ago (+9900) — outside 1d/1w, inside 30d
  await seedPosition({ authUserId: "u3", stakeKobo: 100, payoutKobo: 10000, status: "won",
    createdAt: ago(20 * DAY), settledAt: ago(20 * DAY), key: "k5" });

  // u3: staked 60 days ago, settled today — volume is old, profit is today's
  await seedPosition({ authUserId: "u3", stakeKobo: 300, payoutKobo: 800, status: "won",
    createdAt: ago(60 * DAY), settledAt: ago(2 * 60 * 60 * 1000), key: "k6" });

  const brief = (rows: Awaited<ReturnType<typeof getLeaderboard>>) =>
    rows.map((r) => [r.displayName, r.profitKobo, r.volumeKobo]);

  check("1d/pnl — u3 +500 today (settled old stake), u1 +500; voided & open excluded",
    brief(await getLeaderboard("1d", "pnl")),
    [["Ada L", 500, 700], ["Cee N", 500, 0]]);

  check("1d/vol — u2 1400 staked, u1 700; u3 staked nothing today",
    brief(await getLeaderboard("1d", "vol")),
    [["Bem O", 0, 1400], ["Ada L", 500, 700]]);

  check("30d/pnl — u3 +9900+500, u1 +500",
    brief(await getLeaderboard("30d", "pnl")),
    [["Cee N", 10400, 100], ["Ada L", 500, 700]]);

  check("all/vol — u2 1400, u3 400, u1 700 ordered by volume",
    brief(await getLeaderboard("all", "vol")),
    [["Bem O", 0, 1400], ["Ada L", 500, 700], ["Cee N", 10400, 400]]);

  // a losing window must rank and render as negative
  await seedPosition({ authUserId: "u2", stakeKobo: 5000, payoutKobo: 9000, status: "lost",
    createdAt: ago(60 * 60 * 1000), settledAt: ago(30 * 60 * 1000), key: "k7" });
  check("1d/pnl — u2 now -5000 and sorts last",
    brief(await getLeaderboard("1d", "pnl")),
    [["Ada L", 500, 700], ["Cee N", 500, 0], ["Bem O", -5000, 6400]]);

  await mongoose.disconnect();
  await mongod.stop();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILING`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
