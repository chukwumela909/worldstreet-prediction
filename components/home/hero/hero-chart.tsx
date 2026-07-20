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
import { getStepSeries } from "@/lib/mock-series";
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
 * one-decimal (rest) to whole-percent (hover) values. Seeded "+$N"
 * trade markers sit on the lines like the live site's trade blips.
 */
const POINTS = 448; // ≈ one sample per horizontal pixel, like the real chart
const GHOST_OPACITY = 0.14;
const MARKER_AMOUNTS = [2, 5, 10, 25, 52, 100, 250];

export function HeroChart({
  markets,
  colors,
}: {
  markets: Market[];
  colors: string[];
}) {
  const now = usePageNow();
  const [hoverRow, setHoverRow] = useState<ChartRow | null>(null);
  const onHover = useCallback((row: ChartRow | null) => setHoverRow(row), []);
  const clipId = "hc" + useId().replace(/[^a-zA-Z0-9]/g, "");

  const history = usePriceHistory(markets, "HERO");

  const { data, xTicks, yTicks } = useMemo(() => {
    if (now === null)
      return { data: [] as ChartRow[], xTicks: [], yTicks: [] as number[] };

    // real CLOB history where available; see PriceChart for why loading
    // renders empty rather than falling back to the synthetic walk
    const series = markets.map((m) => {
      const real = history.byMarket[m.id];
      if (real) return real;
      if (m.clobTokenId && history.loading) return [];
      return getStepSeries(m, POINTS, now);
    });

    const merged: ChartRow[] = mergeSeries(
      markets.map((m, i) => ({ id: m.id, points: series[i] })),
    ).map((row) => {
      const out: ChartRow = { t: row.t };
      for (const m of markets) {
        const v = row[m.id];
        if (typeof v !== "number") continue;
        out[m.id] = v;
        out[GHOST + m.id] = v; // ghost copy under the solid line
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
  }, [markets, now, history.byMarket, history.loading]);

  const lastIndex = data.length - 1;
  const yMax = yTicks[yTicks.length - 1] ?? 100;

  /**
   * Seeded "+$N" trade blips, drawn only over the synthetic series.
   * They're invented trades — showing them on real CLOB history would
   * present fabricated activity as market data. `index: -1` disables.
   */
  const markers = useMemo(
    () =>
      markets.map((m, i) => {
        if (history.real) return { index: -1, amount: 0 };
        let h = 0;
        for (let c = 0; c < m.id.length; c++) h = (h * 31 + m.id.charCodeAt(c)) % 99991;
        return {
          index: Math.floor(POINTS * (0.08 + ((h % 47) / 47) * 0.45)) + i * 9,
          amount: MARKER_AMOUNTS[(h + i * 3) % MARKER_AMOUNTS.length],
        };
      }),
    [markets, history.real],
  );

  const nameFor = (id: string) =>
    markets.find((m) => m.id === id)?.groupItemTitle ?? "Yes";

  const legendValue = (m: Market) => {
    const v = hoverRow?.[m.id];
    // hovered legend rounds to whole percents, like the real site
    if (typeof v === "number") return `${Math.round(v)}%`;
    return `${(parseFloat(m.outcomePrices[0]) * 100).toFixed(1)}%`;
  };

  return (
    <div className="flex h-full min-w-0 flex-col pt-10">
      <ClipStyles id={clipId} />
      {/* legend tracks hover (integers while hovering, decimals at rest) */}
      <div className="flex gap-4">
        {markets.map((m, i) => (
          <span key={m.id} className="flex items-center gap-1.5 text-[13px] font-semibold">
            <span className="size-2 rounded-full" style={{ background: colors[i] }} />
            <span className="text-secondary">{m.groupItemTitle ?? "Yes"}</span>
            <span className="tabular-nums">{legendValue(m)}</span>
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
              {markets.map((m, i) => (
                <Line
                  key={GHOST + m.id}
                  className={`${clipId}-g`}
                  dataKey={GHOST + m.id}
                  type="stepAfter"
                  stroke={colors[i]}
                  strokeWidth={2.75}
                  strokeOpacity={GHOST_OPACITY}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  isAnimationActive={false}
                  activeDot={false}
                  dot={(props: { index?: number; cx?: number; cy?: number }) =>
                    props.index === markers[i].index ? (
                      <TradeMarker
                        key={`gmk-${m.id}`}
                        cx={props.cx}
                        cy={props.cy}
                        color={colors[i]}
                        amount={markers[i].amount}
                        opacity={GHOST_OPACITY}
                        clip={`url(#${clipId}-ghost)`}
                      />
                    ) : (
                      <g key={`gd-${m.id}-${props.index}`} />
                    )
                  }
                />
              ))}
              {/* solid layer: clipped to the left of the cursor while hovering */}
              {markets.map((m, i) => (
                <Line
                  key={m.id}
                  className={`${clipId}-s`}
                  dataKey={m.id}
                  type="stepAfter"
                  stroke={colors[i]}
                  strokeWidth={2.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  isAnimationActive={false}
                  activeDot={{ r: 4, fill: colors[i], strokeWidth: 0 }}
                  dot={(props: { index?: number; cx?: number; cy?: number }) => {
                    if (props.index === lastIndex)
                      return (
                        <EndDot
                          key={`end-${m.id}`}
                          cx={props.cx}
                          cy={props.cy}
                          color={colors[i]}
                          clip={`url(#${clipId}-solid)`}
                        />
                      );
                    if (props.index === markers[i].index)
                      return (
                        <TradeMarker
                          key={`mk-${m.id}`}
                          cx={props.cx}
                          cy={props.cy}
                          color={colors[i]}
                          amount={markers[i].amount}
                          clip={`url(#${clipId}-solid)`}
                        />
                      );
                    return <g key={`d-${m.id}-${props.index}`} />;
                  }}
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

/** "+ $N" trade blip pinned to a point on the line, in the series color. */
function TradeMarker({
  cx,
  cy,
  color,
  amount,
  opacity = 1,
  clip,
}: {
  cx?: number;
  cy?: number;
  color: string;
  amount: number;
  opacity?: number;
  clip?: string;
}) {
  if (cx === undefined || cy === undefined) return <g />;
  return (
    <g className="pointer-events-none" clipPath={clip}>
      <text
        x={cx - 6}
        y={cy + 20}
        fill={color}
        opacity={opacity}
        fontSize={15}
        fontWeight={600}
      >
        + ${amount}
      </text>
    </g>
  );
}
