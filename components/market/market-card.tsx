import Link from "next/link";
import { WatchButton } from "./watch-button";
import { EventIcon } from "./event-icon";
import { OutcomeRow } from "./outcome-row";
import { isBinary, type MarketEvent } from "@/types/market";
import {
  formatNairaCompact,
  formatUsdCompact,
  toMultiplier,
  toPercent,
} from "@/lib/format";
import { CloseCountdown } from "@/components/local/close-countdown";

/**
 * Market card — the atomic unit of the home grid. Category strip, title,
 * then one buyable row per outcome (name · return multiple · probability)
 * over a stats footer.
 *
 * The card is deliberately not fixed-height any more. It used to be 180px
 * with the outcome list scrolling inside it, which put rows behind a
 * scrollbar on a card small enough that they read as the whole story.
 * Rows are capped instead, and the title links to the event page where
 * the full set lives.
 */
export function MarketCard({
  event,
  label,
}: {
  event: MarketEvent;
  /**
   * Overrides the strip's text. The grid groups by tag but `category` is a
   * coarser enum, so an untouched card can sit under a "Entertainment"
   * heading calling itself "CULTURE". Sections pass their own key so the
   * heading and the cards under it always agree.
   */
  label?: string;
}) {
  // Bayse (Local) events live under /local, Polymarket under /event
  const href =
    event.source === "bayse" ? `/local/${event.slug}` : `/event/${event.slug}`;

  return (
    <article className="flex flex-col rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-hover">
      <header className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <EventIcon event={event} className="size-7 rounded-md text-sm" px={28} />
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-tertiary">
            {label ?? event.category}
          </span>
        </span>
        {/* watchlist resolves slugs against Polymarket — skip for Bayse */}
        {event.source !== "bayse" && <WatchButton slug={event.slug} />}
      </header>

      <Link href={href} className="mt-3 block">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-primary hover:underline">
          {isBinary(event) ? event.markets[0].question : event.title}
        </h3>
      </Link>

      <div className="mt-3 mb-3 flex flex-col">
        <Outcomes event={event} />
      </div>

      {/* mt-auto pins the stats to the bottom edge: grid rows stretch every
          card to the tallest in the row, so a two-outcome card next to a
          three-outcome one would otherwise float its footer mid-card */}
      <footer className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3 text-xs font-medium text-tertiary">
        <Stats event={event} />
        {/* renders only when a Local market is closing — see CloseCountdown */}
        <CloseCountdown event={event} className="text-xs" />
      </footer>
    </article>
  );
}

/**
 * Binary markets show both sides, so the two rows together are the whole
 * market. Multi-outcome markets show one row per outcome, each buying that
 * outcome — taking the other side of a single runner is an event-page
 * action, not a grid one.
 */
const MAX_ROWS = 3;

function Outcomes({ event }: { event: MarketEvent }) {
  if (isBinary(event)) {
    const market = event.markets[0];
    const pct = toPercent(market.outcomePrices[0]);
    const [yesLabel, noLabel] = market.outcomeLabels ?? ["Yes", "No"];
    return (
      <>
        <OutcomeRow
          side="yes"
          label={yesLabel}
          multiplier={toMultiplier(market.outcomePrices[0])}
          pct={pct}
          tinted
        />
        <OutcomeRow
          side="no"
          label={noLabel}
          multiplier={toMultiplier(market.outcomePrices[1])}
          pct={100 - pct}
        />
      </>
    );
  }

  return (
    <>
      {event.markets.slice(0, MAX_ROWS).map((m) => (
        <OutcomeRow
          key={m.id}
          side="yes"
          label={m.groupItemTitle ?? m.question}
          multiplier={toMultiplier(m.outcomePrices[0])}
          pct={toPercent(m.outcomePrices[0])}
          tinted
        />
      ))}
    </>
  );
}

/**
 * Each source reports what it actually has: Bayse gives pool liquidity in
 * credit plus a trade count, Gamma gives lifetime dollar volume and no
 * liquidity on the event payload.
 */
function Stats({ event }: { event: MarketEvent }) {
  if (event.source === "bayse") {
    return (
      <span className="truncate">
        {[
          event.liquidityNgn &&
            `${formatNairaCompact(parseFloat(event.liquidityNgn))} liquidity`,
          event.trades !== undefined && `${event.trades} trades`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    );
  }
  return (
    <span className="truncate">
      {formatUsdCompact(parseFloat(event.volume) || 0)} vol
    </span>
  );
}
