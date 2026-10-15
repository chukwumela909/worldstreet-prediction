"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import type { MarketEvent } from "@/types/market";
import { SportsMarketCard } from "./sports-market-card";
import { SportsTicket, useSportsTicket, useTicketBesideList } from "./sports-ticket";
import { SPORT_FILTERS, matchesSport } from "./sports-data";

/**
 * The Sports category's content column — the reference CategoryMarkets'
 * sports branch: a heading that turns into "LIVE · N" while any listed
 * game is in play, the market-type pills with their counts, then a single
 * column of sports cards beside the sticky trade ticket (lg up; below lg
 * a pick opens the ticket as a sheet instead). Sits inside a
 * SportsTicketProvider, which holds the pick and the active pill.
 */

const PILL =
  "h-9 shrink-0 whitespace-nowrap rounded-full border px-5 text-sm font-medium transition-colors";
/** Active pill: the reference's tonal button — gold wash, gold ink. */
const PILL_ACTIVE =
  "border-transparent bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-accent-ink hover:bg-[color-mix(in_oklab,var(--accent)_24%,transparent)]";
/** Resting pill: the reference's secondary button. */
const PILL_REST =
  "border-border bg-surface text-primary hover:border-border-active hover:bg-element-2";

export function SportsBoard({
  events,
  title,
  tools,
  footer,
  resetHref = "/?category=sports",
  onReset,
}: {
  /** Already filtered by group, search and saved, and live-priced. The pills are applied here. */
  events: MarketEvent[];
  /** Heading when nothing listed is live — the subgroup, or "Sports". */
  title: string;
  /** Right of the heading, where CategoryTools sits on other categories. */
  tools?: ReactNode;
  /** After the list, inside the column — e.g. LoadMore. */
  footer?: ReactNode;
  /** Where the empty state's "Show all sports markets" goes. */
  resetHref?: string;
  /** Also run by that button — clear search and saved-only here. */
  onReset?: () => void;
}) {
  const { sport, setSport, ticket } = useSportsTicket();
  const beside = useTicketBesideList();

  const counts = useMemo(
    () =>
      new Map(SPORT_FILTERS.map((f) => [f, events.filter((e) => matchesSport(e, f)).length])),
    [events],
  );
  const listed = useMemo(() => events.filter((e) => matchesSport(e, sport)), [events, sport]);
  const live = listed.filter((e) => e.game?.live).length;

  return (
    <div className="min-w-0">
      <header className="mb-4 flex min-h-12 flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-bold tracking-[-0.02em]">
          {live > 0 ? (
            <>
              LIVE <small className="text-live [font:inherit]">· {live}</small>
            </>
          ) : (
            title
          )}
        </h1>
        {tools && (
          <div className="flex w-full items-center justify-between gap-3 md:w-auto">{tools}</div>
        )}
      </header>

      {/* every type shows, even at 0, so the row never reflows as data moves */}
      <nav
        aria-label="Sports market types"
        className="mb-4 flex gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SPORT_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={sport === f}
            onClick={() => setSport(f)}
            className={`${PILL} ${sport === f ? PILL_ACTIVE : PILL_REST}`}
          >
            {f} ({counts.get(f) ?? 0})
          </button>
        ))}
      </nav>

      {listed.length > 0 ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_288px] xl:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-label="Sports markets" className="flex min-w-0 flex-col gap-4">
            {listed.map((e) => (
              <SportsMarketCard key={e.id} event={e} />
            ))}
          </section>
          {beside && ticket && (
            // CSS-hidden below lg too: the server renders this layout before
            // it knows the width, and the sheet replaces it there
            <aside
              aria-label="Sports trade ticket"
              className="sticky top-[152px] hidden rounded-xl border border-border bg-surface p-4 shadow-card lg:block"
            >
              <SportsTicket />
            </aside>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-4 py-12">
          <p className="text-secondary">No markets match this selection.</p>
          <Link
            href={resetHref}
            onClick={() => {
              setSport("All");
              onReset?.();
            }}
            className="flex h-9 items-center rounded-sm border border-border bg-surface px-4 font-medium text-primary transition-colors hover:border-border-active hover:bg-element-2"
          >
            Show all sports markets
          </Link>
        </div>
      )}
      {footer}
    </div>
  );
}
