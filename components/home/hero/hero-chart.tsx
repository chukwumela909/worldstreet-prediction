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
import { getSeries } from "@/lib/mock-series";
import { usePageNow } from "@/lib/use-now";
import { CrosshairCursor, ValuePills } from "@/components/chart/crosshair";

/**
 * Hero chart with legend that live-updates to the hovered point,
 * dashed crosshair + timestamp, end dots — per recon §9.
 */
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
    const series = markets.map((m) => getSeries(m, "1M", now));
    const merged = series[0].map((pt, i) => {
      const row: Record<string, number> = { t: pt.t };
      markets.forEach((m, mi) => (row[m.id] = series[mi][i].p));
      return row;
    });
    const first = merged[0].t;
    const last = merged[merged.length - 1].t;
    const week = 7 * 86_400_000;
    const ticks: number[] = [];
    for (let t = first + week / 2; t < last - week / 4; t += week) ticks.push(t);
    const peak = Math.max(...series.flat().map((p) => p.p));
    const yMax = Math.ceil((peak * 1.05) / 15) * 15;
    const ySteps = Array.from({ length: yMax / 15 + 1 }, (_, i) => i * 15);
    return { data: merged, xTicks: ticks, yTicks: ySteps };
  }, [markets, now]);
  const lastIndex = data.length - 1;

  const nameFor = (id: string) =>
    markets.find((m) => m.id === id)?.groupItemTitle ?? "Yes";

  return (
    <div className="flex min-w-0 flex-1 flex-col pt-10">
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
                strokeDasharray="2 4"
                stroke="var(--border-default)"
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
                tick={{ fill: "var(--neutral-300)", fontSize: 12, fontWeight: 500 }}
              />
              <YAxis
                orientation="right"
                domain={[0, yTicks[yTicks.length - 1] ?? 100]}
                ticks={yTicks}
                tickFormatter={(p: number) => `${Math.round(p)}%`}
                width={40}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--neutral-300)", fontSize: 12, fontWeight: 500 }}
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
                  type="monotone"
                  stroke={colors[i]}
                  strokeWidth={2}
                  isAnimationActive={false}
                  activeDot={{ r: 3, fill: colors[i], strokeWidth: 0 }}
                  dot={(props: { index?: number; cx?: number; cy?: number }) =>
                    props.index === lastIndex ? (
                      <circle
                        key={`end-${m.id}`}
                        cx={props.cx}
                        cy={props.cy}
                        r={4}
                        fill={colors[i]}
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
