import type { Market } from "@/types/market";
import { yesProbability } from "@/types/market";
import type { SeriesPoint, Timeframe } from "@/lib/series";

/**
 * Deterministic mock price history: a seeded random walk that ends exactly
 * at the market's current Yes price. Same market + timeframe → same series,
 * so server and client renders always agree.
 *
 * Used only as a fallback now — markets carrying a `clobTokenId` get real
 * history from the CLOB (see lib/polymarket.ts). Fixtures have no token id,
 * so they keep these synthetic curves.
 */

export type { SeriesPoint, Timeframe } from "@/lib/series";
export { TIMEFRAMES } from "@/lib/series";

/** points per window and step duration */
const TF_CONFIG: Record<Timeframe, { points: number; stepMs: number; drift: number }> = {
  "1H": { points: 60, stepMs: 60_000, drift: 0.15 },
  "6H": { points: 72, stepMs: 300_000, drift: 0.3 },
  "1D": { points: 96, stepMs: 900_000, drift: 0.5 },
  "1W": { points: 168, stepMs: 3_600_000, drift: 1.0 },
  "1M": { points: 120, stepMs: 21_600_000, drift: 1.8 },
  ALL: { points: 180, stepMs: 86_400_000, drift: 2.6 },
};

function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Series for a market/timeframe ending at `endTime` (defaults deterministic
 * fixed point so SSR output is stable; pass Date.now() from client code).
 */
export function getSeries(
  market: Market,
  tf: Timeframe,
  endTime: number = 1_750_000_000_000,
): SeriesPoint[] {
  const { points, stepMs, drift } = TF_CONFIG[tf];
  const rand = mulberry32(hashSeed(`${market.id}:${tf}`));
  const end = yesProbability(market) * 100;

  // walk backwards from the known endpoint, then reverse
  const out: SeriesPoint[] = new Array(points);
  let p = end;
  for (let i = points - 1; i >= 0; i--) {
    out[i] = { t: endTime - (points - 1 - i) * stepMs, p };
    // gaussian-ish step via sum of uniforms, slight mean-reversion to 50
    const noise = (rand() + rand() - 1) * drift;
    p = clamp(p + noise + (50 - p) * 0.002, 2, 98);
  }
  return out;
}

/**
 * Percentage-point change over 24h, for the row delta chips.
 *
 * Uses Gamma's real `oneDayPriceChange` when the market has one; only
 * fixtures (and thin live markets Gamma omits the field for) fall back
 * to the synthetic walk. Real moves are usually well under a point, so
 * this rounds to 0 far more often than the mock did — callers already
 * hide the chip at 0.
 */
export function dayDelta(market: Market): number {
  if (typeof market.oneDayPriceChange === "number") {
    return Math.round(market.oneDayPriceChange * 100);
  }
  if (market.clobTokenId) return 0; // live market, genuinely no 24h move
  const s = getSeries(market, "1D");
  return Math.round(s[s.length - 1].p - s[0].p);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Dense stepped series for hero charts, mimicking the real site's
 * per-pixel data: odds hold flat for stretches, then jump (sports-book
 * style). One point per horizontal pixel; ends exactly at the market's
 * current price via a late spike, like live game odds.
 */
export function getStepSeries(
  market: Market,
  points: number,
  endTime: number = 1_750_000_000_000,
  windowMs: number = 30 * 86_400_000,
): SeriesPoint[] {
  const rand = mulberry32(hashSeed(`${market.id}:step`));
  const end = yesProbability(market) * 100;
  const stepMs = windowMs / (points - 1);

  // baseline hovers near the current price so the hero tells the same
  // story as the event-page chart; steps supply the texture, not a cliff
  const base = clamp(end - 3 - rand() * 6, 4, 90);
  const spikeStart = Math.floor(points * (0.93 + rand() * 0.03));

  const out: SeriesPoint[] = new Array(points);
  let level = clamp(base + (rand() - 0.5) * 8, 3, 95);
  let holdLeft = 0;
  for (let i = 0; i < points; i++) {
    if (i >= spikeStart) {
      // sharp move to the final value over the spike zone
      const f = (i - spikeStart) / Math.max(1, points - 1 - spikeStart);
      const eased = f < 0.35 ? f * 2.4 : 0.84 + f * 0.16; // fast jump, brief settle
      level = clamp(base + (end - base) * Math.min(1, eased), 2, 98);
    } else if (holdLeft-- <= 0) {
      // hold flat for a stretch, then step
      holdLeft = 4 + Math.floor(rand() * 26);
      const jump = (rand() - 0.5) * (rand() < 0.12 ? 9 : 2.6); // mostly small, occasionally big
      level = clamp(level + jump + (base - level) * 0.05, 3, 95);
    }
    out[i] = { t: endTime - (points - 1 - i) * stepMs, p: Math.round(level * 10) / 10 };
  }
  out[points - 1].p = Math.round(end * 10) / 10;
  return out;
}
