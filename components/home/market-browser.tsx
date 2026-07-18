"use client";

import { useMemo, useState } from "react";
import { Bookmark, Search, SlidersHorizontal } from "lucide-react";
import type { MarketEvent } from "@/types/market";
import { MarketFilters } from "@/components/home/market-filters";
import { MarketCard } from "@/components/market/market-card";
import { setSearchTerm, useSearchTerm } from "@/lib/search-store";

/**
 * "All markets" section: heading, filter chips, and the card grid.
 * Chips filter by event tag; the top-nav search term narrows further
 * (title, outcome names, category).
 */
export function MarketBrowser({ events }: { events: MarketEvent[] }) {
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

  return (
    <>
      <div className="mt-7 flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">All markets</h2>
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
          <SlidersHorizontal className="size-4.5 cursor-pointer" strokeWidth={2} />
          <Bookmark className="size-4.5 cursor-pointer" strokeWidth={2} />
        </div>
      </div>
      <MarketFilters active={filter} onChange={setFilter} filters={filters} />
      {visible.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3 pt-3">
          {visible.map((event) => (
            <MarketCard key={event.id} event={event} />
          ))}
        </div>
      ) : (
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
