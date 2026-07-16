"use client";

import Link from "next/link";
import type { MarketEvent } from "@/types/market";
import { toPercent } from "@/lib/format";
import { CommentsMarquee } from "./comments-marquee";
import { HeroChart } from "./hero-chart";
import { HeroFooter, HeroHeader } from "./shared";

const OUTCOME_FLAGS: Record<string, string> = {
  Spain: "🇪🇸",
  England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  Argentina: "🇦🇷",
  France: "🇫🇷",
};

const LINE_COLORS = ["var(--chart-1)", "var(--chart-2)"];

/** Multi-outcome market hero slide: outcome rows + comments marquee + chart. */
export function MarketSlide({ event }: { event: MarketEvent }) {
  const top2 = event.markets.slice(0, 2);
  return (
    <Link
      href={`/event/${event.slug}`}
      className="block h-full px-[21px] pb-[18px] pt-[23px]"
    >
      <div className="flex h-full flex-col">
        <HeroHeader
          icon={event.icon}
          crumb={
            event.subcategory
              ? `${event.category} · ${event.subcategory}`
              : event.category
          }
          title={event.title}
        />
        <div className="mt-5 flex min-h-0 flex-1 gap-8 lg:gap-[72px]">
          <div className="flex min-w-0 flex-1 flex-col md:w-[318px] md:flex-none">
            {top2.map((m) => (
              <div key={m.id} className="flex h-12 items-center gap-3 border-b border-border">
                <span className="flex size-[30px] shrink-0 items-center justify-center overflow-hidden rounded-xs text-[22px] leading-none">
                  {OUTCOME_FLAGS[m.groupItemTitle ?? ""] ?? "🏳️"}
                </span>
                <span className="flex-1 text-[15px] font-[450]">{m.groupItemTitle}</span>
                <span className="text-xl font-semibold tracking-tight">
                  {toPercent(m.outcomePrices[0])}%
                </span>
              </div>
            ))}
            <CommentsMarquee />
          </div>
          <div className="hidden min-w-0 flex-1 md:block">
            <HeroChart markets={top2} colors={LINE_COLORS} />
          </div>
        </div>
        <HeroFooter volume={event.volume} endDate={event.endDate} />
      </div>
    </Link>
  );
}
