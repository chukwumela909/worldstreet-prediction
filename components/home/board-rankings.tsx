import Link from "next/link";
import { isBinary, isLocalBook, type Market, type MarketEvent } from "@/types/market";
import { formatUsdCompact, toPercent } from "@/lib/format";
import { eventHref } from "@/components/market/market-card";

/**
 * Rankings column beside the grouped board: short ranked lists that cut
 * across the category sections. Every list is computed from the events
 * the board already has, so each one reflects the active tab; a list with
 * nothing to rank (no price moves today, no dollar volume on the naira
 * book) is left out rather than shown empty.
 */
const PER_LIST = 3;

export function BoardRankings({ events }: { events: MarketEvent[] }) {
  // upstream order is 24h volume for the Polymarket tabs, and ours-then-
  // Bayse for Local — the board's own notion of what's hot right now
  const trending = events.slice(0, PER_LIST);

  const movers = events
    .filter((e) => Math.abs(leadMarket(e).oneDayPriceChange ?? 0) > 0)
    .sort(
      (a, b) =>
        Math.abs(leadMarket(b).oneDayPriceChange ?? 0) -
        Math.abs(leadMarket(a).oneDayPriceChange ?? 0),
    )
    .slice(0, PER_LIST);

  // naira-book "volume" isn't dollars and isn't comparable across sources
  const byVolume = events
    .filter((e) => !isLocalBook(e) && parseFloat(e.volume) > 0)
    .sort((a, b) => parseFloat(b.volume) - parseFloat(a.volume))
    .slice(0, PER_LIST);

  return (
    <div className="flex flex-col gap-6">
      {trending.length > 0 && <Ranking title="Trending" events={trending} />}
      {movers.length > 0 && <Ranking title="Top movers" events={movers} />}
      {byVolume.length > 0 && (
        <Ranking title="Highest volume" events={byVolume} showVolume />
      )}
    </div>
  );
}

/**
 * The market a ranking quotes: the Yes side of a binary event, or the
 * favourite of a multi-outcome one.
 */
function leadMarket(event: MarketEvent): Market {
  if (isBinary(event)) return event.markets[0];
  return event.markets.reduce((best, m) =>
    parseFloat(m.outcomePrices[0]) > parseFloat(best.outcomePrices[0]) ? m : best,
  );
}

function Ranking({
  title,
  events,
  showVolume = false,
}: {
  title: string;
  events: MarketEvent[];
  showVolume?: boolean;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-xl border border-border bg-surface p-4 shadow-card"
    >
      <h2 className="border-b border-border pb-3 text-[15px] font-semibold">{title}</h2>
      <ol>
        {events.map((event) => {
          const market = leadMarket(event);
          const outcome = isBinary(event)
            ? (market.outcomeLabels?.[0] ?? "Yes")
            : (market.groupItemTitle ?? market.question);
          // oneDayPriceChange is a price delta; ×100 gives percentage points
          const change = Math.round((market.oneDayPriceChange ?? 0) * 1000) / 10;
          return (
            <li key={event.id}>
              <Link
                href={eventHref(event)}
                className="-mx-2 mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-md px-2 py-2.5 transition-colors hover:bg-element-2"
              >
                <span className="min-w-0">
                  <span className="line-clamp-2 text-sm leading-snug text-primary">
                    {event.title}
                  </span>
                  <span className="mt-1 block truncate text-xs text-secondary">
                    {outcome}
                  </span>
                  {showVolume && (
                    <span className="mt-0.5 block text-xs text-secondary">
                      {formatUsdCompact(parseFloat(event.volume))} vol ·{" "}
                      {isBinary(event) ? 2 : event.markets.length} outcomes
                    </span>
                  )}
                </span>
                <span className="flex flex-col items-end gap-1 tabular-nums">
                  <strong className="text-sm font-semibold">
                    {toPercent(market.outcomePrices[0])}%
                  </strong>
                  {change !== 0 && (
                    <span
                      title="Percentage-point change in the last 24 hours"
                      className={`text-xs ${change > 0 ? "text-yes" : "text-no"}`}
                    >
                      {change > 0 ? "+" : ""}
                      {change}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
