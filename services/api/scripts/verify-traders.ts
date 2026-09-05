/**
 * Checks the traders listing against a real in-memory MongoDB.
 *
 *   npm run verify:traders
 *
 * The list merges three collections in memory and then sorts and pages
 * the result, so the things that can break are joins and ordering, not
 * types: a profile with no positions, a profile with no naira account,
 * search across three fields, the never-traded sink at the bottom of
 * "recent", and the summary totalling the filtered set rather than the
 * page.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../src/models.js";
import { NairaAccount, Position } from "../src/trading/models.js";
import { listTraders } from "../src/trading/traders.js";

const HOUR = 60 * 60 * 1000;
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

  // createdAt is set explicitly: "joined" sorts on it, and three rows
  // written in the same millisecond would make that order arbitrary
  await User.collection.insertMany([
    { authUserId: "u1", email: "ada@x.com", username: "ada", displayName: "Ada L", avatar: "", createdAt: ago(72 * HOUR), updatedAt: ago(72 * HOUR) },
    { authUserId: "u2", email: "bem@x.com", username: "bem", displayName: "Bem O", avatar: "", createdAt: ago(48 * HOUR), updatedAt: ago(48 * HOUR) },
    { authUserId: "u3", email: "cee@zz.com", username: "cee", displayName: "Cee N", avatar: "", createdAt: ago(24 * HOUR), updatedAt: ago(24 * HOUR) },
  ] as never);

  await NairaAccount.collection.insertMany([
    { authUserId: "u1", balanceKobo: 9000, createdAt: new Date(), updatedAt: new Date() },
    { authUserId: "u2", balanceKobo: 100, createdAt: new Date(), updatedAt: new Date() },
    // u3 has no account row at all — must read as a zero balance, not vanish
  ] as never);

  // u1: staked 700 across two settled bets, +500 realized, last trade 2h ago
  await seedPosition({ authUserId: "u1", stakeKobo: 500, payoutKobo: 1200, status: "won", createdAt: ago(2 * HOUR), settledAt: ago(HOUR), key: "k1" });
  await seedPosition({ authUserId: "u1", stakeKobo: 200, payoutKobo: 900, status: "lost", createdAt: ago(3 * HOUR), settledAt: ago(HOUR), key: "k2" });

  // u2: one void (refund, no P&L) and one still open, last trade 1h ago
  await seedPosition({ authUserId: "u2", stakeKobo: 1000, payoutKobo: 3000, status: "voided", createdAt: ago(4 * HOUR), settledAt: ago(HOUR), key: "k3" });
  await seedPosition({ authUserId: "u2", stakeKobo: 400, payoutKobo: 800, status: "open", createdAt: ago(HOUR), key: "k4" });

  // u3 has never staked.

  const brief = (l: Awaited<ReturnType<typeof listTraders>>) =>
    l.traders.map((t) => [
      t.username,
      t.trades,
      t.stakedKobo,
      t.realizedPnlKobo,
      t.balanceKobo,
    ]);

  check(
    "recent — u2 (1h) then u1 (2h), never-traded u3 last",
    brief(await listTraders({})),
    [["bem", 2, 1400, 0, 100], ["ada", 2, 700, 500, 9000], ["cee", 0, 0, 0, 0]],
  );

  check(
    "staked — u2 1400 ahead of u1 700, u3 zero",
    brief(await listTraders({ sort: "staked" })),
    [["bem", 2, 1400, 0, 100], ["ada", 2, 700, 500, 9000], ["cee", 0, 0, 0, 0]],
  );

  check(
    "pnl — only u1 has realized anything; a void is not a loss",
    brief(await listTraders({ sort: "pnl" })),
    [["ada", 2, 700, 500, 9000], ["bem", 2, 1400, 0, 100], ["cee", 0, 0, 0, 0]],
  );

  check(
    "balance — u3's missing account row reads as 0, it does not drop out",
    brief(await listTraders({ sort: "balance" })),
    [["ada", 2, 700, 500, 9000], ["bem", 2, 1400, 0, 100], ["cee", 0, 0, 0, 0]],
  );

  check(
    "joined — newest profile first",
    brief(await listTraders({ sort: "joined" })),
    [["cee", 0, 0, 0, 0], ["bem", 2, 1400, 0, 100], ["ada", 2, 700, 500, 9000]],
  );

  check(
    "activeOnly — drops the account that never staked",
    brief(await listTraders({ activeOnly: true })),
    [["bem", 2, 1400, 0, 100], ["ada", 2, 700, 500, 9000]],
  );

  check(
    "search — matches an email domain, not just names",
    brief(await listTraders({ search: "zz.com" })),
    [["cee", 0, 0, 0, 0]],
  );

  check(
    "search — matches display name case-insensitively",
    brief(await listTraders({ search: "ada l" })),
    [["ada", 2, 700, 500, 9000]],
  );

  check(
    "search — a regex metacharacter is a literal, not a pattern",
    brief(await listTraders({ search: ".*" })),
    [],
  );

  const open = await listTraders({ sort: "staked" });
  check(
    "u2's open position: still riding, and its payout is the risk",
    [open.traders[0]?.openPositions, open.traders[0]?.openStakeKobo, open.traders[0]?.openPayoutKobo],
    [1, 400, 800],
  );

  const page = await listTraders({ sort: "staked", limit: 1, offset: 1 });
  check("paging — limit/offset cut the page, total counts the whole set",
    [brief(page), page.total], [[["ada", 2, 700, 500, 9000]], 3]);

  check(
    "summary totals the filtered set, not the page",
    page.summary,
    { users: 3, traders: 2, stakedKobo: 2100, openStakeKobo: 400, realizedPnlKobo: 500, balanceKobo: 9100 },
  );

  check(
    "summary follows the filter too",
    (await listTraders({ search: "zz.com" })).summary,
    { users: 1, traders: 0, stakedKobo: 0, openStakeKobo: 0, realizedPnlKobo: 0, balanceKobo: 0 },
  );

  await mongoose.disconnect();
  await mongod.stop();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILING`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
