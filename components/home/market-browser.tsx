"use client";

import { useMemo, useState } from "react";
import { Bookmark, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import type { MarketEvent } from "@/types/market";
import { MarketFilters } from "@/components/home/market-filters";
import { MarketCard } from "@/components/market/market-card";
import { setSearchTerm, useSearchTerm } from "@/lib/search-store";
import { useLivePrices } from "@/lib/use-live-prices";

/**
 * "All markets" section: heading, filter chips, and the card grid.
 * Chips filter by event tag; the top-nav search term narrows further
 * (title, outcome names, category).
 *
 * The default view groups cards into category sections rather than
 * showing one undifferentiated wall of them — a flat grid of every market
 * gives no sense of what the site covers. Narrowing to a chip or a search
 * term drops back to a flat grid, because at that point the user has
 * already said what they are looking for and grouping only adds chrome.
 */
/** Cards per section before the header link takes over. */
const SECTION_SIZE = 6;

const GRID = "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3";
export function MarketBrowser({
  events: initialEvents,
  heading = "All markets",
}: {
  events: MarketEvent[];
  heading?: string;
}) {
  const events = useLivePrices(initialEvents);
  const [filter, setFilter] = useState("All");
  const term = useSearchTerm().trim().toLowerCase();

  // chips derived from the events' own tags (most frequent first), so
  // every chip matches at least one card whether data is live or mock
  const filters = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of events)
      for (const t of e.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    const derived = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([tag]) => tag);
    return ["All", ...derived];
  }, [events]);

  const visible = useMemo(() => {
    return events.filter((e) => {
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
  }, [events, filter, term]);

  /**
   * Sections keyed by the event's first tag that is also a chip, so a
   * header and its chip always name the same set. Events whose tags never
   * made the chip list fall back to their coarse category, which merges
   * them into a matching section when there is one.
   */
  const sections = useMemo(() => {
    if (filter !== "All" || term) return null;
    const chips = new Set(filters.slice(1));
    const byKey = new Map<string, MarketEvent[]>();
    for (const e of visible) {
      const key = e.tags?.find((t) => chips.has(t)) ?? e.category;
      const bucket = byKey.get(key);
      if (bucket) bucket.push(e);
      else byKey.set(key, [e]);
    }
    // chip order is frequency-sorted, so the biggest sections lead;
    // fallback-only keys trail, largest first
    const ordered = filters.slice(1).filter((t) => byKey.has(t));
    const rest = [...byKey.keys()]
      .filter((k) => !ordered.includes(k))
      .sort((a, b) => byKey.get(b)!.length - byKey.get(a)!.length);
    return [...ordered, ...rest].map((key) => ({
      key,
      events: byKey.get(key)!,
    }));
  }, [visible, filters, filter, term]);

  return (
    <>
      <div className="mt-7 flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">{heading}</h2>
        <div className="flex items-center gap-4 text-primary">
          <button
            aria-label="Search markets"
            onClick={() =>
              document
                .querySelector<HTMLInputElement>('input[type="search"]')
                ?.focus()
            }
          >
            <Search className="size-4.5 cursor-pointer" strokeWidth={2} />
          </button>
          {/* no handlers behind these yet — Search above is a real button, so
              side by side these two claimed the same affordance and did
              nothing. Decorative until filter/watchlist are wired up. */}
          <SlidersHorizontal className="size-4.5" strokeWidth={2} aria-hidden="true" />
          <Bookmark className="size-4.5" strokeWidth={2} aria-hidden="true" />
        </div>
      </div>
      <MarketFilters active={filter} onChange={setFilter} filters={filters} />
      {visible.length === 0 ? null : sections ? (
        <div className="flex flex-col gap-9 pt-5">
          {sections.map(({ key, events: rows }) => (
            <section key={key}>
              <button
                onClick={() => setFilter(key)}
                className="group mb-3 flex items-center gap-1.5 text-lg font-bold uppercase tracking-wide text-primary"
              >
                {key}
                <ChevronRight className="size-4 text-tertiary transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </button>
              <div className={GRID}>
                {rows.slice(0, SECTION_SIZE).map((event) => (
                  <MarketCard key={event.id} event={event} label={key} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className={`${GRID} pt-5`}>
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
            No markets match
            {term ? ` “${term}”` : ""}
            {filter !== "All" ? ` in ${filter}` : ""} yet.
          </p>
          <button
            onClick={() => {
              setFilter("All");
              setSearchTerm("");
            }}
            className="h-8 rounded-chip bg-element-2 px-3 text-sm font-medium text-primary transition-colors duration-150 ease-in-out hover:bg-element-3"
          >
            Clear filters
          </button>
        </div>
      )}
    </>
  );
}
