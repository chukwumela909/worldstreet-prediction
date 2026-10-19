import { Position } from "./models.js";

/**
 * What the book has actually made or lost — finished markets only.
 *
 * The risk numbers (trading/risk.ts) are about open bets: what COULD be
 * owed. This is the other half: on every settled position, the house kept
 * the stake of a losing bet and paid ₦100/share on a winning one (its
 * potentialPayoutKobo — exactly what settlement credits), while a voided
 * bet was refunded and moves nothing. So:
 *
 *   profit = stakes on won + lost positions − payouts on won positions
 *
 * Split by book (Local vs international — Polymarket's ids are all
 * digits, ours and Bayse's are UUIDs) and over three windows by the time
 * each position settled.
 */

export interface PnlFigures {
  /** Stakes on settled won + lost positions — what came in. */
  stakesKobo: number;
  /** ₦100/share on won positions — what went out. */
  payoutsKobo: number;
  /** Stakes handed back on voided positions (no effect on profit). */
  refundsKobo: number;
  /** stakes − payouts. Negative = the house lost money. */
  profitKobo: number;
  positions: number;
  markets: number;
}

export interface PnlWindow extends PnlFigures {
  local: PnlFigures;
  international: PnlFigures;
}

export interface ProfitAndLoss {
  allTime: PnlWindow;
  last30Days: PnlWindow;
  last7Days: PnlWindow;
}

interface Row {
  _id: { status: "won" | "lost" | "voided"; international: boolean };
  stakeKobo: number;
  payoutKobo: number;
  positions: number;
  markets: string[];
}

const empty = (): PnlFigures => ({
  stakesKobo: 0,
  payoutsKobo: 0,
  refundsKobo: 0,
  profitKobo: 0,
  positions: 0,
  markets: 0,
});

async function window(since: Date | null): Promise<PnlWindow> {
  const rows = await Position.aggregate<Row>([
    {
      $match: {
        status: { $in: ["won", "lost", "voided"] },
        ...(since ? { settledAt: { $gte: since } } : {}),
      },
    },
    {
      $group: {
        _id: {
          status: "$status",
          international: { $regexMatch: { input: "$eventId", regex: /^\d+$/ } },
        },
        stakeKobo: { $sum: "$stakeKobo" },
        payoutKobo: { $sum: "$potentialPayoutKobo" },
        positions: { $sum: 1 },
        markets: { $addToSet: "$marketId" },
      },
    },
  ]);

  const books = { local: empty(), international: empty() };
  const marketSets = { local: new Set<string>(), international: new Set<string>() };
  for (const row of rows) {
    const book = row._id.international ? "international" : "local";
    const f = books[book];
    f.positions += row.positions;
    for (const m of row.markets) marketSets[book].add(m);
    if (row._id.status === "voided") {
      f.refundsKobo += row.stakeKobo;
    } else {
      f.stakesKobo += row.stakeKobo;
      if (row._id.status === "won") f.payoutsKobo += row.payoutKobo;
    }
  }
  for (const book of ["local", "international"] as const) {
    books[book].markets = marketSets[book].size;
    books[book].profitKobo = books[book].stakesKobo - books[book].payoutsKobo;
  }

  const total = empty();
  for (const f of [books.local, books.international]) {
    total.stakesKobo += f.stakesKobo;
    total.payoutsKobo += f.payoutsKobo;
    total.refundsKobo += f.refundsKobo;
    total.profitKobo += f.profitKobo;
    total.positions += f.positions;
    total.markets += f.markets;
  }
  return { ...total, ...books };
}

const DAY_MS = 86_400_000;

/** The desk's profit/loss card: all time, last 30 days, last 7 days. */
export async function getProfitAndLoss(now = Date.now()): Promise<ProfitAndLoss> {
  const [allTime, last30Days, last7Days] = await Promise.all([
    window(null),
    window(new Date(now - 30 * DAY_MS)),
    window(new Date(now - 7 * DAY_MS)),
  ]);
  return { allTime, last30Days, last7Days };
}
