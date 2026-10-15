"use client";

import { BookmarkIcon as BookmarkOutline } from "@heroicons/react/24/outline";
import { BookmarkIcon as BookmarkSolid } from "@heroicons/react/24/solid";
import { toggleWatchlist, useWatchlist } from "@/lib/watchlist-store";
import { showToast } from "@/lib/toast-store";

/**
 * Save/unsave a market and say so — every watchlist toggle in the app
 * goes through here, so each one gets the same confirmation toast.
 */
export function toggleSaved(slug: string, saved: boolean) {
  toggleWatchlist(slug);
  showToast(saved ? "Market removed from watchlist" : "Market added to watchlist");
}

/**
 * Watchlist bookmark toggle. Saved, it's the reference's tonal tile: a
 * gold-tinted square with a solid gold bookmark; unsaved, a ghost button
 * with the outline glyph. sm on market-card footers, md on the featured
 * market's header.
 */
export function WatchButton({
  slug,
  size = "sm",
}: {
  slug: string;
  size?: "sm" | "md";
}) {
  const saved = useWatchlist().includes(slug);
  const Icon = saved ? BookmarkSolid : BookmarkOutline;

  return (
    <button
      type="button"
      aria-label={saved ? "Unsave market" : "Save market"}
      aria-pressed={saved}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSaved(slug, saved);
      }}
      className={`grid shrink-0 place-items-center rounded-md transition-colors ${
        size === "sm" ? "size-7" : "size-8"
      } ${
        saved
          ? "bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-accent-ink hover:bg-[color-mix(in_oklab,var(--accent)_24%,transparent)]"
          : "text-secondary hover:bg-element-2 hover:text-primary"
      }`}
    >
      <Icon className="size-4" />
    </button>
  );
}
