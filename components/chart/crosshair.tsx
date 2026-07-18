"use client";

import { useEffect } from "react";
import {
  useActiveTooltipCoordinate,
  useActiveTooltipDataPoints,
  useIsTooltipActive,
  usePlotArea,
} from "recharts";

/**
 * Shared chart hover pieces, cloned from Polymarket's behavior (recon §9 +
 * hover screenshots 2026-07-18): hovering "rewinds" the chart — solid
 * lines truncate at the cursor with the future ghosted, endpoint dots
 * travel to the hover point, and per-series value pills anchor to each
 * line's y-position (collision-stacked), with a timestamp on the cursor.
 *
 * Truncation works via SVG clipPaths driven by recharts' public hooks
 * (HoverClip), not by mutating chart data: each series renders twice —
 * a "solid" line clipped to the left of the cursor and a faint "ghost"
 * line clipped to the right. HoverBridge mirrors the active row into
 * parent state for legends rendered outside the chart context.
 */

/** Prefix for the faint full-history ghost copy of a series. */
export const GHOST = "g:";

export type ChartRow = Record<string, number | null>;

/**
 * Renders the two clipPaths inside the chart's SVG. Give the solid
 * Lines `className={`${id}-s`}` and the ghost Lines `className={`${id}-g`}`
 * and mount the matching <ClipStyles> next to the chart.
 */
export function HoverClip({ id }: { id: string }) {
  const plot = usePlotArea();
  const coord = useActiveTooltipCoordinate();
  const active = useIsTooltipActive();
  if (!plot) return null;
  const right = plot.x + plot.width;
  const cut =
    active && coord ? Math.min(Math.max(coord.x, plot.x), right) : right;
  const top = 0;
  const bottom = plot.y + plot.height + 8; // headroom for round line caps
  return (
    <defs>
      <clipPath id={`${id}-solid`}>
        <rect
          x={plot.x - 8}
          y={top}
          width={cut - plot.x + 10}
          height={bottom}
        />
      </clipPath>
      <clipPath id={`${id}-ghost`}>
        <rect
          x={cut + 2}
          y={top}
          width={Math.max(0, right - cut - 2) + 8}
          height={bottom}
        />
      </clipPath>
    </defs>
  );
}

/** CSS hooking the clip ids to the Line layer classes. */
export function ClipStyles({ id }: { id: string }) {
  return (
    <style>{`.${id}-s{clip-path:url(#${id}-solid)}.${id}-g{clip-path:url(#${id}-ghost)}`}</style>
  );
}

/**
 * Mirrors the hovered data row (or null) into parent state so legends
 * outside the chart can live-update. Renders nothing.
 */
export function HoverBridge({
  onChange,
}: {
  onChange: (row: ChartRow | null) => void;
}) {
  const points = useActiveTooltipDataPoints<ChartRow>();
  const active = useIsTooltipActive();
  const row = active && points?.length ? points[0] : null;
  useEffect(() => {
    onChange(row);
  }, [row, onChange]);
  return null;
}

interface CursorPoint {
  x: number;
  y: number;
}

interface CursorPayloadEntry {
  payload?: { t?: number };
}

/** Custom recharts cursor: dashed line + timestamp riding the crosshair. */
export function CrosshairCursor({
  points,
  top = 0,
  height = 0,
  payload,
  formatTimestamp,
}: {
  points?: CursorPoint[];
  top?: number;
  height?: number;
  payload?: CursorPayloadEntry[];
  formatTimestamp?: (t: number) => string;
}) {
  const plot = usePlotArea();
  if (!points?.length) return null;
  const x = points[0].x;
  const t = payload?.[0]?.payload?.t;
  // keep the centered label inside the plot near the edges
  const labelX = plot
    ? Math.min(Math.max(x, plot.x + 48), plot.x + plot.width - 48)
    : x;
  return (
    <g>
      <line
        x1={x}
        x2={x}
        y1={top}
        y2={top + height}
        stroke="var(--border-active)"
        strokeDasharray="3 3"
        strokeWidth={1}
      />
      {t !== undefined && formatTimestamp && (
        <text
          x={labelX}
          y={top + 4}
          textAnchor="middle"
          fill="var(--neutral-500)"
          fontSize={12}
          fontWeight={500}
        >
          {formatTimestamp(t)}
        </text>
      )}
    </g>
  );
}

interface PillEntry {
  dataKey?: string | number;
  value?: number | string;
  stroke?: string;
  color?: string;
}

const PILL_H = 26; // pill height + gap used for collision stacking
const PILL_W = 120; // estimated width used to flip near the right edge

/**
 * Value pills anchored to the lines like the real site: each pill sits
 * just right of the hover point at its own series' y (flipping to the
 * left near the right edge), stacked apart when they'd overlap.
 * Requires Tooltip position={{x:0,y:0}} so the wrapper sits at the
 * chart origin and these absolute coordinates are container-relative.
 */
export function AnchoredPills({
  active,
  payload,
  nameFor,
  yMax,
}: {
  active?: boolean;
  payload?: PillEntry[];
  nameFor: (dataKey: string) => string;
  yMax: number;
}) {
  const plot = usePlotArea();
  const coord = useActiveTooltipCoordinate();
  if (!active || !payload?.length || !plot) return null;
  const entries = payload.filter(
    (e) => !String(e.dataKey).startsWith(GHOST) && typeof e.value === "number",
  );
  if (!entries.length) return null;

  const cursorX = coord?.x ?? plot.x;
  // flip to the left of the point when the pills would overflow the plot
  const flip = cursorX + 10 + PILL_W > plot.x + plot.width;
  const left = flip ? cursorX - 10 : cursorX + 10;
  const transform = flip ? "translate(-100%, -50%)" : "translateY(-50%)";

  // anchor each pill at its line's pixel y, then push overlaps apart
  const placed = entries
    .map((e) => ({
      entry: e,
      y: plot.y + plot.height * (1 - (e.value as number) / yMax),
    }))
    .sort((a, b) => a.y - b.y);
  for (let i = 0; i < placed.length; i++) {
    const minY = i === 0 ? plot.y + PILL_H / 2 : placed[i - 1].y + PILL_H;
    placed[i].y = Math.max(placed[i].y, minY);
  }
  // if the stack ran past the bottom, shift it back up as one block
  const overflow =
    placed[placed.length - 1].y - (plot.y + plot.height - PILL_H / 2);
  if (overflow > 0) for (const p of placed) p.y -= overflow;

  return (
    <>
      {placed.map(({ entry, y }) => (
        <div
          key={String(entry.dataKey)}
          className="pointer-events-none absolute flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs font-semibold shadow-md"
          style={{ left, top: y, transform }}
        >
          <span
            className="h-3.5 w-[3px] rounded-full"
            style={{ background: entry.stroke ?? entry.color }}
          />
          <span>{nameFor(String(entry.dataKey))}</span>
          <span className="tabular-nums">
            {(entry.value as number).toFixed(1)}%
          </span>
        </div>
      ))}
    </>
  );
}
