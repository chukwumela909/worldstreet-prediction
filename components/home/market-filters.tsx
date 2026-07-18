"use client";

import { ScrollStrip } from "@/components/scroll-strip";

/**
 * Filter chips under "All markets" (measured): active = brand @ 20% bg +
 * accent text, radius 6px, h32, 14px/500, px-12; inactive text-secondary;
 * 150ms ease-in-out transitions. Rendered as a slider strip with chevron
 * pagers on overflow. Controlled by MarketBrowser.
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

export function MarketFilters({
  active,
  onChange,
  filters = FILTERS,
}: {
  active: string;
  onChange: (filter: string) => void;
  /** Chip labels; defaults to the measured recon list for fixtures. */
  filters?: string[];
}) {
  return (
    <div className="mt-3 flex">
      <ScrollStrip className="gap-1.5">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => onChange(f)}
            className={`h-8 shrink-0 whitespace-nowrap rounded-chip px-3 text-sm font-medium transition-colors duration-150 ease-in-out ${
              f === active
                ? "bg-accent/20 text-accent"
                : "text-secondary hover:bg-element-2 hover:text-primary"
            }`}
          >
            {f}
          </button>
        ))}
      </ScrollStrip>
    </div>
  );
}
