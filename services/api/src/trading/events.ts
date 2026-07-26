import { ApiError } from "../errors.js";
import {
  fetchBayseEvent,
  winningOutcome,
  type BayseEventLive,
} from "./bayse.js";
import { PAYOUT_PER_SHARE_KOBO } from "./ledger.js";
import { loadWorldstreetEvents } from "./worldstreet.js";
import type { IWorldstreetEvent, IWorldstreetMarket } from "./models.js";

/**
 * One shape for both origins of Local market, so that everything
 * downstream of pricing — the trade route, the settlement engine, the
 * resolution desk — never has to ask where an event came from.
 *
 * Bayse events are fetched fresh from Relay on every call (a stale
 * price on the execution path is money out of the house wallet);
 * Worldstreet events are read from Mongo, where the desk's fixed odds
 * are the only prices that exist. Prices are normalized to kobo per
 * ₦100 share here, which is the unit the book works in — Relay's
 * 0-to-1 probabilities do not appear past this file.
 */

export type MarketOrigin = "bayse" | "worldstreet";

export interface TradableOutcome {
  id: string;
  label: string;
  /** What one ₦100 share costs, 1–9 999 kobo. */
  priceKobo: number;
}

export interface TradableMarket {
  id: string;
  title: string;
  /** "open" | "closed" | "resolved" | "cancelled" — Bayse's vocabulary. */
  status: string;
  outcomes: TradableOutcome[];
  /** The winner, once there is one and it matched an outcome. */
  resolvedOutcomeId: string | null;
  /** What the source called the winner, for the audit trail. */
  resolvedOutcomeLabel: string | null;
}

export interface TradableEvent {
  origin: MarketOrigin;
  id: string;
  slug: string;
  title: string;
  status: string;
  /** ISO or "" — trading stops here. */
  closingDate: string;
  resolutionDate: string;
  /** Bayse's automated short-cycle series; never true for our own. */
  countdown: boolean;
  markets: TradableMarket[];
}

function fromBayse(event: BayseEventLive): TradableEvent {
  return {
    origin: "bayse",
    id: event.id,
    slug: event.slug,
    title: event.title,
    status: event.status,
    closingDate: event.closingDate,
    resolutionDate: event.resolutionDate,
    countdown: event.countdown,
    markets: event.markets.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      outcomes: m.outcomes.map((o) => ({
        id: o.id,
        label: o.label,
        priceKobo: Math.round(o.price * PAYOUT_PER_SHARE_KOBO),
      })),
      resolvedOutcomeId: winningOutcome(m)?.id ?? null,
      resolvedOutcomeLabel: m.resolvedOutcome || null,
    })),
  };
}

export function fromWorldstreet(
  event: IWorldstreetEvent,
  markets: IWorldstreetMarket[],
): TradableEvent {
  return {
    origin: "worldstreet",
    id: event.eventId,
    slug: event.slug,
    title: event.title,
    status: event.status,
    closingDate: event.closesAt?.toISOString() ?? "",
    resolutionDate: event.resolutionDate?.toISOString() ?? "",
    countdown: false,
    markets: markets.map((m) => ({
      id: m.marketId,
      title: m.title,
      status: m.status,
      outcomes: m.outcomes.map((o) => ({
        id: o.outcomeId,
        label: o.label,
        priceKobo: o.priceKobo,
      })),
      resolvedOutcomeId: m.resolvedOutcomeId ?? null,
      resolvedOutcomeLabel:
        m.outcomes.find((o) => o.outcomeId === m.resolvedOutcomeId)?.label ??
        null,
    })),
  };
}

/**
 * Fresh state for one event of either origin. Ours are checked first:
 * a Bayse id can never collide with a UUID we minted, and the local
 * lookup is a single indexed read against a Relay round trip.
 */
export async function fetchTradableEvent(
  eventId: string,
): Promise<TradableEvent> {
  const ours = await loadWorldstreetEvents([eventId]);
  const mine = ours.get(eventId);
  if (mine) return fromWorldstreet(mine.event, mine.markets);
  return fromBayse(await fetchBayseEvent(eventId));
}

/** Concurrent Relay reads per batch — see exposure.ts. */
const FETCH_CONCURRENCY = 5;

/**
 * Many events at once, keyed by id. A failed fetch is simply absent
 * from the map: callers report what they know rather than failing a
 * whole page over one unreachable event. Our own events are loaded in
 * a single query, so only Bayse ids cost round trips.
 */
export async function fetchTradableEvents(
  eventIds: string[],
): Promise<Map<string, TradableEvent>> {
  const out = new Map<string, TradableEvent>();

  const ours = await loadWorldstreetEvents(eventIds);
  for (const [eventId, { event, markets }] of ours) {
    out.set(eventId, fromWorldstreet(event, markets));
  }

  const remaining = eventIds.filter((id) => !out.has(id));
  let cursor = 0;
  async function worker() {
    while (cursor < remaining.length) {
      const eventId = remaining[cursor];
      cursor += 1;
      if (!eventId) continue;
      try {
        out.set(eventId, fromBayse(await fetchBayseEvent(eventId)));
      } catch {
        // absent from the map — reported as unreachable
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, remaining.length) }, worker),
  );

  return out;
}

/** The market on an event, or a 404 naming which of the two is missing. */
export function requireMarket(
  event: TradableEvent,
  marketId: string,
): TradableMarket {
  const market = event.markets.find((m) => m.id === marketId);
  if (!market) {
    throw new ApiError(404, "Market not found on this event", "MARKET_NOT_FOUND");
  }
  return market;
}
