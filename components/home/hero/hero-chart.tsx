"use client";

import { useCallback, useId, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Market } from "@/types/market";
import { mergeSeries } from "@/lib/series";
import { usePriceHistory } from "@/lib/use-price-history";
import { usePageNow } from "@/lib/use-now";
import {
  AnchoredPills,
  ClipStyles,
  CrosshairCursor,
  GHOST,
  HoverBridge,
  HoverClip,
  type ChartRow,
} from "@/components/chart/crosshair";

/**
 * Hero chart, matched to the real one (recon §9 + hover screenshots):
 * dense per-pixel stepped series, 2.75px lines, dotted gridlines, end
 * dots with a pulse. Hovering rewinds the chart — solid lines clip at
 * the cursor with the future ghosted underneath, the dots travel to the
 * hover point, pills anchor to the lines, and the legend switches from
 * one-decimal (rest) to whole-percent (hover) values.
 */
const GHOST_OPACITY = 0.14;

/** Id suffix of the derived complement line (a binary's No side). */
const COMPLEMENT = ":no";

/** One drawn line: a market's Yes price, or a binary's derived No. */
interface ChartLine {
  id: string;
  label: string;
  color: string;
  /** Current price in percent, for the legend at rest. */
  pct: number;
}

export function HeroChart({
  markets,
  colors,
  complement,
}: {
  markets: Market[];
  colors: string[];
  /**
   * Also draw the first market's No side (100 - Yes): the category
   * page's binary featured card shows both lines, like the reference.
   */
  complement?: { label: string; color: string };
}) {
  const now = usePageNow();
  const [hoverRow, setHoverRow] = useState<ChartRow | null>(null);
  const onHover = useCallback((row: ChartRow | null) => setHoverRow(row), []);
  const clipId = "hc" + useId().replace(/[^a-zA-Z0-9]/g, "");

  const history = usePriceHistory(markets, "HERO");

  const lines = useMemo<ChartLine[]>(() => {
    const out = markets.map((m, i) => ({
      id: m.id,
      label: m.groupItemTitle ?? m.outcomeLabels?.[0] ?? "Yes",
      color: colors[i],
      pct: parseFloat(m.outcomePrices[0]) * 100,
    }));
    const first = markets[0];
    if (complement && first)
      out.push({
        id: first.id + COMPLEMENT,
        label: complement.label,
        color: complement.color,
        pct: parseFloat(first.outcomePrices[1]) * 100,
      });
    return out;
  }, [markets, colors, complement]);

  const { data, xTicks, yTicks } = useMemo(() => {
    if (now === null)
      return { data: [] as ChartRow[], xTicks: [], yTicks: [] as number[] };

    // real CLOB history only — while it loads (or if the fetch fails)
    // the chart stays empty rather than plotting an invented curve. The
    // complement mirrors the first market's own history; no extra fetch.
    const series = lines.map((line) =>
      line.id.endsWith(COMPLEMENT)
        ? (history.byMarket[line.id.slice(0, -COMPLEMENT.length)] ?? []).map((pt) => ({
            ...pt,
            p: 100 - pt.p,
          }))
        : (history.byMarket[line.id] ?? []),
    );

    const merged: ChartRow[] = mergeSeries(
      lines.map((line, i) => ({ id: line.id, points: series[i] })),
    ).map((row) => {
      const out: ChartRow = { t: row.t };
      for (const line of lines) {
        const v = row[line.id];
        if (typeof v !== "number") continue;
        out[line.id] = v;
        out[GHOST + line.id] = v; // ghost copy under the solid line
      }
      return out;
    });
    if (merged.length === 0)
      return { data: [] as ChartRow[], xTicks: [], yTicks: [] as number[] };

    // four labels evenly spaced across the actual time span, snapped to
    // real rows (a category axis drops ticks that aren't in the data).
    // Derived from the span rather than a fixed step, since real series
    // are not uniformly sampled.
    const ticks: number[] = [];
    for (let k = 1; k <= 4; k++) {
      const idx = Math.round((merged.length - 1) * (k / 5));
      const t = merged[idx]?.t as number | undefined;
      if (t !== undefined && !ticks.includes(t)) ticks.push(t);
    }
    // y ticks: pick the step (multiple of 5) that lands ≤5 ticks —
    // matches the real axis (peak 58 → step 15, 0–60; peak 64 → step 20, 0–80)
    const peak = Math.max(...series.flat().map((p) => p.p));
    const step = Math.max(5, Math.ceil(peak / 4 / 5) * 5);
    const yMax = Math.ceil(peak / step) * step;
    const ySteps = Array.from({ length: yMax / step + 1 }, (_, i) => i * step);
    return { data: merged, xTicks: ticks, yTicks: ySteps };
  }, [lines, now, history.byMarket]);

  const lastIndex = data.length - 1;
  const yMax = yTicks[yTicks.length - 1] ?? 100;

  const nameFor = (id: string) => lines.find((line) => line.id === id)?.label ?? "Yes";

  const legendValue = (line: ChartLine) => {
    const v = hoverRow?.[line.id];
    // hovered legend rounds to whole percents, like the real site
    if (typeof v === "number") return `${Math.round(v)}%`;
    return `${line.pct.toFixed(1)}%`;
  };

  return (
    <div className="flex h-full min-w-0 flex-col pt-10">
      <ClipStyles id={clipId} />
      {/* legend tracks hover (integers while hovering, decimals at rest) */}
      <div className="flex gap-4">
        {lines.map((line) => (
          <span key={line.id} className="flex items-center gap-1.5 text-[13px] font-semibold">
            <span className="size-2 rounded-full" style={{ background: line.color }} />
            <span className="text-secondary">{line.label}</span>
            <span className="tabular-nums">{legendValue(line)}</span>
          </span>
        ))}
      </div>
      <div className="mt-2 min-h-0 flex-1">
        {now !== null && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 20, right: 0, bottom: 0, left: 8 }}>
              <HoverClip id={clipId} />
              <HoverBridge onChange={onHover} />
              <CartesianGrid
                horizontal
                vertical={false}
                strokeDasharray="1 3"
                stroke="var(--border-active)"
              />
              <XAxis
                dataKey="t"
                ticks={xTicks}
                interval={0}
                tickFormatter={(t: number) =>
                  new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                }
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--neutral-200)", fontSize: 12, fontWeight: 450 }}
              />
              <YAxis
                orientation="right"
                domain={[0, yMax]}
                ticks={yTicks}
                tickFormatter={(p: number) => `${Math.round(p)}%`}
                width={40}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--neutral-500)", fontSize: 12, fontWeight: 450 }}
              />
              <Tooltip
                cursor={
                  <CrosshairCursor
                    formatTimestamp={(t) =>
                      new Date(t).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    }
                  />
                }
                content={<AnchoredPills nameFor={nameFor} yMax={yMax} />}
                position={{ x: 0, y: 0 }}
                isAnimationActive={false}
              />
              {/* ghost layer: clipped to the right of the cursor while hovering */}
              {lines.map((line) => (
                <Line
                  key={GHOST + line.id}
                  className={`${clipId}-g`}
                  dataKey={GHOST + line.id}
                  type="stepAfter"
                  stroke={line.color}
                  strokeWidth={2.75}
                  strokeOpacity={GHOST_OPACITY}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  isAnimationActive={false}
                  activeDot={false}
                  dot={false}
                />
              ))}
              {/* solid layer: clipped to the left of the cursor while hovering */}
              {lines.map((line) => (
                <Line
                  key={line.id}
                  className={`${clipId}-s`}
                  dataKey={line.id}
                  type="stepAfter"
                  stroke={line.color}
                  strokeWidth={2.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  isAnimationActive={false}
                  activeDot={{ r: 4, fill: line.color, strokeWidth: 0 }}
                  dot={(props: { index?: number; cx?: number; cy?: number }) =>
                    props.index === lastIndex ? (
                      <EndDot
                        key={`end-${line.id}`}
                        cx={props.cx}
                        cy={props.cy}
                        color={line.color}
                        clip={`url(#${clipId}-solid)`}
                      />
                    ) : (
                      <g key={`d-${line.id}-${props.index}`} />
                    )
                  }
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

/**
 * End-of-line marker, exactly the real structure: a persistent r=4 dot at
 * 0.6 opacity plus a second circle that pulses (theirs pings on live
 * price updates; ours pings on an idle cycle). Lives on the solid layer,
 * so the clip hides it while hovering — the traveling activeDot takes
 * over as the line's "live edge".
 */
function EndDot({
  cx,
  cy,
  color,
  clip,
}: {
  cx?: number;
  cy?: number;
  color: string;
  clip?: string;
}) {
  if (cx === undefined || cy === undefined) return <g />;
  return (
    <g className="pointer-events-none" clipPath={clip}>
      <circle cx={cx} cy={cy} r={4} fill={color} className="animate-hero-ping" />
      <circle cx={cx} cy={cy} r={4} fill={color} opacity={0.6} />
    </g>
  );
}
