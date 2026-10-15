import Link from "next/link";
import { WatchButton } from "./watch-button";
import { EventIcon } from "./event-icon";
import { OutcomeRow } from "./outcome-row";
import { PrefetchArticle } from "./prefetch-article";
import { NO_TONE, YES_TONE, outcomeTone } from "./outcome-quote";
import { isBinary, isLocalBook, type MarketEvent } from "@/types/market";
import {
  formatNairaCompact,
  formatUsdCompact,
  toMultiplier,
  toPercent,
} from "@/lib/format";
import { CloseCountdown } from "@/components/local/close-countdown";

/**
 * Market card — the atomic unit of the home grid. An identity strip (icon,
 * section label, subcategory), the question and its close date, one quote
 * row per outcome (name over a chance bar · payout multiple · price pill),
 * and a footer of stats, outcome count and the watchlist toggle.
 *
 * Rows are capped so every card in a grid row has the same rhythm; the
 * footer's outcome count links to the event page, where the full set
 * lives.
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
  // naira-book events live under /local, Polymarket under /event
  const local = isLocalBook(event);
  const href = eventHref(event);
  const outcomes = isBinary(event) ? 2 : event.markets.length;

  return (
    <PrefetchArticle
      href={href}
      className="flex min-h-[260px] flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-hover"
    >
      <header className="flex items-center gap-3">
        <EventIcon event={event} className="size-8 rounded-md text-base" px={32} />
        <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-secondary">
          {label ?? event.category}
        </span>
        {event.subcategory && (
          <span className="ml-auto shrink-0 text-xs text-secondary">
            {event.subcategory}
          </span>
        )}
      </header>

      <div>
        <Link href={href} className="block">
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-primary hover:underline">
            {isBinary(event) ? event.markets[0].question : event.title}
          </h3>
        </Link>
        <CloseDate event={event} />
      </div>

      {/* my-auto centres the rows in whatever height the grid row hands
          the card, so a two-row card beside a taller one doesn't leave
          its footer floating mid-card */}
      <div className="my-auto flex flex-col gap-3">
        <Outcomes event={event} href={href} />
      </div>

      <footer className="flex items-center gap-3 text-xs text-secondary">
        <span className="mr-auto min-w-0 truncate">
          <Stats event={event} />
        </span>
        {/* renders only when a Local market is closing — see CloseCountdown */}
        <CloseCountdown event={event} className="text-xs" />
        <Link href={href} className="shrink-0 hover:text-primary">
          {outcomes} outcomes
        </Link>
        {/* watchlist resolves slugs against Polymarket — skip the Local book */}
        {!local && <WatchButton slug={event.slug} />}
      </footer>
    </PrefetchArticle>
  );
}

export function eventHref(event: Pick<MarketEvent, "slug" | "source">): string {
  return isLocalBook(event) ? `/local/${event.slug}` : `/event/${event.slug}`;
}

/** "Oct 15, 2026" — from the full close time when the source gives one. */
export function formatCloseDate(event: Pick<MarketEvent, "endDate" | "closesAt">): string | null {
  const iso = event.closesAt ?? event.endDate;
  if (!iso) return null;
  // Gamma's endDate is date-only; pin it to UTC so it doesn't slip a day
  const at = Date.parse(iso.includes("T") ? iso : `${iso}T00:00:00Z`);
  if (Number.isNaN(at)) return null;
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function CloseDate({ event }: { event: MarketEvent }) {
  const date = formatCloseDate(event);
  if (!date) return null;
  return (
    <time dateTime={event.closesAt ?? event.endDate} className="mt-1 block text-xs text-secondary">
      {date}
    </time>
  );
}

/**
 * Binary markets show both sides, so the two rows together are the whole
 * market. Multi-outcome markets show the first rows of the set, each
 * buying that outcome — taking the other side of a single runner is an
 * event-page action, not a grid one.
 */
const MAX_ROWS = 2;

function Outcomes({ event, href }: { event: MarketEvent; href: string }) {
  if (isBinary(event)) {
    const market = event.markets[0];
    const [yesLabel, noLabel] = market.outcomeLabels ?? ["Yes", "No"];
    return (
      <>
        <OutcomeRow
          label={yesLabel}
          tone={YES_TONE}
          pct={toPercent(market.outcomePrices[0])}
          multiplier={toMultiplier(market.outcomePrices[0])}
          href={href}
        />
        {/* The No price is quoted, not inferred: on a Polymarket or Bayse
            market the pair sums to 1 and the two are the same number, but
            a Worldstreet book is priced with an overround and 100 − yes
            would undercut the price the row's own multiple is built on. */}
        <OutcomeRow
          label={noLabel}
          tone={NO_TONE}
          pct={toPercent(market.outcomePrices[1])}
          multiplier={toMultiplier(market.outcomePrices[1])}
          href={href}
        />
      </>
    );
  }

  return (
    <>
      {event.markets.slice(0, MAX_ROWS).map((m, i) => (
        <OutcomeRow
          key={m.id}
          label={m.groupItemTitle ?? m.question}
          tone={outcomeTone(i)}
          pct={toPercent(m.outcomePrices[0])}
          multiplier={toMultiplier(m.outcomePrices[0])}
          href={href}
        />
      ))}
    </>
  );
}

/**
 * Each source reports what it actually has: Bayse gives pool liquidity in
 * credit plus a trade count, our own markets have no pool but do know
 * what's been staked into them, and Gamma gives lifetime dollar volume
 * and no liquidity on the event payload.
 */
function Stats({ event }: { event: MarketEvent }) {
  if (isLocalBook(event)) {
    const pool =
      event.liquidityNgn !== undefined
        ? `${formatNairaCompact(parseFloat(event.liquidityNgn))} liquidity`
        : event.stakedNgn !== undefined
          ? `${formatNairaCompact(parseFloat(event.stakedNgn))} staked`
          : null;
    return (
      <>
        {[pool, event.trades !== undefined && `${event.trades} trades`]
          .filter(Boolean)
          .join(" · ")}
      </>
    );
  }
  return <>{formatUsdCompact(parseFloat(event.volume) || 0)} vol</>;
}
