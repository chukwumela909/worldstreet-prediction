"use client";

/**
 * Shared chart crosshair pieces, cloned from Polymarket's hover behavior
 * (recon §9): dashed vertical cursor line with a timestamp label at the
 * top, plus per-series value pills with a colored left bar.
 */

interface CursorPoint {
  x: number;
  y: number;
}

interface CursorPayloadEntry {
  payload?: { t?: number };
}

/** Custom recharts cursor: dashed line + timestamp. */
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
  if (!points?.length) return null;
  const x = points[0].x;
  const t = payload?.[0]?.payload?.t;
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
          x={x}
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

/** Custom recharts tooltip content: stacked value pills. */
export function ValuePills({
  active,
  payload,
  nameFor,
}: {
  active?: boolean;
  payload?: PillEntry[];
  nameFor: (dataKey: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="flex flex-col gap-1">
      {payload.map((entry) => (
        <div
          key={String(entry.dataKey)}
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs font-semibold shadow-md"
        >
          <span
            className="h-3.5 w-[3px] rounded-full"
            style={{ background: entry.stroke ?? entry.color }}
          />
          <span>{nameFor(String(entry.dataKey))}</span>
          <span>
            {typeof entry.value === "number" ? `${entry.value.toFixed(1)}%` : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}
