"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import type { MarketEvent } from "@/types/market";
import { toPercent } from "@/lib/format";
import { getSeries } from "@/lib/mock-series";
import { usePageNow } from "@/lib/use-now";
import {
  HERO_COMMENTS,
  HERO_DOT_COUNT,
  HERO_PAGERS,
} from "@/lib/mock-home";

const OUTCOME_FLAGS: Record<string, string> = {
  Spain: "🇪🇸",
  England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  Argentina: "🇦🇷",
  France: "🇫🇷",
};

const LINE_COLORS = ["var(--chart-4)", "var(--chart-2)"];

/**
 * Featured hero card (838×471 @1280) + carousel dots/pager strip.
 * Measured specs: bg #181d21, radius 18, inner pad 21/23, left col 318px,
 * outcome rows 48px pitch, footer 13px/490 tertiary.
 */
export function FeaturedHero({ event }: { event: MarketEvent }) {
  const top2 = event.markets.slice(0, 2);

  const now = usePageNow();
  const { data, xTicks, yTicks } = useMemo(() => {
    if (now === null) return { data: [], xTicks: [], yTicks: [] as number[] };
    const series = top2.map((m) => getSeries(m, "1M", now));
    const merged = series[0].map((pt, i) => {
      const row: Record<string, number> = { t: pt.t };
      top2.forEach((m, mi) => (row[m.id] = series[mi][i].p));
      return row;
    });
    // weekly date ticks + 15%-step y ticks, like the real hero chart
    const first = merged[0].t;
    const last = merged[merged.length - 1].t;
    const week = 7 * 86_400_000;
    const ticks: number[] = [];
    for (let t = first + week / 2; t < last - week / 4; t += week) ticks.push(t);
    const peak = Math.max(...series.flat().map((p) => p.p));
    const yMax = Math.ceil((peak * 1.05) / 15) * 15;
    const ySteps = Array.from({ length: yMax / 15 + 1 }, (_, i) => i * 15);
    return { data: merged, xTicks: ticks, yTicks: ySteps };
  }, [top2, now]);
  const lastIndex = data.length - 1;

  return (
    <div className="min-w-0 flex-1">
      {/* card */}
      <Link
        href={`/event/${event.slug}`}
        className="block h-[471px] rounded-[18px] border border-border bg-hero-surface px-[21px] pb-[18px] pt-[23px]"
      >
        <div className="flex h-full flex-col">
          {/* header */}
          <div className="flex items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-element-2 text-3xl">
              {event.icon}
            </span>
            <div>
              <p className="text-sm font-medium text-secondary">
                {event.category} · Soccer
              </p>
              <h2 className="text-2xl font-semibold leading-8">{event.title}</h2>
            </div>
          </div>

          {/* body: outcomes + comments | chart */}
          <div className="mt-5 flex min-h-0 flex-1 gap-[72px]">
            <div className="flex w-[318px] shrink-0 flex-col">
              {top2.map((m) => (
                <div
                  key={m.id}
                  className="flex h-12 items-center gap-3 border-b border-border"
                >
                  <span className="text-[26px] leading-none">
                    {OUTCOME_FLAGS[m.groupItemTitle ?? ""] ?? "🏳️"}
                  </span>
                  <span className="flex-1 text-base font-medium">
                    {m.groupItemTitle}
                  </span>
                  <span className="text-xl font-semibold tracking-tight">
                    {toPercent(m.outcomePrices[0])}%
                  </span>
                </div>
              ))}

              {/* comments feed */}
              <div className="mt-4 flex min-h-0 flex-col gap-3 overflow-hidden">
                {HERO_COMMENTS.map((c) => (
                  <div key={c.user} className="flex gap-2">
                    <span
                      className="mt-0.5 size-6 shrink-0 rounded-full"
                      style={{
                        background: `linear-gradient(135deg, hsl(${c.hue} 60% 55%), hsl(${c.hue + 60} 60% 45%))`,
                      }}
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold leading-4">
                        {c.user}
                      </p>
                      <p className="line-clamp-2 text-[13px] leading-[18px] text-secondary">
                        {c.text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* chart */}
            <div className="flex min-w-0 flex-1 flex-col pt-10">
              <div className="flex gap-4">
                {top2.map((m, i) => (
                  <span
                    key={m.id}
                    className="flex items-center gap-1.5 text-[13px] font-semibold"
                  >
                    <span
                      className="size-2 rounded-full"
                      style={{ background: LINE_COLORS[i] }}
                    />
                    <span className="text-secondary">{m.groupItemTitle}</span>
                    <span>
                      {(parseFloat(m.outcomePrices[0]) * 100).toFixed(1)}%
                    </span>
                  </span>
                ))}
              </div>
              <div className="mt-2 min-h-0 flex-1">
                {now !== null && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 8 }}>
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
                        new Date(t).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
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
                    {top2.map((m, i) => (
                      <Line
                        key={m.id}
                        dataKey={m.id}
                        type="monotone"
                        stroke={LINE_COLORS[i]}
                        strokeWidth={2}
                        isAnimationActive={false}
                        dot={(props: { index?: number; cx?: number; cy?: number }) =>
                          props.index === lastIndex ? (
                            <circle
                              key={`end-${m.id}`}
                              cx={props.cx}
                              cy={props.cy}
                              r={4}
                              fill={LINE_COLORS[i]}
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
          </div>

          {/* footer */}
          <div className="flex items-center justify-between pt-3 text-[13px] font-medium tracking-tight text-tertiary">
            <span>{heroVolume(event.volume)}</span>
            <span className="flex items-center gap-2">
              Ends {heroDate(event.endDate)} ·
              <span className="flex items-center gap-1 font-semibold">
                <LogoMark />
                Worldstreet
              </span>
            </span>
          </div>
        </div>
      </Link>

      {/* dots + pagers strip */}
      <div className="mt-2 flex h-14 items-center">
        <div className="flex items-center gap-1.5 pl-4">
          {Array.from({ length: HERO_DOT_COUNT }, (_, i) =>
            i === 0 ? (
              <span key={i} className="h-1.5 w-8 rounded-full bg-border-active" />
            ) : (
              <span key={i} className="size-1.5 rounded-full bg-element-3" />
            ),
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="flex h-10 items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-base text-primary hover:bg-element-2">
            <ChevronLeft className="size-4 text-secondary" />
            {HERO_PAGERS.prev}
          </button>
          <button className="flex h-10 items-center gap-1.5 rounded-full bg-surface pl-4 pr-3 text-base text-primary hover:bg-element-2">
            {HERO_PAGERS.next}
            <ChevronRight className="size-4 text-secondary" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hero footer volume: "$4B Vol" (rounded, no decimal/period). */
function heroVolume(volume: string): string {
  const n = parseFloat(volume);
  if (n >= 1_000_000_000) return `$${Math.round(n / 1_000_000_000)}B Vol`;
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M Vol`;
  return `$${Math.round(n / 1_000)}K Vol`;
}

function heroDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
      <path d="M4 4h16v3.2L12 10 4 7.2V4zm0 6.4L12 13.2l8-2.8v3.2L12 16.4 4 13.6v-3.2zm0 6.4 8 2.8 8-2.8V20l-8 2.8L4 20v-3.2z" />
    </svg>
  );
}
