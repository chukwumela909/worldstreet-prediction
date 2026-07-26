import { config } from "../config.js";
import {
  fetchTradableEvents,
  type MarketOrigin,
  type TradableEvent,
  type TradableOutcome,
} from "./events.js";
import { Position } from "./models.js";

/**
 * The settlement queue: what the house still owes, per event, next to
 * what the event's source currently says about it. This is the
 * resolution desk's entry point — the per-event view can only answer
 * about an event whose id you already have.
 *
 * Names come from the positions themselves (denormalized at trade time),
 * so a market keeps its row and its exposure even when Bayse is
 * unreachable; only the resolution half goes missing. Our own markets
 * are read from the same database as the positions, so for those the
 * unreachable case doesn't exist.
 */

/**
 * Events per queue load. Bayse ones each cost a Relay round trip, so
 * this is a latency ceiling rather than a data limit — the biggest
 * exposures sort in first and the result flags when it bit.
 */
const MAX_QUEUE_EVENTS = 40;

/** Why an event needs a human, or null when it's just waiting. */
export type Attention =
  | "cancelled"
  | "resolved_unsettled"
  | "unmatched_outcome"
  | "overdue"
  | "bayse_unreachable"
  | null;

export interface QueueMarket {
  marketId: string;
  marketTitle: string;
  openPositions: number;
  openStakeKobo: number;
  maxPayoutKobo: number;
  /** Null when the source couldn't be reached (Bayse events only). */
  upstreamStatus: string | null;
  /** What the source calls the winner, once it has one. */
  resolvedOutcomeLabel: string | null;
  /** The outcome to settle on, pre-matched from that label. */
  winnerOutcomeId: string | null;
  outcomes: TradableOutcome[];
}

export interface QueueEvent {
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  /** Where the market came from — Bayse's feed, or written by us. */
  origin: MarketOrigin | null;
  upstreamStatus: string | null;
  resolutionDate: string;
  openPositions: number;
  openStakeKobo: number;
  maxPayoutKobo: number;
  attention: Attention;
  markets: QueueMarket[];
}

export interface SettlementQueue {
  events: QueueEvent[];
  /** True when more events carry open positions than the cap returns. */
  truncated: boolean;
  overdueHours: number;
}

interface ExposureRow {
  _id: { eventId: string; marketId: string };
  eventTitle: string;
  eventSlug: string;
  marketTitle: string;
  openPositions: number;
  openStakeKobo: number;
  maxPayoutKobo: number;
}

/** Open exposure grouped by market, heaviest payout first. */
async function openExposureByMarket(): Promise<ExposureRow[]> {
  return Position.aggregate<ExposureRow>([
    { $match: { status: "open" } },
    {
      $group: {
        _id: { eventId: "$eventId", marketId: "$marketId" },
        eventTitle: { $first: "$eventTitle" },
        eventSlug: { $first: "$eventSlug" },
        marketTitle: { $first: "$marketTitle" },
        openPositions: { $sum: 1 },
        openStakeKobo: { $sum: "$stakeKobo" },
        maxPayoutKobo: { $sum: "$potentialPayoutKobo" },
      },
    },
    { $sort: { maxPayoutKobo: -1 } },
  ]);
}

/**
 * The poller settles resolved markets by itself, so a market that is
 * still open here while its source calls it resolved means
 * auto-settlement couldn't finish it. That, a winning label none of the
 * source's own outcomes match, and long-overdue resolutions are what
 * the desk exists to clear.
 *
 * A Worldstreet market never reaches "resolved" without the desk
 * settling it, so what it actually surfaces here is the overdue flag —
 * this queue is where someone finds out one of our own markets is past
 * its result and still holding stakes.
 */
export function attentionFor(params: {
  event: TradableEvent | null;
  markets: Pick<QueueMarket, "upstreamStatus" | "winnerOutcomeId">[];
  now: number;
  overdueMs: number;
}): Attention {
  const { event, markets, now, overdueMs } = params;
  if (!event) return "bayse_unreachable";
  if (event.status === "cancelled") return "cancelled";

  const resolved = markets.filter((m) => m.upstreamStatus === "resolved");
  if (resolved.some((m) => !m.winnerOutcomeId)) return "unmatched_outcome";
  if (resolved.length > 0) return "resolved_unsettled";

  const resolutionMs = event.resolutionDate
    ? Date.parse(event.resolutionDate)
    : NaN;
  if (!Number.isNaN(resolutionMs) && now - resolutionMs > overdueMs) {
    return "overdue";
  }
  return null;
}

export async function getSettlementQueue(): Promise<SettlementQueue> {
  const rows = await openExposureByMarket();

  // group market rows under their event, keeping the payout ordering
  const byEvent = new Map<string, ExposureRow[]>();
  for (const row of rows) {
    const existing = byEvent.get(row._id.eventId);
    if (existing) existing.push(row);
    else byEvent.set(row._id.eventId, [row]);
  }

  const eventIds = [...byEvent.keys()].slice(0, MAX_QUEUE_EVENTS);
  const live = await fetchTradableEvents(eventIds);
  const overdueMs = config.SETTLEMENT_OVERDUE_HOURS * 3_600_000;
  const now = Date.now();

  const events = eventIds.map((eventId): QueueEvent => {
    const marketRows = byEvent.get(eventId) ?? [];
    const event = live.get(eventId) ?? null;
    const first = marketRows[0];

    const markets = marketRows.map((row): QueueMarket => {
      const market = event?.markets.find((m) => m.id === row._id.marketId) ?? null;
      return {
        marketId: row._id.marketId,
        marketTitle: row.marketTitle,
        openPositions: row.openPositions,
        openStakeKobo: row.openStakeKobo,
        maxPayoutKobo: row.maxPayoutKobo,
        upstreamStatus: market?.status ?? null,
        resolvedOutcomeLabel: market?.resolvedOutcomeLabel ?? null,
        winnerOutcomeId: market?.resolvedOutcomeId ?? null,
        outcomes: market?.outcomes ?? [],
      };
    });

    return {
      eventId,
      eventTitle: event?.title ?? first?.eventTitle ?? "",
      eventSlug: event?.slug ?? first?.eventSlug ?? "",
      origin: event?.origin ?? null,
      upstreamStatus: event?.status ?? null,
      resolutionDate: event?.resolutionDate ?? "",
      openPositions: marketRows.reduce((s, r) => s + r.openPositions, 0),
      openStakeKobo: marketRows.reduce((s, r) => s + r.openStakeKobo, 0),
      maxPayoutKobo: marketRows.reduce((s, r) => s + r.maxPayoutKobo, 0),
      attention: attentionFor({ event, markets, now, overdueMs }),
      markets,
    };
  });

  return {
    events,
    truncated: byEvent.size > eventIds.length,
    overdueHours: config.SETTLEMENT_OVERDUE_HOURS,
  };
}
