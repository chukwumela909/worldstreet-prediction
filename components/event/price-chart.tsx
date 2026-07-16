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
import { ChevronDown, ChevronUp } from "lucide-react";
import { isBinary, type MarketEvent } from "@/types/market";
import { toPercent } from "@/lib/format";
import { getSeries, TIMEFRAMES, type Timeframe } from "@/lib/mock-series";
import { usePageNow } from "@/lib/use-now";
import { CrosshairCursor, ValuePills } from "@/components/chart/crosshair";

const LINE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];
const MAX_LINES = 3;

/**
 * Probability-over-time chart with timeframe toggles and the measured
 * crosshair behavior (recon §9): dashed cursor + timestamp, value pills,
 * legend / chance header live-updating to the hovered point.
 */
export function PriceChart({ event }: { event: MarketEvent }) {
  const [tf, setTf] = useState<Timeframe>("ALL");
  const endTime = usePageNow();
  const [hovered, setHovered] = useState<Record<string, number> | null>(null);

  const markets = event.markets.slice(0, MAX_LINES);
  const binary = isBinary(event);

  const { data, deltas } = useMemo(() => {
    if (endTime === null) return { data: [], deltas: [] as number[] };
    const series = markets.map((m) => getSeries(m, tf, endTime));
    const merged = series[0].map((pt, i) => {
      const row: Record<string, number> = { t: pt.t };
      markets.forEach((m, mi) => {
        row[m.id] = Math.round(series[mi][i].p * 10) / 10;
      });
      return row;
    });
    const ds = series.map((s) => Math.round(s[s.length - 1].p - s[0].p));
    return { data: merged, deltas: ds };
  }, [markets, tf, endTime]);

  // explicit ticks: first point of each distinct label, thinned to ≤7
  const ticks = useMemo(() => {
    if (!data.length) return undefined;
    const firsts: number[] = [];
    let last = "";
    for (const row of data) {
      const label = formatTick(row.t, tf);
      if (label !== last) {
        firsts.push(row.t);
        last = label;
      }
    }
    const MAX_TICKS = 7;
    if (firsts.length <= MAX_TICKS) return firsts;
    const step = Math.ceil(firsts.length / MAX_TICKS);
    return firsts.filter((_, i) => i % step === 0);
  }, [data, tf]);

  const nameFor = (id: string) =>
    markets.find((m) => m.id === id)?.groupItemTitle ?? "Yes";

  const displayPct = (m: (typeof markets)[number]) =>
    hovered?.[m.id] ?? toPercent(m.outcomePrices[0]);

  return (
    <div>
      {/* legend / chance header tracks hover */}
      {binary ? (
        <ChanceHeader pct={Math.round(displayPct(markets[0]))} delta={deltas[0] ?? 0} />
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {markets.map((m, i) => (
            <span key={m.id} className="flex items-center gap-1.5 text-[13px] font-semibold">
              <span className="size-2 rounded-full" style={{ background: LINE_COLORS[i] }} />
              <span className="text-secondary">{m.groupItemTitle}</span>
              <span className="tabular-nums">{Number(displayPct(m)).toFixed(1)}%</span>
            </span>
          ))}
        </div>
      )}

      {/* chart */}
      <div className="mt-2 h-[300px]">
        {endTime !== null && (
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
                strokeDasharray="3 3"
                stroke="var(--border-default)"
              />
              <XAxis
                dataKey="t"
                tickFormatter={(t: number) => formatTick(t, tf)}
                ticks={ticks}
                interval={0}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--neutral-500)", fontSize: 12, fontWeight: 500 }}
              />
              <YAxis
                orientation="right"
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(p: number) => `${p}%`}
                width={40}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--neutral-500)", fontSize: 12, fontWeight: 500 }}
              />
              <Tooltip
                cursor={<CrosshairCursor formatTimestamp={(t) => formatTimestamp(t, tf)} />}
                content={<ValuePills nameFor={nameFor} />}
                isAnimationActive={false}
              />
              {markets.map((m, i) => (
                <Line
                  key={m.id}
                  dataKey={m.id}
                  type="monotone"
                  stroke={LINE_COLORS[i]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3, fill: LINE_COLORS[i], strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* timeframe toggles */}
      <div className="mt-1 flex justify-end gap-1">
        {TIMEFRAMES.map((t) => (
          <button
            key={t}
            onClick={() => setTf(t)}
            className={`h-8 rounded-md px-2 text-sm font-semibold transition-colors duration-150 ease-in-out ${
              tf === t ? "bg-element-2 text-primary" : "text-secondary hover:text-primary"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChanceHeader({ pct, delta }: { pct: number; delta: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[28px] font-semibold leading-none tabular-nums">
        {pct}% chance
      </span>
      {delta !== 0 && (
        <span
          className={`flex items-center text-sm font-semibold ${
            delta > 0 ? "text-yes" : "text-no"
          }`}
        >
          {delta > 0 ? (
            <ChevronUp className="size-4" strokeWidth={3} />
          ) : (
            <ChevronDown className="size-4" strokeWidth={3} />
          )}
          {Math.abs(delta)}%
        </span>
      )}
    </div>
  );
}

function formatTick(t: number, tf: Timeframe): string {
  const d = new Date(t);
  if (tf === "1H" || tf === "6H" || tf === "1D") {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (tf === "1W" || tf === "1M") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short" });
}

function formatTimestamp(t: number, tf: Timeframe): string {
  return new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: tf === "ALL" ? undefined : "numeric",
    minute: tf === "ALL" ? undefined : "2-digit",
  });
}
