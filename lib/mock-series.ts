import type { Market } from "@/types/market";
import { yesProbability } from "@/types/market";

/**
 * Deterministic mock price history: a seeded random walk that ends exactly
 * at the market's current Yes price. Same market + timeframe → same series,
 * so server and client renders always agree.
 */

export type Timeframe = "1H" | "6H" | "1D" | "1W" | "1M" | "ALL";

export const TIMEFRAMES: Timeframe[] = ["1H", "6H", "1D", "1W", "1M", "ALL"];

export interface SeriesPoint {
  /** ms epoch */
  t: number;
  /** probability in percent, 0–100 */
  p: number;
}

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

/** Percentage-point change across the 1D window (for row delta chips). */
export function dayDelta(market: Market): number {
  const s = getSeries(market, "1D");
  return Math.round(s[s.length - 1].p - s[0].p);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
