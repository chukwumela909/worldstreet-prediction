"use client";

import { Bookmark } from "lucide-react";
import { toggleWatchlist, usePortfolio } from "@/lib/portfolio-store";

/**
 * Watchlist bookmark toggle — filled accent when the event is saved.
 * Used in the market-card footer (size sm) and event header (size md).
 */
export function WatchButton({
  slug,
  size = "sm",
}: {
  slug: string;
  size?: "sm" | "md";
}) {
  const { watchlist } = usePortfolio();
  const saved = watchlist.includes(slug);

  return (
    <button
      aria-label={saved ? "Remove from watchlist" : "Add to watchlist"}
      aria-pressed={saved}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleWatchlist(slug);
      }}
      className={saved ? "text-accent" : "hover:text-secondary"}
    >
      <Bookmark
        className={size === "sm" ? "size-3.5" : "size-4.5"}
        fill={saved ? "currentColor" : "none"}
      />
    </button>
  );
}
