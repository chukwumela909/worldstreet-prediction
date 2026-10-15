"use client";

import {
  ChevronDownIcon as ChevronDown,
  ChevronUpIcon as ChevronUp,
} from "@heroicons/react/24/outline";
import type { MarketEvent } from "@/types/market";
import { toMultiplier, toPercent } from "@/lib/format";
import { dayDelta } from "@/lib/series";
import { OutcomeRow } from "@/components/market/outcome-row";
import { NO_TONE, YES_TONE } from "@/components/market/outcome-quote";
import { HeroChart } from "./hero-chart";
import { HeroFooter, HeroHeader, QuoteColumnLabels, type SlideHeaderProps } from "./shared";

/** Binary market hero slide: chance + Yes/No quote rows left, chart right. */
export function BinarySlide({
  event,
  headerExtra,
  eager,
}: { event: MarketEvent } & SlideHeaderProps) {
  const market = event.markets[0];
  const pct = toPercent(market.outcomePrices[0]);
  const delta = dayDelta(market);
  const [yesLabel, noLabel] = market.outcomeLabels ?? ["Yes", "No"];
  const href = `/event/${event.slug}`;

  return (
    <div className="flex h-full flex-col p-6">
      <HeroHeader
        headerExtra={headerExtra}
        eager={eager}
        source={event.source}
        icon={event.icon}
        iconUrl={event.iconUrl}
        crumb={event.category}
        title={event.title}
        slug={event.slug}
      />
      <div className="mt-6 grid min-h-0 flex-1 gap-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="flex min-w-0 flex-col">
          <div className="mb-5 flex items-end gap-2">
            <span className="text-[40px] font-semibold leading-none tabular-nums">{pct}%</span>
            <span className="pb-1 text-sm text-secondary">chance</span>
            {delta !== 0 && (
              <span
                className={`flex items-center pb-1 text-sm font-semibold ${
                  delta > 0 ? "text-yes" : "text-no"
                }`}
              >
                {delta > 0 ? (
                  <ChevronUp className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
                {Math.abs(delta)}%
              </span>
            )}
          </div>
          <QuoteColumnLabels />
          <div className="flex flex-col gap-2">
            <OutcomeRow
              label={yesLabel}
              tone={YES_TONE}
              pct={pct}
              multiplier={toMultiplier(market.outcomePrices[0])}
              href={href}
              size="md"
            />
            <OutcomeRow
              label={noLabel}
              tone={NO_TONE}
              pct={toPercent(market.outcomePrices[1])}
              multiplier={toMultiplier(market.outcomePrices[1])}
              href={href}
              size="md"
            />
          </div>
        </div>
        <div className="hidden min-w-0 md:block">
          <HeroChart markets={[market]} colors={[YES_TONE]} />
        </div>
      </div>
      <HeroFooter volume={event.volume} endDate={event.endDate} />
    </div>
  );
}
