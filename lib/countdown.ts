import type { MarketEvent } from "@/types/market";

/**
 * When a Local market stops accepting trades, and how to say it.
 *
 * Two things close a market: its closing time, and — on Bayse's
 * automated short-cycle series — a cutoff before that, since a
 * nearly-decided 15-minute market is pure adverse selection. The
 * deadline that matters to a trader is the earlier one, so that's what
 * every countdown in the UI counts to.
 */

/**
 * How long before a countdown market closes it stops taking trades.
 * Mirrors the server's TRADE_COUNTDOWN_CUTOFF_SECONDS default; the
 * server still enforces it, so a changed env var costs a rejected order
 * rather than money.
 */
export const COUNTDOWN_CUTOFF_MS = 90_000;

/** Below this, a plain end date is no longer useful — show the clock. */
export const COUNTDOWN_VISIBLE_MS = 60 * 60_000;

/** Epoch ms when trading stops, or null when the event has no close time. */
export function tradingStopsAt(event: MarketEvent): number | null {
  if (!event.closesAt) return null;
  const closesMs = Date.parse(event.closesAt);
  if (Number.isNaN(closesMs)) return null;
  return closesMs - (event.countdown ? COUNTDOWN_CUTOFF_MS : 0);
}

/**
 * Whether to show a live countdown rather than a date: always for the
 * automated series, and for anything else once it's within the hour.
 */
export function showsCountdown(event: MarketEvent, msLeft: number): boolean {
  return Boolean(event.countdown) || msLeft < COUNTDOWN_VISIBLE_MS;
}

/** "2d 4h", "3h 12m", "4m 12s", "42s" — one step below the lead unit. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
