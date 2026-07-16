"use client";

import { useMemo, useState } from "react";
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
import { usePageNow } from "@/lib/use-now";
import { CrosshairCursor, ValuePills } from "@/components/chart/crosshair";

/**
 * Hero chart, matched to the real one (recon §9):
 * dense per-pixel stepped series, 2.75px lines, dotted 1×(1,3) gridlines
 * in border-active, dim x labels (neutral-200), y labels every 15% up to
 * the data peak, end dots at 0.6 opacity with a pulse circle.
 */
const POINTS = 448; // ≈ one sample per horizontal pixel, like the real chart

export function HeroChart({
  markets,
  colors,
}: {
  markets: Market[];
  colors: string[];
}) {
  const now = usePageNow();
  const [hovered, setHovered] = useState<Record<string, number> | null>(null);

  const { data, xTicks, yTicks } = useMemo(() => {
    if (now === null) return { data: [], xTicks: [], yTicks: [] as number[] };
    const series = markets.map((m) => getStepSeries(m, POINTS, now));
    const merged = series[0].map((pt, i) => {
      const row: Record<string, number> = { t: pt.t };
      markets.forEach((m, mi) => (row[m.id] = series[mi][i].p));
      return row;
    });
    // weekly labels ~5 days in, snapped to real data points (a category
    // axis drops tick values that don't exist in the data)
    const stepMs = merged[1].t - merged[0].t;
    const day = 86_400_000;
    const ticks: number[] = [];
    for (let k = 0; k < 4; k++) {
      const idx = Math.round(((5 + 7 * k) * day) / stepMs);
      if (merged[idx]) ticks.push(merged[idx].t);
    }
    // y ticks: pick the step (multiple of 5) that lands ≤5 ticks —
    // matches the real axis (peak 58 → step 15, 0–60; peak 64 → step 20, 0–80)
    const peak = Math.max(...series.flat().map((p) => p.p));
    const step = Math.max(5, Math.ceil(peak / 4 / 5) * 5);
    const yMax = Math.ceil(peak / step) * step;
    const ySteps = Array.from({ length: yMax / step + 1 }, (_, i) => i * step);
    return { data: merged, xTicks: ticks, yTicks: ySteps };
  }, [markets, now]);
  const lastIndex = data.length - 1;

  const nameFor = (id: string) =>
    markets.find((m) => m.id === id)?.groupItemTitle ?? "Yes";

  return (
    <div className="flex h-full min-w-0 flex-col pt-10">
      {/* legend tracks hover */}
      <div className="flex gap-4">
        {markets.map((m, i) => (
          <span key={m.id} className="flex items-center gap-1.5 text-[13px] font-semibold">
            <span className="size-2 rounded-full" style={{ background: colors[i] }} />
            <span className="text-secondary">{m.groupItemTitle ?? "Yes"}</span>
            <span className="tabular-nums">
              {(hovered?.[m.id] ?? parseFloat(m.outcomePrices[0]) * 100).toFixed(1)}%
            </span>
          </span>
        ))}
      </div>
      <div className="mt-2 min-h-0 flex-1">
        {now !== null && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 20, right: 0, bottom: 0, left: 8 }}
              onMouseMove={(state) => {
                const i = Number(state?.activeTooltipIndex);
                if (Number.isFinite(i) && data[i]) setHovered(data[i]);
              }}
              onMouseLeave={() => setHovered(null)}
            >
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
                domain={[0, yTicks[yTicks.length - 1] ?? 100]}
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
                content={<ValuePills nameFor={nameFor} />}
                isAnimationActive={false}
              />
              {markets.map((m, i) => (
                <Line
                  key={m.id}
                  dataKey={m.id}
                  type="stepAfter"
                  stroke={colors[i]}
                  strokeWidth={2.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  isAnimationActive={false}
                  activeDot={{ r: 3, fill: colors[i], strokeWidth: 0 }}
                  dot={(props: { index?: number; cx?: number; cy?: number }) =>
                    props.index === lastIndex ? (
                      <EndDot
                        key={`end-${m.id}`}
                        cx={props.cx}
                        cy={props.cy}
                        color={colors[i]}
                      />
                    ) : (
                      <g key={`d-${m.id}-${props.index}`} />
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
 * price updates; ours pings on an idle cycle).
 */
function EndDot({ cx, cy, color }: { cx?: number; cy?: number; color: string }) {
  if (cx === undefined || cy === undefined) return <g />;
  return (
    <g className="pointer-events-none">
      <circle cx={cx} cy={cy} r={4} fill={color} className="animate-hero-ping" />
      <circle cx={cx} cy={cy} r={4} fill={color} opacity={0.6} />
    </g>
  );
}
