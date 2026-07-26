import { Position } from "./models.js";
import type {
  IWorldstreetEvent,
  IWorldstreetMarket,
} from "./models.js";
import { bookMarginBps } from "./worldstreet.js";

/**
 * JSON shapes for Worldstreet's own markets, shared by the public feed
 * (routes/markets.ts) and the admin desk (routes/admin-markets.ts) so
 * the two can never drift on what a market looks like. The admin
 * version is the public one plus what only the desk should see: draft
 * status, the book's margin, and the exposure riding on it.
 */

export interface PublicOutcome {
  id: string;
  label: string;
  priceKobo: number;
}

export interface PublicMarket {
  id: string;
  title: string;
  rules: string;
  status: string;
  outcomes: PublicOutcome[];
}

export interface PublicEvent {
  id: string;
  slug: string;
  title: string;
  category: string;
  description: string;
  imageUrl: string;
  resolutionSource: string;
  status: string;
  closesAt: string | null;
  resolutionDate: string | null;
  /** Positions taken across the event — the site shows it as trades. */
  trades: number;
  /** Everything staked on it so far, kobo. */
  stakedKobo: number;
  markets: PublicMarket[];
}

export function serializeMarket(market: IWorldstreetMarket): PublicMarket {
  return {
    id: market.marketId,
    title: market.title,
    rules: market.rules ?? "",
    status: market.status,
    outcomes: market.outcomes.map((o) => ({
      id: o.outcomeId,
      label: o.label,
      priceKobo: o.priceKobo,
    })),
  };
}

export function serializeEvent(
  event: IWorldstreetEvent,
  markets: IWorldstreetMarket[],
  activity: EventActivity = { trades: 0, stakedKobo: 0 },
): PublicEvent {
  return {
    id: event.eventId,
    slug: event.slug,
    title: event.title,
    category: event.category,
    description: event.description ?? "",
    imageUrl: event.imageUrl ?? "",
    resolutionSource: event.resolutionSource ?? "",
    status: event.status,
    closesAt: event.closesAt?.toISOString() ?? null,
    resolutionDate: event.resolutionDate?.toISOString() ?? null,
    trades: activity.trades,
    stakedKobo: activity.stakedKobo,
    markets: markets.map(serializeMarket),
  };
}

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

export interface EventActivity {
  trades: number;
  stakedKobo: number;
}

/** Per-event trade counts and stake totals, in one aggregate. */
export async function activityByEvent(
  eventIds: string[],
): Promise<Map<string, EventActivity>> {
  const out = new Map<string, EventActivity>();
  if (eventIds.length === 0) return out;

  const rows = await Position.aggregate<{
    _id: string;
    trades: number;
    stakedKobo: number;
  }>([
    { $match: { eventId: { $in: eventIds } } },
    {
      $group: {
        _id: "$eventId",
        trades: { $sum: 1 },
        stakedKobo: { $sum: "$stakeKobo" },
      },
    },
  ]);
  for (const row of rows) {
    out.set(row._id, { trades: row.trades, stakedKobo: row.stakedKobo });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Admin view                                                          */
/* ------------------------------------------------------------------ */

export interface MarketExposure {
  openPositions: number;
  openStakeKobo: number;
  maxPayoutKobo: number;
  /** Any position at all, settled included — what blocks deletion. */
  totalPositions: number;
}

export interface AdminMarket extends PublicMarket {
  /** House edge in the two prices, basis points over ₦100. */
  marginBps: number;
  resolvedOutcomeId: string | null;
  exposure: MarketExposure;
}

export interface AdminEvent extends Omit<PublicEvent, "markets"> {
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
  markets: AdminMarket[];
}

export function serializeAdminEvent(
  event: IWorldstreetEvent & { createdAt?: Date | null; updatedAt?: Date | null },
  markets: IWorldstreetMarket[],
  activity: EventActivity,
  exposure: Map<string, MarketExposure>,
): AdminEvent {
  const base = serializeEvent(event, markets, activity);
  return {
    ...base,
    createdBy: event.createdBy,
    createdAt: event.createdAt?.toISOString() ?? null,
    updatedAt: event.updatedAt?.toISOString() ?? null,
    markets: markets.map((m) => ({
      ...serializeMarket(m),
      marginBps: bookMarginBps(m.outcomes.map((o) => o.priceKobo)),
      resolvedOutcomeId: m.resolvedOutcomeId ?? null,
      exposure: exposure.get(m.marketId) ?? {
        openPositions: 0,
        openStakeKobo: 0,
        maxPayoutKobo: 0,
        totalPositions: 0,
      },
    })),
  };
}

/** Open exposure and lifetime position counts per market. */
export async function exposureByMarket(
  marketIds: string[],
): Promise<Map<string, MarketExposure>> {
  const out = new Map<string, MarketExposure>();
  if (marketIds.length === 0) return out;

  const rows = await Position.aggregate<{
    _id: string;
    totalPositions: number;
    openPositions: number;
    openStakeKobo: number;
    maxPayoutKobo: number;
  }>([
    { $match: { marketId: { $in: marketIds } } },
    {
      $group: {
        _id: "$marketId",
        totalPositions: { $sum: 1 },
        openPositions: {
          $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] },
        },
        openStakeKobo: {
          $sum: { $cond: [{ $eq: ["$status", "open"] }, "$stakeKobo", 0] },
        },
        maxPayoutKobo: {
          $sum: {
            $cond: [{ $eq: ["$status", "open"] }, "$potentialPayoutKobo", 0],
          },
        },
      },
    },
  ]);
  for (const row of rows) {
    out.set(row._id, {
      totalPositions: row.totalPositions,
      openPositions: row.openPositions,
      openStakeKobo: row.openStakeKobo,
      maxPayoutKobo: row.maxPayoutKobo,
    });
  }
  return out;
}
