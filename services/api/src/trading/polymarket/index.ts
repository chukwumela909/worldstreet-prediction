import type { TradableEvent, TradableMarket } from "../events.js";
import {
  fetchGammaEvent,
  parseGammaTime,
  parseList,
  type GammaEventRaw,
  type GammaMarketRaw,
} from "./client.js";
import { defaultSettings } from "../settings.js";
import { buyPriceKobo } from "./pricing.js";
import { finalResolution } from "./resolution.js";

/**
 * The international book: Polymarket events traded against WorldStreet
 * in naira credit, on the same engine as the Local book. Everything
 * Polymarket-specific lives in this folder — the Gamma client, the
 * spread, reading results — and leaves as a TradableEvent, the one shape
 * the trade route, settlement and the desk already work with.
 *
 * Identities: the event and market keep their Gamma ids; each outcome is
 * its CLOB token id, Polymarket's own permanent name for "Yes on this
 * market", which also lets the web app send the same id it reads from
 * Gamma without any mapping.
 */

/** Gamma ids are plain integers; ours and Bayse's are UUIDs. */
export function isPolymarketId(id: string): boolean {
  return /^\d{1,20}$/.test(id);
}

function toMarket(
  raw: GammaMarketRaw,
  now: number,
  spreadBps: number,
): TradableMarket | null {
  const labels = parseList(raw.outcomes);
  const prices = parseList(raw.outcomePrices).map(Number);
  const tokens = parseList(raw.clobTokenIds);
  if (labels.length !== 2 || prices.length !== 2 || tokens.length !== 2) return null;

  const resolution = finalResolution(raw);
  const kickoff = parseGammaTime(raw.gameStartTime);
  // In-play prices move faster than any mirror can follow, so a game's
  // markets stop trading here at kickoff even while Polymarket goes on.
  const started = !Number.isNaN(kickoff) && now >= kickoff;

  const status = resolution
    ? "resolved"
    : raw.closed || raw.active === false || raw.acceptingOrders === false || started
      ? "closed"
      : "open";

  const winner =
    resolution?.kind === "winner"
      ? { id: tokens[resolution.index]!, label: labels[resolution.index]! }
      : null;

  return {
    id: String(raw.id),
    title: raw.groupItemTitle || raw.question || "",
    status,
    outcomes: [0, 1].map((i) => ({
      id: tokens[i]!,
      label: labels[i]!,
      priceKobo: buyPriceKobo(prices[i]!, spreadBps),
    })),
    resolvedOutcomeId: winner?.id ?? null,
    resolvedOutcomeLabel: winner?.label ?? null,
    voided: resolution?.kind === "void",
  };
}

/**
 * One Gamma event as a TradableEvent. `spreadBps` is the desk's current
 * international spread; the env default stands in for callers (tests)
 * that don't pass one.
 */
export function fromPolymarket(
  raw: GammaEventRaw,
  now = Date.now(),
  spreadBps = defaultSettings().polymarketSpreadBps,
): TradableEvent {
  const markets = (raw.markets ?? [])
    .map((m) => toMarket(m, now, spreadBps))
    .filter((m): m is TradableMarket => m !== null);
  return {
    origin: "polymarket",
    id: String(raw.id),
    slug: raw.slug,
    title: raw.title,
    status: raw.closed || raw.active === false ? "closed" : "open",
    // Gamma's endDate is when the question is expected to be decided —
    // for a game it IS kickoff — so trading stops there.
    closingDate: raw.endDate ?? "",
    resolutionDate: raw.endDate ?? "",
    countdown: false,
    markets,
  };
}

/** Fresh state for one international event, at source. */
export async function fetchPolymarketEvent(eventId: string): Promise<TradableEvent> {
  // Polymarket's own price — the house margin (base + auto-rise) is added
  // when an order is priced (trading/margin.ts), the same on every book
  return fromPolymarket(await fetchGammaEvent(eventId), Date.now(), 0);
}
