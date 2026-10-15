"use client";

import Link from "next/link";
import {
  SquaresPlusIcon as BookmarkPlus,
} from "@heroicons/react/24/outline";
import { useWatchlist } from "@/lib/watchlist-store";

/** Sidebar card counting the visitor's saved markets; opens the portfolio's Watchlist. */
export function WatchlistPromo() {
  const saved = useWatchlist().length;
  return (
    <article className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        <BookmarkPlus className="size-5 text-accent-ink" aria-hidden="true" />
        Your watchlist
      </h2>
      <p className="mt-1 text-sm text-secondary">
        {saved === 1 ? "1 market saved" : `${saved} markets saved`}
      </p>
      <Link
        href="/portfolio?tab=watchlist"
        className="ml-auto mt-3 flex h-8 w-fit items-center rounded-md bg-element-2 px-3 text-[13px] font-semibold text-primary transition-colors hover:bg-element-3"
      >
        View saved markets
      </Link>
    </article>
  );
}
