"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookmarkIcon as Bookmark,
  ChevronDownIcon as ChevronDown,
  MagnifyingGlassIcon as Search,
  AdjustmentsHorizontalIcon as SlidersHorizontal,
  XMarkIcon as X,
} from "@heroicons/react/24/outline";
import type { MarketEvent } from "@/types/market";
import type { LoadMoreStatus } from "@/lib/use-load-more";

export type SortKey = "trending" | "movers" | "closing" | "volume" | "balanced";

/**
 * The reference's sort list, minus "New": our events carry no listing
 * date, so a newest-first sort would just be a guess.
 */
const SORTS: { value: SortKey; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "movers", label: "Volatile" },
  { value: "closing", label: "Closing soon" },
  { value: "volume", label: "Volume" },
  { value: "balanced", label: "50-50" },
];

/** Market frequencies, matched against the recurrence tags Gamma puts on series. */
export const FREQUENCIES = [
  { value: "15 min", tags: ["15m", "15 min", "15-min"] },
  { value: "Hourly", tags: ["hourly", "1h"] },
  { value: "Daily", tags: ["daily"] },
  { value: "Weekly", tags: ["weekly"] },
  { value: "Monthly", tags: ["monthly"] },
  { value: "Annual", tags: ["annual", "yearly"] },
];

const ICON_BUTTON =
  "grid size-9 shrink-0 place-items-center rounded-sm transition-colors hover:bg-surface hover:text-primary";

/** Search (an icon that opens into a field), sort/filter popover, saved toggle. */
export function CategoryTools({
  query,
  sort,
  reverse,
  savedOnly,
  onQuery,
  onSort,
  onReverse,
  onSaved,
}: {
  query: string;
  sort: SortKey;
  reverse: boolean;
  savedOnly: boolean;
  onQuery: (v: string) => void;
  onSort: (v: SortKey) => void;
  onReverse: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [searching, setSearching] = useState(false);
  const expanded = searching || query !== "";

  return (
    <section aria-label="Market tools" className="flex min-w-0 items-center gap-1 text-secondary">
      {expanded ? (
        <div className="relative w-48 max-w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tertiary" />
          <input
            autoFocus
            type="search"
            aria-label="Filter markets"
            placeholder="Search markets..."
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onQuery("");
                setSearching(false);
              }
            }}
            className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-9 text-[13px] text-primary outline-none placeholder:text-tertiary focus:border-border-active [&::-webkit-search-cancel-button]:hidden"
          />
          <button
            aria-label="Close market search"
            onClick={() => {
              onQuery("");
              setSearching(false);
            }}
            className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-tertiary hover:bg-element-2 hover:text-primary"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <button aria-label="Search markets" onClick={() => setSearching(true)} className={ICON_BUTTON}>
          <Search className="size-4" />
        </button>
      )}

      <Popover
        label="Filter markets"
        trigger={<SlidersHorizontal className="size-4" />}
        triggerClass={ICON_BUTTON}
      >
        <fieldset>
          <legend className="sr-only">Sort markets</legend>
          {SORTS.map((s) => (
            <label key={s.value} className="flex cursor-pointer items-center gap-3 py-1 text-sm text-primary">
              <input
                type="radio"
                name="market-sort"
                checked={sort === s.value}
                onChange={() => onSort(s.value)}
                className="size-4 accent-[var(--accent)]"
              />
              {s.label}
            </label>
          ))}
        </fieldset>
        <hr className="my-4 border-border" />
        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-primary">
          Reverse sort
          <button
            role="switch"
            aria-checked={reverse}
            onClick={() => onReverse(!reverse)}
            className={`flex h-5 w-9 rounded-full p-0.5 transition-colors ${reverse ? "bg-accent" : "bg-element-3"}`}
          >
            <span
              className={`size-4 rounded-full transition-transform ${reverse ? "translate-x-4 bg-on-accent" : "bg-primary"}`}
            />
          </button>
        </label>
        {(sort !== "trending" || reverse) && (
          <button
            onClick={() => {
              onSort("trending");
              onReverse(false);
            }}
            className="mt-3 h-7 rounded-sm px-3 text-xs font-medium text-secondary hover:bg-element-2 hover:text-primary"
          >
            Reset sort
          </button>
        )}
      </Popover>

      <button
        aria-label="Show saved markets"
        aria-pressed={savedOnly}
        onClick={onSaved}
        className={`${ICON_BUTTON} ${
          savedOnly ? "bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-accent-ink" : ""
        }`}
      >
        <Bookmark className="size-4" fill={savedOnly ? "currentColor" : "none"} />
      </button>
    </section>
  );
}

/**
 * "Frequency" dropdown. Each option shows how many of this view's
 * markets carry that recurrence, and options with none are disabled
 * rather than leading to an empty grid.
 */
export function FrequencyMenu({
  events,
  value,
  onChange,
}: {
  events: MarketEvent[];
  value: string;
  onChange: (v: string) => void;
}) {
  const count = (tags: string[]) =>
    events.filter((e) => e.tags?.some((t) => tags.includes(t.toLowerCase()))).length;

  return (
    <Popover
      label="Market frequency"
      align="end"
      trigger={
        <>
          {value === "all" ? "Frequency" : value}
          <ChevronDown className="size-4" />
        </>
      }
      triggerClass="flex h-9 shrink-0 items-center gap-2 rounded-sm border border-border bg-surface px-4 text-sm font-medium text-primary transition-colors hover:border-border-active hover:bg-element-2"
    >
      <fieldset>
        <legend className="sr-only">Frequency</legend>
        {[{ value: "all", label: "All frequencies", n: events.length }, ...FREQUENCIES.map((f) => ({ value: f.value, label: f.value, n: count(f.tags) }))].map(
          (o) => (
            <label
              key={o.value}
              className={`flex items-center gap-3 py-1 text-sm ${
                o.n === 0 ? "cursor-not-allowed text-tertiary" : "cursor-pointer text-primary"
              }`}
            >
              <input
                type="radio"
                name="market-frequency"
                disabled={o.n === 0}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
                className="size-4 accent-[var(--accent)]"
              />
              {o.label}
              <span className="ml-auto text-xs tabular-nums text-secondary">{o.n}</span>
            </label>
          ),
        )}
      </fieldset>
    </Popover>
  );
}

/**
 * "Load more" under a market grid (see lib/use-load-more.ts): the
 * reference's secondary button, disabled and relabelled while a page is
 * on its way, and swapped for a one-line retry when one fails. Renders
 * nothing once the feed has run out.
 */
export function LoadMore({
  status,
  onLoad,
  className = "",
}: {
  status: LoadMoreStatus;
  onLoad: () => void;
  className?: string;
}) {
  if (status === "done") return null;
  return (
    <div aria-live="polite" className={`flex justify-center ${className}`}>
      {status === "error" ? (
        <p role="alert" className="text-sm text-secondary">
          Couldn&rsquo;t load more markets.{" "}
          <button type="button" onClick={onLoad} className="font-semibold text-primary underline">
            Try again
          </button>
        </p>
      ) : (
        <button
          type="button"
          onClick={onLoad}
          disabled={status === "loading"}
          className="h-9 rounded-sm border border-border bg-surface px-4 text-sm font-medium text-primary transition-colors hover:border-border-active hover:bg-element-2 disabled:pointer-events-none disabled:text-secondary"
        >
          {status === "loading" ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

function Popover({
  label,
  trigger,
  triggerClass,
  align = "start",
  children,
}: {
  label: string;
  trigger: ReactNode;
  triggerClass: string;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={triggerClass}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className={`absolute top-full z-40 mt-1 w-64 rounded-xl border border-border bg-surface p-4 shadow-popover ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
