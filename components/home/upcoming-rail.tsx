"use client";

import Link from "next/link";
import type { MarketEvent } from "@/types/market";
import { usePageNow } from "@/lib/use-now";
import { ScrollStrip } from "@/components/scroll-strip";
import { EventIcon } from "@/components/market/event-icon";
import { eventHref, formatCloseDate } from "@/components/market/market-card";

/** How many closing-soonest markets the rail carries. */
const RAIL_SIZE = 8;

/**
 * "Upcoming" — the board's markets that close soonest, as a horizontal
 * rail of compact tiles. Filtering on "still open" needs the clock, which
 * the server snapshot doesn't have, so the rail renders client-side only.
 */
export function UpcomingRail({ events }: { events: MarketEvent[] }) {
  const now = usePageNow();
  if (now === null) return null;

  const upcoming = events
    .map((event) => ({ event, closes: closesAt(event) }))
    .filter(({ closes }) => closes > now)
    .sort((a, b) => a.closes - b.closes)
    .slice(0, RAIL_SIZE);

  if (upcoming.length === 0) return null;

  return (
    <section aria-labelledby="upcoming-title" className="mt-8">
      <h2 id="upcoming-title" className="mb-4 text-[19px] font-semibold tracking-tight">
        Upcoming
      </h2>
      <ScrollStrip className="gap-4 pb-1">
        {upcoming.map(({ event }) => (
          <Link
            key={event.id}
            href={eventHref(event)}
            className="flex w-44 shrink-0 flex-col items-start gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-hover"
          >
            <span className="flex w-full items-center justify-between gap-2">
              <EventIcon event={event} className="size-8 rounded-md text-base" px={32} />
              <time className="text-xs text-secondary">{formatCloseDate(event)}</time>
            </span>
            <span className="line-clamp-3 text-sm font-semibold leading-snug text-primary">
              {event.title}
            </span>
            <span className="mt-auto text-xs text-secondary">
              {event.subcategory ?? event.category}
            </span>
          </Link>
        ))}
      </ScrollStrip>
    </section>
  );
}

/**
 * When trading stops, in ms. Gamma's endDate is a bare date, so it counts
 * as open until that day is out in UTC; Bayse gives the exact time.
 */
function closesAt(event: MarketEvent): number {
  if (event.closesAt) return Date.parse(event.closesAt);
  if (!event.endDate) return NaN;
  return Date.parse(
    event.endDate.includes("T") ? event.endDate : `${event.endDate}T23:59:59Z`,
  );
}
