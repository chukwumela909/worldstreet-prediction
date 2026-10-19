import { ApiError } from "../errors.js";

/**
 * Backend Bayse Relay client — the pricing and resolution oracle for
 * the Local markets book. Every event read here is FRESH (no caching;
 * only the games list behind kickoff times is kept a few minutes): a
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
  /** The winner's outcome id, when Relay provides it. */
  resolvedOutcomeId: string;
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
  /**
   * Kickoff of the game the event is about, ISO. Absent when it isn't a
   * game (a future, a politics market); null when it is one but neither
   * source gave a time. See kickoffOf.
   */
  kickoff?: string | null;
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
  resolvedOutcomeId?: string;
  /** "…originally scheduled for October 20, 2026 at 7:00 PM UTC…" on a game. */
  rules?: string;
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
  /** Set on a game's events (1X2, totals, …): the game in /v1/pm/sports/games. */
  sportGameId?: string;
  markets?: RawMarket[];
}

interface RawGamesPage {
  games?: { id?: string; startDate?: string }[];
  pagination?: { lastPage?: number };
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
      resolvedOutcomeId: m.resolvedOutcomeId ?? "",
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

/** Fresh event state by id — prices, statuses, resolution, kickoff. */
export async function fetchBayseEvent(eventId: string): Promise<BayseEventLive> {
  const raw = await relayGet<RawEvent>(
    `/v1/pm/events/${encodeURIComponent(eventId)}`,
  );
  const live = toLive(raw);
  const kickoff = await kickoffOf(raw);
  return kickoff === undefined ? live : { ...live, kickoff };
}

/* ---------------- kickoff ---------------- */

/*
 * Bayse keeps a game's markets open until three hours after kickoff, so
 * its own closingDate lets bets in all through the match and past full
 * time — when anyone watching knows more than the price we copy. The
 * book stops a game at kickoff instead (routes/trades.ts), as the
 * international book already does with Polymarket's gameStartTime.
 *
 * Two sources, which agreed on every open game when this was written:
 * the start time in Bayse's games list (/v1/pm/sports/games, ~80 games
 * over two pages), and the kickoff written into each market's rules.
 * The earlier one wins — closing early only costs volume.
 */

/** Keep in step with lib/bayse.ts on the web. */
const RULES_KICKOFF = /scheduled for ([A-Z][a-z]+ \d{1,2}, \d{4}) at (\d{1,2}:\d{2} ?[AP]M) UTC/;

/** Kickoff from a market's rules text, epoch ms; NaN when it states none. */
export function kickoffFromRules(rules: string): number {
  const m = RULES_KICKOFF.exec(rules);
  return m ? Date.parse(`${m[1]} ${m[2]} UTC`) : NaN;
}

const GAMES_TTL_MS = 5 * 60_000;
/** After a failed refresh, how soon to try again (keeping what we had). */
const GAMES_RETRY_MS = 30_000;
const MAX_GAME_PAGES = 10;

let games: { starts: Map<string, number>; at: number; ok: boolean } | null = null;
let gamesLoading: Promise<Map<string, number>> | null = null;

/** Game id → kickoff (epoch ms), from Bayse's games list, cached per process. */
async function gameStarts(): Promise<Map<string, number>> {
  if (games && Date.now() - games.at < (games.ok ? GAMES_TTL_MS : GAMES_RETRY_MS)) {
    return games.starts;
  }
  gamesLoading ??= (async () => {
    const starts = new Map<string, number>();
    let ok = true;
    try {
      for (let page = 1; page <= MAX_GAME_PAGES; page++) {
        const res = await relayGet<RawGamesPage>(`/v1/pm/sports/games?page=${page}`);
        for (const g of res.games ?? []) {
          const at = Date.parse(g.startDate ?? "");
          if (g.id && !Number.isNaN(at)) starts.set(g.id, at);
        }
        const last = res.pagination?.lastPage;
        if (typeof last !== "number" || page >= last) break;
      }
    } catch {
      ok = false; // the rules text still stands in
    }
    games = { starts: ok ? starts : (games?.starts ?? starts), at: Date.now(), ok };
    return games.starts;
  })().finally(() => {
    gamesLoading = null;
  });
  return gamesLoading;
}

/**
 * When the event's game kicks off, ISO: undefined for an event that
 * isn't a game, null for a game no source gives a time for.
 */
async function kickoffOf(raw: RawEvent): Promise<string | null | undefined> {
  if (!raw.sportGameId) return undefined;
  const listed = (await gameStarts()).get(raw.sportGameId) ?? NaN;
  const times = [listed, ...(raw.markets ?? []).map((m) => kickoffFromRules(m.rules ?? ""))]
    .filter((t) => !Number.isNaN(t));
  return times.length > 0 ? new Date(Math.min(...times)).toISOString() : null;
}

/**
 * The winning outcome of a resolved market. Relay's `resolvedOutcomeId`
 * is authoritative when present; `resolvedOutcome` (the winner's label
 * uppercased, e.g. "YES", "PORTABLE") is the fallback — but on the
 * countdown series it carries yes/no semantics ("NO" on an Up/Down
 * market), so the id must be tried first. Null when unresolved or
 * neither field matches an outcome.
 */
export function winningOutcome(market: BayseMarketLive): BayseOutcome | null {
  const byId = market.outcomes.find(
    (o) => o.id === market.resolvedOutcomeId,
  );
  if (byId) return byId;
  const winner = market.resolvedOutcome.trim().toUpperCase();
  if (!winner) return null;
  return (
    market.outcomes.find((o) => o.label.trim().toUpperCase() === winner) ?? null
  );
}
