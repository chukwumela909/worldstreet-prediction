import { ApiError } from "../errors.js";

/**
 * Backend Bayse Relay client — the pricing and resolution oracle for
 * the Local markets book. Every call here is FRESH (no caching): a
 * stale price on the execution path is money out of the house wallet,
 * unlike the web app's display fetches (lib/bayse.ts) which cache for
 * a minute. Public endpoints, no auth.
 */

const RELAY_BASE = "https://relay.bayse.markets";
const FETCH_TIMEOUT_MS = 10_000;

export interface BayseOutcome {
  id: string;
  label: string;
  /** Probability price in [0, 1]. */
  price: number;
}

export interface BayseMarketLive {
  id: string;
  title: string;
  status: string;
  outcomes: [BayseOutcome, BayseOutcome];
  /** Uppercased winning label ("YES", "PORTABLE") once resolved. */
  resolvedOutcome: string;
}

export interface BayseEventLive {
  id: string;
  slug: string;
  title: string;
  status: string;
  /** ISO or "" — countdown/auto markets carry a real closingDate. */
  closingDate: string;
  resolutionDate: string;
  /** True on the automated short-cycle series (15-min crypto etc.). */
  countdown: boolean;
  markets: BayseMarketLive[];
}

interface RawMarket {
  id: string;
  title: string;
  status?: string;
  outcome1Id?: string;
  outcome1Label?: string;
  outcome1Price?: number;
  outcome2Id?: string;
  outcome2Label?: string;
  outcome2Price?: number;
  resolvedOutcome?: string;
}

interface RawEvent {
  id: string;
  slug: string;
  title: string;
  status?: string;
  closingDate?: string;
  resolutionDate?: string;
  displayCountdown?: boolean;
  countdownType?: string;
  markets?: RawMarket[];
}

function toLive(raw: RawEvent): BayseEventLive {
  const markets: BayseMarketLive[] = [];
  for (const m of raw.markets ?? []) {
    if (
      !m.outcome1Id ||
      !m.outcome2Id ||
      typeof m.outcome1Price !== "number" ||
      typeof m.outcome2Price !== "number"
    ) {
      continue;
    }
    markets.push({
      id: m.id,
      title: m.title,
      status: m.status ?? "open",
      resolvedOutcome: m.resolvedOutcome ?? "",
      outcomes: [
        { id: m.outcome1Id, label: m.outcome1Label || "Yes", price: m.outcome1Price },
        { id: m.outcome2Id, label: m.outcome2Label || "No", price: m.outcome2Price },
      ],
    });
  }
  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    status: raw.status ?? "open",
    closingDate: raw.closingDate ?? "",
    resolutionDate: raw.resolutionDate ?? "",
    countdown: Boolean(raw.displayCountdown || raw.countdownType),
    markets,
  };
}

async function relayGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${RELAY_BASE}${path}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(502, "Bayse is unreachable", "BAYSE_UNAVAILABLE");
  }
  if (res.status === 404) {
    throw new ApiError(404, "Market not found on Bayse", "MARKET_NOT_FOUND");
  }
  if (!res.ok) {
    throw new ApiError(502, `Bayse request failed (${res.status})`, "BAYSE_UNAVAILABLE");
  }
  return (await res.json()) as T;
}

/** Fresh event state by id — prices, statuses, resolution. */
export async function fetchBayseEvent(eventId: string): Promise<BayseEventLive> {
  const raw = await relayGet<RawEvent>(
    `/v1/pm/events/${encodeURIComponent(eventId)}`,
  );
  return toLive(raw);
}

/**
 * The winning outcome of a resolved market, matched by label —
 * Relay reports `resolvedOutcome` as the winner's label uppercased
 * (e.g. "YES", "NO", "PORTABLE"). Null when unresolved or unmatched.
 */
export function winningOutcome(market: BayseMarketLive): BayseOutcome | null {
  const winner = market.resolvedOutcome.trim().toUpperCase();
  if (!winner) return null;
  return (
    market.outcomes.find((o) => o.label.trim().toUpperCase() === winner) ?? null
  );
}
