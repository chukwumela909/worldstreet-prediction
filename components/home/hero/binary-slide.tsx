"use client";

import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { MarketEvent } from "@/types/market";
import { toPercent } from "@/lib/format";
import { dayDelta } from "@/lib/mock-series";
import { HeroChart } from "./hero-chart";
import { HeroFooter, HeroHeader } from "./shared";

/** Binary market hero slide: chance % + buy buttons left, chart right. */
export function BinarySlide({ event }: { event: MarketEvent }) {
  const market = event.markets[0];
  const pct = toPercent(market.outcomePrices[0]);
  const delta = dayDelta(market);

  return (
    <Link
      href={`/event/${event.slug}`}
      className="block h-full px-[21px] pb-[18px] pt-[23px]"
    >
      <div className="flex h-full flex-col">
        <HeroHeader icon={event.icon} crumb={event.category} title={event.title} />
        <div className="mt-5 flex min-h-0 flex-1 gap-8 lg:gap-[72px]">
          <div className="flex min-w-0 flex-1 flex-col md:w-[318px] md:flex-none">
            <div className="flex items-center gap-2">
              <span className="text-[40px] font-semibold leading-none">{pct}%</span>
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
            <p className="mt-1 text-sm font-medium text-secondary">chance</p>
            <div className="mt-6 flex gap-2">
              <span className="flex h-11 flex-1 items-center justify-center rounded-sm bg-yes-tint text-sm font-semibold text-yes transition-colors duration-[120ms] ease-out hover:bg-yes-solid hover:text-white">
                Buy Yes
              </span>
              <span className="flex h-11 flex-1 items-center justify-center rounded-sm bg-no-tint text-sm font-semibold text-no transition-colors duration-[120ms] ease-out hover:bg-no-solid hover:text-white">
                Buy No
              </span>
            </div>
          </div>
          <div className="hidden min-w-0 flex-1 md:block">
            <HeroChart markets={[market]} colors={["var(--chart-1)"]} />
          </div>
        </div>
        <HeroFooter volume={event.volume} endDate={event.endDate} />
      </div>
    </Link>
  );
}
