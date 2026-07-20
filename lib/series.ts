/**
 * Shared price-series vocabulary for both real (CLOB) and synthetic
 * (mock-series) history, so charts can consume either interchangeably.
 */

export interface SeriesPoint {
  /** ms epoch */
  t: number;
  /** probability in percent, 0–100 */
  p: number;
}

export type Timeframe = "1H" | "6H" | "1D" | "1W" | "1M" | "ALL";

export const TIMEFRAMES: Timeframe[] = ["1H", "6H", "1D", "1W", "1M", "ALL"];

/**
 * Windows we can request history for: the user-facing timeframes plus
 * "HERO", the dense ~1-month window the hero chart draws.
 */
export type HistoryWindow = Timeframe | "HERO";

/**
 * Merge per-market series onto one timestamp grid keyed by market id.
 *
 * Real CLOB series are NOT index-aligned across markets — a market
 * listed later has fewer points, and timestamps drift between tokens —
 * so merging by array index (what the synthetic series allowed) would
 * plot one market's price against another's timestamp. This unions all
 * timestamps and forward-fills each market's last known price, leaving
 * gaps before a market's first point undefined so its line starts where
 * its data does.
 */
export function mergeSeries(
  entries: { id: string; points: SeriesPoint[] }[],
): { t: number; [id: string]: number }[] {
  const withData = entries.filter((e) => e.points.length > 0);
  if (withData.length === 0) return [];

  // The CLOB samples each token independently, so the "same" point can
  // differ by a few seconds between markets. Bucketing to half the
  // sampling step collapses those into one row — without it the union
  // multiplies rows by the number of series and leaves every line but
  // the earliest with a gap at the left edge.
  const bucket = Math.max(1, samplingStep(withData[0].points) / 2);
  const snap = (t: number) => Math.round(t / bucket) * bucket;

  const stamps = [
    ...new Set(withData.flatMap((e) => e.points.map((p) => snap(p.t)))),
  ].sort((a, b) => a - b);

  // one cursor per series; each advances monotonically across the grid
  const cursors = new Map(withData.map((e) => [e.id, 0]));

  return stamps.map((t) => {
    const row: { t: number; [id: string]: number } = { t };
    for (const { id, points } of withData) {
      let i = cursors.get(id)!;
      while (i + 1 < points.length && snap(points[i + 1].t) <= t) i++;
      cursors.set(id, i);
      // leave undefined until this series actually starts, so a market
      // listed later begins its line where its data does
      if (snap(points[i].t) <= t) row[id] = points[i].p;
    }
    return row;
  });
}

/** Median gap between consecutive points — robust to irregular sampling. */
function samplingStep(points: SeriesPoint[]): number {
  if (points.length < 2) return 1;
  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) gaps.push(points[i].t - points[i - 1].t);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] || 1;
}
