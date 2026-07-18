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
import { ChevronDown, ChevronUp } from "lucide-react";
import { isBinary, type MarketEvent } from "@/types/market";
import { toPercent } from "@/lib/format";
import { getSeries, TIMEFRAMES, type Timeframe } from "@/lib/mock-series";
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
  const [hoverRow, setHoverRow] = useState<ChartRow | null>(null);
  const onHover = useCallback((row: ChartRow | null) => setHoverRow(row), []);
  const clipId = "pc" + useId().replace(/[^a-zA-Z0-9]/g, "");

  // stable identity — a fresh slice each render would churn the chart data
  // identity on every hover-state change and reset recharts' tooltip state
  const markets = useMemo(() => event.markets.slice(0, MAX_LINES), [event]);
  const binary = isBinary(event);

  const { data, deltas } = useMemo(() => {
    if (endTime === null) return { data: [] as ChartRow[], deltas: [] as number[] };
    const series = markets.map((m) => getSeries(m, tf, endTime));
    const merged: ChartRow[] = series[0].map((pt, i) => {
      const row: ChartRow = { t: pt.t };
      markets.forEach((m, mi) => {
        const v = Math.round(series[mi][i].p * 10) / 10;
        row[m.id] = v;
        row[GHOST + m.id] = v; // ghost copy under the solid line
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
      const t = row.t as number;
      const label = formatTick(t, tf);
      if (label !== last) {
        firsts.push(t);
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

  const hoveredValue = (m: (typeof markets)[number]) => {
    const v = hoverRow?.[m.id];
    return typeof v === "number" ? v : null;
  };

  const displayPct = (m: (typeof markets)[number]) =>
    hoveredValue(m) ?? toPercent(m.outcomePrices[0]);

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
              {/* whole percents while hovering, one decimal at rest — like the real site */}
              <span className="tabular-nums">
                {hoverRow !== null
                  ? `${Math.round(displayPct(m))}%`
                  : `${Number(displayPct(m)).toFixed(1)}%`}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* chart */}
      <ClipStyles id={clipId} />
      <div className="mt-2 h-[300px]">
        {endTime !== null && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 20, right: 0, bottom: 0, left: 8 }}>
              <HoverClip id={clipId} />
              <HoverBridge onChange={onHover} />
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
                content={<AnchoredPills nameFor={nameFor} yMax={100} />}
                position={{ x: 0, y: 0 }}
                isAnimationActive={false}
              />
              {/* ghost layer: clipped to the right of the cursor while hovering */}
              {markets.map((m, i) => (
                <Line
                  key={GHOST + m.id}
                  className={`${clipId}-g`}
                  dataKey={GHOST + m.id}
                  type="monotone"
                  stroke={LINE_COLORS[i]}
                  strokeWidth={2}
                  strokeOpacity={0.14}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
              ))}
              {/* solid layer: clipped to the left of the cursor while hovering */}
              {markets.map((m, i) => (
                <Line
                  key={m.id}
                  className={`${clipId}-s`}
                  dataKey={m.id}
                  type="monotone"
                  stroke={LINE_COLORS[i]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: LINE_COLORS[i], strokeWidth: 0 }}
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
