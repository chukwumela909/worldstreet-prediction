"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  BookmarkIcon as Bookmark,
  CheckIcon as Check,
  ChevronLeftIcon as ChevronLeft,
  ShareIcon as Share2,
} from "@heroicons/react/24/outline";
import { BookmarkIcon as BookmarkSolid } from "@heroicons/react/24/solid";
import type { MarketEvent } from "@/types/market";
import { CATEGORY_TABS, DEFAULT_CATEGORY } from "@/lib/categories";
import { useWatchlist } from "@/lib/watchlist-store";
import { showToast } from "@/lib/toast-store";
import { toggleSaved } from "@/components/market/watch-button";
import { EventIcon } from "@/components/market/event-icon";

/**
 * Top of a market page: the breadcrumb row (back to the board, Save,
 * Share) and the event lockup (icon, eyebrow + status, title, stats).
 * Shared by /event and /local; each page decides what goes in the slots.
 */

/** Home tab for a category label, e.g. "Politics" → "/?category=politics". */
export function categoryHref(label: string): string {
  const tab = CATEGORY_TABS.find((t) => t.label.toLowerCase() === label.toLowerCase());
  const param = tab?.param ?? "trending";
  // the default tab is the bare "/" — see CategoryBar
  return param === DEFAULT_CATEGORY ? "/" : `/?category=${param}`;
}

const CONTROL =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold text-secondary transition-colors hover:bg-element-2 hover:text-primary";

export function DetailBreadcrumb({
  category,
  watchSlug,
}: {
  category: string;
  /** Polymarket events only — the watchlist resolves slugs against Gamma. */
  watchSlug?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-secondary"
      >
        <Link href="/" className="-ml-1 flex items-center gap-0.5 hover:text-primary">
          <ChevronLeft className="size-4" />
          Markets
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={categoryHref(category)} className="truncate hover:text-primary">
          {category}
        </Link>
      </nav>
      <div className="-mr-2.5 flex items-center gap-0.5">
        {watchSlug && <SaveControl slug={watchSlug} />}
        <ShareControl />
      </div>
    </div>
  );
}

/**
 * The reference's Save: a ghost button with the bookmark and a
 * Save/Saved label — solid gold glyph once saved. Toggles through
 * toggleSaved, so it confirms with the same toast as every other save.
 */
function SaveControl({ slug }: { slug: string }) {
  const saved = useWatchlist().includes(slug);
  const Icon = saved ? BookmarkSolid : Bookmark;
  return (
    <button
      type="button"
      aria-pressed={saved}
      onClick={() => toggleSaved(slug, saved)}
      className={CONTROL}
    >
      <Icon className={`size-4 ${saved ? "text-accent-ink" : ""}`} />
      {saved ? "Saved" : "Save"}
    </button>
  );
}

function ShareControl() {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 2000);
    return () => clearTimeout(t);
  }, [result]);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setResult("copied");
          showToast("Market link copied", "success");
        } catch {
          // clipboard blocked (permissions, insecure context)
          setResult("failed");
          showToast("Could not copy link. Copy the address from your browser.");
        }
      }}
      className={CONTROL}
    >
      {result === "copied" ? (
        <Check className="size-4 text-yes" />
      ) : (
        <Share2 className="size-4" />
      )}
      <span aria-live="polite">
        {result === "copied" ? "Link copied" : result === "failed" ? "Copy failed" : "Share"}
      </span>
    </button>
  );
}

export function EventLockup({
  event,
  eyebrow,
  status,
  meta,
}: {
  event: MarketEvent;
  /** "Politics · Elections" — rendered uppercase. */
  eyebrow: string;
  status?: ReactNode;
  /** Stats line under the title (volume, close date, ...). */
  meta?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4">
      <EventIcon
        event={event}
        className="size-12 rounded-lg text-2xl sm:size-14 sm:text-3xl"
        px={56}
        eager
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
            {eyebrow}
          </p>
          {status}
        </div>
        <h1 className="mt-1.5 text-2xl font-bold leading-tight tracking-tight sm:text-[30px]">
          {event.title}
        </h1>
        {meta && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-secondary">
            {meta}
          </div>
        )}
      </div>
    </div>
  );
}
