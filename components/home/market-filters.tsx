"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

/**
 * Filter chips under "All markets" (measured): active = brand @ 20% bg +
 * accent text, radius 6px, h32, 14px/500, px-12; inactive text-secondary;
 * 150ms ease-in-out transitions.
 */
const FILTERS = [
  "All",
  "World Cup",
  "Fed",
  "NBA Offseason",
  "AI",
  "Bitcoin",
  "Peace Deal",
  "Premier League",
  "Tweet Markets",
  "Daily Temperature",
  "Oil",
  "UK",
  "Elections",
];

export function MarketFilters() {
  const [active, setActive] = useState("All");
  return (
    <div className="relative mt-3">
      <div className="flex gap-1.5 overflow-x-auto pr-8 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-40px),transparent)]">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setActive(f)}
            className={`h-8 shrink-0 whitespace-nowrap rounded-chip px-3 text-sm font-medium transition-colors duration-150 ease-in-out ${
              f === active
                ? "bg-accent/20 text-accent"
                : "text-secondary hover:bg-element-2 hover:text-primary"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
      <ChevronRight className="pointer-events-none absolute right-0 top-1/2 size-4 -translate-y-1/2 text-secondary" />
    </div>
  );
}
