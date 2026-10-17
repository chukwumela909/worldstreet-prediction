"use client";

import Link from "next/link";
import { isBinary, isLocalBook, type MarketEvent } from "@/types/market";
import { formatNairaCompact, formatUsdCompact, toPercent } from "@/lib/format";
import { formatQuote, marketHref } from "@/lib/book";
import { useQuote } from "@/components/book-pricing";
import { EventIcon } from "@/components/market/event-icon";
import { formatCloseDate } from "@/components/market/market-card";
import { PILL_TONE, ProbabilityBar, QuotePill } from "@/components/market/outcome-quote";
import { PrefetchArticle } from "@/components/market/prefetch-article";
import { WatchButton } from "@/components/market/watch-button";
import { useSportsTicket } from "./sports-ticket";
import {
  LIVE_FRAME,
  gameClock,
  leagueLabel,
  quoteRows,
  splitScore,
  type QuoteRow,
} from "./sports-data";
import { TeamMark } from "./team-mark";

/**
 * The sports list's card — the reference's MarketBoardCard in its
 * `sports-market-list` dress: league strip and market type, a heading
 * with the LIVE state or the close date, the two sides of the game (crest,
 * name over a chance bar, score, payout multiple, a big round price pill)
 * and a footer of volume, outcome count and save.
 *
 * A pill doesn't leave the page: it picks that outcome into the sports
 * ticket (the sticky aside, or the sheet on narrow screens). The title
 * and the outcome count link to the market page.
 */

export function SportsMarketCard({ event }: { event: MarketEvent }) {
  const href = marketHref(event.slug, event);
  const live = event.game?.live === true;
  const rows = quoteRows(event);
  const outcomes = isBinary(event) ? 2 : (event.marketCount ?? event.markets.length);
  const close = formatCloseDate(event);

  return (
    <PrefetchArticle
      href={href}
      className={`flex min-h-64 flex-col gap-3 rounded-xl border p-4 shadow-card transition-colors ${
        live ? LIVE_FRAME : "border-border bg-surface hover:border-border-hover"
      }`}
    >
      <header className="flex items-center gap-2">
        <EventIcon event={event} className="size-8 rounded-md text-base" px={32} />
        <span className="min-w-0 truncate text-[10px] font-semibold uppercase text-secondary">
          {leagueLabel(event)}
        </span>
        {event.sportType && (
          <span className="ml-auto shrink-0 text-xs text-secondary">{event.sportType}</span>
        )}
      </header>

      <div>
        <h3 className="text-xl font-bold text-primary">
          <Link href={href} className="hover:underline">
            {isBinary(event) ? event.markets[0].question : event.title}
          </Link>
        </h3>
        {live ? (
          <LiveLabel event={event} />
        ) : (
          close && (
            <time dateTime={event.closesAt ?? event.endDate} className="mt-1 block text-xs text-secondary">
              {close}
            </time>
          )
        )}
      </div>

      <div aria-label="Market outcomes" className="my-auto flex flex-col gap-3">
        {rows.map((row) => (
          <SportsQuoteRow key={row.key} event={event} row={row} />
        ))}
      </div>

      <footer className="flex items-center gap-2 text-xs text-secondary">
        <span className="mr-auto min-w-0 truncate">{stats(event)}</span>
        <Link href={href} className="shrink-0 hover:text-primary">
          {outcomes} outcomes
        </Link>
        {/* the watchlist resolves slugs against Polymarket — skip the Local book */}
        {!isLocalBook(event) && <WatchButton slug={event.slug} />}
      </footer>
    </PrefetchArticle>
  );
}

/**
 * "● LIVE 2H 49'". A score that isn't plainly two numbers ("2-9|1-1|Bo3",
 * a tennis set line) can't go in the rows' score boxes, so it rides here.
 */
function LiveLabel({ event }: { event: MarketEvent }) {
  const score = event.game?.score;
  const detail = [score && !splitScore(score) ? score : null, gameClock(event)]
    .filter(Boolean)
    .join(" · ");
  return (
    <p className="flex items-center gap-2 text-xs font-semibold text-live">
      <i aria-hidden="true" className="size-1 shrink-0 rounded-full bg-current" />
      LIVE
      {detail && <small className="min-w-0 truncate text-xs font-normal text-secondary">{detail}</small>}
    </p>
  );
}

function SportsQuoteRow({ event, row }: { event: MarketEvent; row: QuoteRow }) {
  const { quoteKobo, quoteMultiplier, international } = useQuote();
  const { ticket, pick } = useSportsTicket();
  // on our book: Local always, international only while the API's switch is on
  const tradeable = isLocalBook(event) || international;
  const pct = toPercent(row.price);
  const picked =
    ticket?.picked === true &&
    ticket.event.id === event.id &&
    ticket.marketId === row.market.id &&
    ticket.side === row.side;

  return (
    <div className="flex min-h-16 items-center gap-1 lg:gap-2">
      {row.team && <TeamMark team={row.team} px={48} className="size-12" />}
      <div className="min-w-0 flex-1">
        <p className="text-primary [overflow-wrap:anywhere]">{row.label}</p>
        <ProbabilityBar pct={pct} tone={row.tone} className="mt-2" />
      </div>
      {row.score !== undefined && (
        <abbr
          title={`${row.label} score`}
          className="min-w-12 shrink-0 rounded-xs border border-border-active p-1 text-center text-xs tabular-nums text-secondary no-underline"
        >
          {row.score}
        </abbr>
      )}
      <abbr
        title="Gross payout per unit staked at this price, before fees"
        className="shrink-0 text-xs tabular-nums text-secondary no-underline"
      >
        {quoteMultiplier(event, row.price)}
      </abbr>
      <QuotePill
        tone={PILL_TONE}
        size="lg"
        pressed={picked}
        onClick={() => pick(event, row.market.id, row.side)}
        label={
          tradeable
            ? `Buy ${row.label} at ${formatQuote(quoteKobo(event, row.price))}`
            : `${row.label}, ${pct}% chance`
        }
      >
        {pct}%
      </QuotePill>
    </div>
  );
}

/** What each source reports, as MarketCard words it. */
function stats(event: MarketEvent): string {
  if (!isLocalBook(event)) return `${formatUsdCompact(parseFloat(event.volume) || 0)} vol`;
  if (event.liquidityNgn !== undefined) {
    return `${formatNairaCompact(parseFloat(event.liquidityNgn))} liquidity`;
  }
  if (event.stakedNgn !== undefined) return `${formatNairaCompact(parseFloat(event.stakedNgn))} staked`;
  return event.trades !== undefined ? `${event.trades} trades` : "";
}
