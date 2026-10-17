import { ApiError } from "../../errors.js";

/**
 * Backend Gamma client — the pricing and resolution oracle for the
 * international (Polymarket) book. Like trading/bayse.ts and unlike the
 * web app's display fetches (lib/polymarket.ts, cached a minute), every
 * call here is FRESH: a stale price on the execution path is money out
 * of the house wallet. Public endpoints, no auth.
 */

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const FETCH_TIMEOUT_MS = 10_000;

/** A Gamma market as it arrives — JSON-in-a-string fields included. */
export interface GammaMarketRaw {
  id: string | number;
  question?: string;
  groupItemTitle?: string;
  /** JSON string, e.g. '["Yes","No"]'. */
  outcomes?: string;
  /** JSON string of decimal strings, e.g. '["0.145","0.855"]'. */
  outcomePrices?: string;
  /** JSON string of the two CLOB token ids — the outcomes' identities. */
  clobTokenIds?: string;
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean;
  /** "resolved" once UMA's answer is final; "proposed"/"disputed" before. */
  umaResolutionStatus?: string;
  /** Sports kickoff, e.g. "2026-10-15 16:45:00+00" — not quite ISO. */
  gameStartTime?: string;
}

export interface GammaEventRaw {
  id: string | number;
  slug: string;
  title: string;
  active?: boolean;
  closed?: boolean;
  endDate?: string;
  markets?: GammaMarketRaw[];
}

async function gammaGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${GAMMA_BASE}${path}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(502, "Polymarket is unreachable", "POLYMARKET_UNAVAILABLE");
  }
  if (res.status === 404) {
    throw new ApiError(404, "Market not found on Polymarket", "MARKET_NOT_FOUND");
  }
  if (!res.ok) {
    throw new ApiError(
      502,
      `Polymarket request failed (${res.status})`,
      "POLYMARKET_UNAVAILABLE",
    );
  }
  return (await res.json()) as T;
}

/** Fresh event state by Gamma id — prices, statuses, resolution. */
export function fetchGammaEvent(eventId: string): Promise<GammaEventRaw> {
  return gammaGet<GammaEventRaw>(`/events/${encodeURIComponent(eventId)}`);
}

/** Parse one of Gamma's JSON-in-a-string array fields; [] if malformed. */
export function parseList(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Gamma's "2026-10-15 16:45:00+00" → epoch ms (NaN when absent/garbled). */
export function parseGammaTime(value: string | undefined): number {
  if (!value) return NaN;
  return Date.parse(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
}
