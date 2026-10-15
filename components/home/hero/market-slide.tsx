"use client";

import type { MarketEvent } from "@/types/market";
import { toMultiplier, toPercent } from "@/lib/format";
import { OutcomeRow } from "@/components/market/outcome-row";
import { outcomeTone } from "@/components/market/outcome-quote";
import { CommentsMarquee } from "./comments-marquee";
import { HeroChart } from "./hero-chart";
import { HeroFooter, HeroHeader, QuoteColumnLabels, type SlideHeaderProps } from "./shared";

/** Outcomes on the slide; the chart draws the same ones in the same tones. */
const MAX_OUTCOMES = 4;

/**
 * Multi-outcome market hero slide: quote rows (name over chance bar ·
 * payout · price pill) with the live comments marquee under them on the
 * left, the price history of those same outcomes on the right.
 */
export function MarketSlide({
  event,
  headerExtra,
  eager,
}: { event: MarketEvent } & SlideHeaderProps) {
  const shown = event.markets.slice(0, MAX_OUTCOMES);
  const tones = shown.map((_, i) => outcomeTone(i));
  const href = `/event/${event.slug}`;

  return (
    <div className="flex h-full flex-col p-6">
      <HeroHeader
        headerExtra={headerExtra}
        eager={eager}
        source={event.source}
        icon={event.icon}
        iconUrl={event.iconUrl}
        crumb={
          event.subcategory
            ? `${event.category} · ${event.subcategory}`
            : event.category
        }
        title={event.title}
        slug={event.slug}
      />
      <div className="mt-6 grid min-h-0 flex-1 gap-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="flex min-w-0 flex-col">
          <QuoteColumnLabels />
          <div className="flex flex-col gap-2">
            {shown.map((m, i) => (
              <OutcomeRow
                key={m.id}
                label={m.groupItemTitle ?? m.question}
                tone={tones[i]}
                pct={toPercent(m.outcomePrices[0])}
                multiplier={toMultiplier(m.outcomePrices[0])}
                href={href}
                size="md"
              />
            ))}
          </div>
          <CommentsMarquee eventId={event.id} />
        </div>
        <div className="hidden min-w-0 md:block">
          <HeroChart markets={shown} colors={tones} />
        </div>
      </div>
      <HeroFooter volume={event.volume} endDate={event.endDate} />
    </div>
  );
}
