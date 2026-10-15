"use client";

import { useMemo, useState } from "react";
import {
  BookmarkIcon as Bookmark,
  ChevronRightIcon as ChevronRight,
  MagnifyingGlassIcon as Search,
  AdjustmentsHorizontalIcon as SlidersHorizontal,
} from "@heroicons/react/24/outline";
import type { MarketEvent } from "@/types/market";
import { MarketFilters } from "@/components/home/market-filters";
import { MarketCard } from "@/components/market/market-card";
import { BoardRankings } from "@/components/home/board-rankings";
import { UpcomingRail } from "@/components/home/upcoming-rail";
import { setSearchTerm, useSearchTerm } from "@/lib/search-store";
import { useWatchlist } from "@/lib/watchlist-store";
import { useLivePrices } from "@/lib/use-live-prices";
import { boardFeed, useLoadMore, type MarketFeed } from "@/lib/use-load-more";
import { LoadMore } from "@/components/category/category-tools";

/**
 * "All markets" section: heading, filter chips, and the card grid.
 * Chips filter by event tag; the top-nav search term narrows further
 * (title, outcome names, category).
 *
 * The default view groups cards into category sections rather than
 * showing one undifferentiated wall of them — a flat grid of every market
 * gives no sense of what the site covers — with an Upcoming rail after
 * the first section and a rankings column alongside. Narrowing to a chip
 * or a search term drops back to a flat grid, because at that point the
 * user has already said what they are looking for and grouping only adds
 * chrome.
 */
/** Cards per section (two rows of two) before the header link takes over. */
const SECTION_SIZE = 4;

const SECTION_GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2";
const FLAT_GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3";
export function MarketBrowser({
  events: initialEvents,
  heading = "All markets",
  feed,
}: {
  events: MarketEvent[];
  heading?: string;
  /**
   * Where "Load more" reads the next page from; null turns it off.
   * Omitted, it's read off the events (see boardFeed): Polymarket events
   * page Trending, Bayse events page the Local tab.
   */
  feed?: MarketFeed | null;
}) {
  const { events: loaded, status, loadMore } = useLoadMore(
    initialEvents,
    feed === undefined ? boardFeed(initialEvents) : feed,
  );
  const events = useLivePrices(loaded);
  const [filter, setFilter] = useState("All");
  const [savedOnly, setSavedOnly] = useState(false);
  const watchlist = useWatchlist();
  const term = useSearchTerm().trim().toLowerCase();

  /** The server-rendered first page, as against what "Load more" added. */
  const firstPage = useMemo(() => new Set(initialEvents.map((e) => e.id)), [initialEvents]);

  // chips derived from the events' own tags (most frequent first), so
  // every chip matches at least one card. First page only: chips key the
  // sections, so a chip set that shifted with every "Load more" would
  // reshuffle every section above the button the visitor just pressed.
  const filters = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of initialEvents)
      for (const t of e.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    const derived = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([tag]) => tag);
    return ["All", ...derived];
  }, [initialEvents]);

  const visible = useMemo(() => {
    return events.filter((e) => {
      if (savedOnly && !watchlist.includes(e.slug)) return false;
      if (filter !== "All" && !e.tags?.includes(filter)) return false;
      if (!term) return true;
      const haystack = [
        e.title,
        e.category,
        e.subcategory ?? "",
        ...e.markets.map((m) => m.groupItemTitle ?? m.question),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [events, filter, term, savedOnly, watchlist]);

  /**
   * Sections keyed by the event's first tag that is also a chip, so a
   * header and its chip always name the same set. Events whose tags never
   * made the chip list fall back to their coarse category, which merges
   * them into a matching section when there is one.
   *
   * A section shows the first page's first SECTION_SIZE events and then
   * every event "Load more" brought it, so each click visibly lands its
   * cards in the sections they belong to. Order is the first page's, and
   * a section only later pages opened goes to the end — nothing above the
   * button moves except by growing.
   */
  const sections = useMemo(() => {
    if (filter !== "All" || term || savedOnly) return null;
    const chips = new Set(filters.slice(1));
    const byKey = new Map<string, { first: MarketEvent[]; more: MarketEvent[] }>();
    for (const e of visible) {
      const key = e.tags?.find((t) => chips.has(t)) ?? e.category;
      let bucket = byKey.get(key);
      if (!bucket) byKey.set(key, (bucket = { first: [], more: [] }));
      (firstPage.has(e.id) ? bucket.first : bucket.more).push(e);
    }
    const settled = (k: string) => byKey.get(k)!.first.length > 0;
    // chip order is frequency-sorted, so the biggest sections lead;
    // fallback-only keys trail, largest first; then sections that only
    // later pages filled, in the order they turned up
    const ordered = filters.slice(1).filter((t) => byKey.has(t) && settled(t));
    const rest = [...byKey.keys()]
      .filter((k) => !chips.has(k) && settled(k))
      .sort((a, b) => byKey.get(b)!.first.length - byKey.get(a)!.first.length);
    const opened = [...byKey.keys()].filter((k) => !settled(k));
    return [...ordered, ...rest, ...opened].map((key) => {
      const { first, more } = byKey.get(key)!;
      return { key, events: [...first.slice(0, SECTION_SIZE), ...more] };
    });
  }, [visible, filters, filter, term, savedOnly, firstPage]);

  return (
    <>
      <div id="markets" className="mt-7 flex scroll-mt-28 items-center justify-between">
        <h2 className="text-[19px] font-semibold tracking-tight">
          {savedOnly ? "Saved markets" : heading}
        </h2>
        <div className="flex items-center gap-4 text-primary">
          <button
            aria-label="Search markets"
            onClick={() =>
              document
                .querySelector<HTMLInputElement>('input[type="search"]')
                ?.focus()
            }
          >
            <Search className="size-4.5 cursor-pointer" />
          </button>
          {/* no handler behind this one yet — decorative until there are
              sort/filter options to put in it */}
          <SlidersHorizontal className="size-4.5" aria-hidden="true" />
          <button
            aria-label={savedOnly ? "Show all markets" : "Show saved markets"}
            aria-pressed={savedOnly}
            onClick={() => setSavedOnly((v) => !v)}
            className={savedOnly ? "text-accent-ink" : "hover:text-secondary"}
          >
            <Bookmark
              className="size-4.5"
              fill={savedOnly ? "currentColor" : "none"}
            />
          </button>
        </div>
      </div>
      <MarketFilters active={filter} onChange={setFilter} filters={filters} />
      {visible.length === 0 ? null : sections ? (
        <div className="grid items-start gap-6 pt-5 lg:grid-cols-[minmax(0,2.5fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-8">
            {sections.map(({ key, events: rows }, i) => (
              <section key={key}>
                <button
                  onClick={() => setFilter(key)}
                  className="group mb-4 flex items-center gap-2 text-[19px] font-semibold tracking-tight text-primary"
                >
                  {key}
                  <ChevronRight className="size-5 text-yes transition-transform group-hover:translate-x-0.5" />
                </button>
                <div className={SECTION_GRID}>
                  {rows.map((event) => (
                    <MarketCard key={event.id} event={event} label={key} />
                  ))}
                </div>
                {i === 0 && <UpcomingRail events={visible} />}
              </section>
            ))}
            <LoadMore status={status} onLoad={loadMore} />
          </div>
          <aside aria-label="Market rankings" className="hidden lg:block">
            <BoardRankings events={visible} />
          </aside>
        </div>
      ) : (
        <div className={`${FLAT_GRID} pt-5`}>
          {visible.map((event) => (
            <MarketCard
              key={event.id}
              event={event}
              /* same reason sections pass their key: with a chip active the
                 cards under it should agree with it. Search results have no
                 such heading, so those fall back to the event's category. */
              label={filter === "All" ? undefined : filter}
            />
          ))}
        </div>
      )}
      {visible.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-secondary">
            {savedOnly && !term && filter === "All"
              ? "You haven’t saved any of these markets yet."
              : <>
                  No {savedOnly ? "saved " : ""}markets match
                  {term ? ` “${term}”` : ""}
                  {filter !== "All" ? ` in ${filter}` : ""} yet.
                </>}
          </p>
          <button
            onClick={() => {
              setFilter("All");
              setSearchTerm("");
              setSavedOnly(false);
            }}
            className="h-8 rounded-chip bg-element-2 px-3 text-sm font-medium text-primary transition-colors duration-150 ease-in-out hover:bg-element-3"
          >
            Clear filters
          </button>
        </div>
      )}
      {/* grouped, it closes the sections column; flat or empty, it sits
          under the grid — the next page may hold what a filter is after */}
      {(!sections || visible.length === 0) && (
        <LoadMore
          status={status}
          onLoad={loadMore}
          className={visible.length === 0 ? "" : "mt-8"}
        />
      )}
    </>
  );
}
