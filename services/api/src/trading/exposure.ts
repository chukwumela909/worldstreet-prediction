import { config } from "../config.js";
import {
  fetchBayseEvent,
  winningOutcome,
  type BayseEventLive,
  type BayseOutcome,
} from "./bayse.js";
import { Position } from "./models.js";

/**
 * The settlement queue: what the house still owes, per event, next to
 * what Bayse currently says about it. This is the resolution desk's
 * entry point — the per-event view can only answer about an event whose
 * id you already have.
 *
 * Names come from the positions themselves (denormalized at trade time),
 * so a market keeps its row and its exposure even when Bayse is
 * unreachable; only the resolution half goes missing.
 */

/**
 * Events per queue load. Each costs a Bayse round trip, so this is a
 * latency ceiling rather than a data limit — the biggest exposures sort
 * in first and the result flags when it bit.
 */
const MAX_QUEUE_EVENTS = 40;
const FETCH_CONCURRENCY = 5;

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
  /** Null when Bayse couldn't be reached for this event. */
  bayseStatus: string | null;
  bayseResolvedOutcome: string | null;
  /** The outcome to settle on, pre-matched from Bayse's winning label. */
  bayseWinnerOutcomeId: string | null;
  outcomes: BayseOutcome[];
}

export interface QueueEvent {
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  bayseStatus: string | null;
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
 * Live Bayse state for many events, keyed by id. A failed fetch is
 * simply absent from the map: the queue still reports what we owe,
 * marked unreachable, rather than failing the page over one bad event.
 */
async function fetchEvents(
  eventIds: string[],
): Promise<Map<string, BayseEventLive>> {
  const out = new Map<string, BayseEventLive>();
  let cursor = 0;

  async function worker() {
    while (cursor < eventIds.length) {
      const eventId = eventIds[cursor];
      cursor += 1;
      if (!eventId) continue;
      try {
        out.set(eventId, await fetchBayseEvent(eventId));
      } catch {
        // absent from the map — reported as bayse_unreachable
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, eventIds.length) }, worker),
  );
  return out;
}

/**
 * The poller settles resolved markets by itself, so a market that is
 * still open here while Bayse calls it resolved means auto-settlement
 * couldn't finish it. That, a winning label none of Bayse's own
 * outcomes match, and long-overdue resolutions are what the desk exists
 * to clear.
 */
export function attentionFor(params: {
  event: BayseEventLive | null;
  markets: Pick<QueueMarket, "bayseStatus" | "bayseWinnerOutcomeId">[];
  now: number;
  overdueMs: number;
}): Attention {
  const { event, markets, now, overdueMs } = params;
  if (!event) return "bayse_unreachable";
  if (event.status === "cancelled") return "cancelled";

  const resolved = markets.filter((m) => m.bayseStatus === "resolved");
  if (resolved.some((m) => !m.bayseWinnerOutcomeId)) return "unmatched_outcome";
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
  const live = await fetchEvents(eventIds);
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
        bayseStatus: market?.status ?? null,
        bayseResolvedOutcome: market?.resolvedOutcome || null,
        bayseWinnerOutcomeId: market ? (winningOutcome(market)?.id ?? null) : null,
        outcomes: market?.outcomes ?? [],
      };
    });

    return {
      eventId,
      eventTitle: event?.title ?? first?.eventTitle ?? "",
      eventSlug: event?.slug ?? first?.eventSlug ?? "",
      bayseStatus: event?.status ?? null,
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
