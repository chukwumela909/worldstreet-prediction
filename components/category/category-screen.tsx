"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeftIcon as ChevronLeft,
  ChevronRightIcon as ChevronRight,
  XMarkIcon as X,
} from "@heroicons/react/24/outline";
import { isBinary, type Market, type MarketEvent } from "@/types/market";
import { useLivePrices } from "@/lib/use-live-prices";
import { useWatchlist } from "@/lib/watchlist-store";
import { MarketCard } from "@/components/market/market-card";
import { BinarySlide } from "@/components/home/hero/binary-slide";
import { MarketSlide } from "@/components/home/hero/market-slide";
import { CategoryTools, FrequencyMenu, FREQUENCIES, type SortKey } from "./category-tools";

/**
 * A category tab's own page (/?category=politics, ...): a subgroup
 * sidebar beside the content — heading and tools, a featured market you
 * can page through, then the grid. The reference's CategoryMarkets screen,
 * on live data.
 *
 * Subgroups come from the events' own tags (most common first), so every
 * entry in the sidebar matches at least one market; the reference's
 * hand-written group lists would mostly come up empty against a live
 * feed. The active subgroup is a URL param, so a filtered view can be
 * linked to.
 */
const MAX_GROUPS = 10;

export function CategoryScreen({
  param,
  label,
  group,
  events: initialEvents,
}: {
  param: string;
  label: string;
  /** Active subgroup (a tag label), or "" for All markets. */
  group: string;
  events: MarketEvent[];
}) {
  const events = useLivePrices(initialEvents);
  const watchlist = useWatchlist();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("trending");
  const [reverse, setReverse] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [frequency, setFrequency] = useState("all");
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [promo, setPromo] = useState(true);

  const groups = useMemo(() => {
    const own = label.toLowerCase();
    const counts = new Map<string, number>();
    for (const e of events)
      for (const t of e.tags ?? []) {
        const key = t.toLowerCase();
        if (key === own || FREQUENCIES.some((f) => f.tags.includes(key))) continue;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_GROUPS)
      .map(([tag]) => tag);
  }, [events, label]);

  const inGroup = useMemo(
    () => events.filter((e) => !group || e.tags?.includes(group)),
    [events, group],
  );

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    const freq = FREQUENCIES.find((f) => f.value === frequency);
    const filtered = inGroup.filter((e) => {
      if (savedOnly && !watchlist.includes(e.slug)) return false;
      if (freq && !e.tags?.some((t) => freq.tags.includes(t.toLowerCase()))) return false;
      if (!term) return true;
      return [e.title, ...e.markets.map((m) => m.groupItemTitle ?? m.question)]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
    const sorted = sortEvents(filtered, sort);
    return reverse ? sorted.reverse() : sorted;
  }, [inGroup, query, frequency, savedOnly, watchlist, sort, reverse]);

  const featured = visible.length > 0 ? visible[featuredIndex % visible.length] : null;
  const page = (step: number) =>
    setFeaturedIndex((i) => (i + step + visible.length) % visible.length);

  /** "‹ 1 of N ›" — placed by the caller (card header or under the card). */
  const featuredPager = (className: string) => (
    <nav
      aria-label={`${label} featured markets`}
      className={`items-center gap-1 text-xs text-secondary ${className}`}
    >
      <PagerButton label="Previous featured market" disabled={visible.length < 2} onClick={() => page(-1)}>
        <ChevronLeft className="size-5" />
      </PagerButton>
      <span className="tabular-nums">
        {(featuredIndex % visible.length) + 1} of {visible.length}
      </span>
      <PagerButton label="Next featured market" disabled={visible.length < 2} onClick={() => page(1)}>
        <ChevronRight className="size-5" />
      </PagerButton>
    </nav>
  );

  return (
    <section className="grid items-start gap-4 md:grid-cols-[160px_minmax(0,1fr)] md:gap-5 xl:grid-cols-[192px_minmax(0,1fr)] xl:gap-6">
      <nav
        aria-label={`${label} subgroups`}
        className="flex gap-1 overflow-x-auto border-b border-border pb-3 text-sm [scrollbar-width:none] md:sticky md:top-[152px] md:max-h-[calc(100dvh-180px)] md:flex-col md:overflow-y-auto md:border-0 md:pb-0 md:pr-2"
      >
        <SidebarLink href={`/?category=${param}`} current={!group}>
          All markets
        </SidebarLink>
        {groups.map((g) => (
          <SidebarLink
            key={g}
            href={`/?category=${param}&group=${encodeURIComponent(g)}`}
            current={group === g}
          >
            {g}
          </SidebarLink>
        ))}
      </nav>

      <div className="min-w-0">
        <header className="mb-4 flex min-h-12 flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl font-bold tracking-[-0.02em]">{group || label}</h1>
          <div className="flex w-full items-center justify-between gap-3 md:w-auto">
            <CategoryTools
              query={query}
              sort={sort}
              reverse={reverse}
              savedOnly={savedOnly}
              onQuery={setQuery}
              onSort={setSort}
              onReverse={setReverse}
              onSaved={() => setSavedOnly((v) => !v)}
            />
            <FrequencyMenu events={inGroup} value={frequency} onChange={setFrequency} />
          </div>
        </header>

        {param === "crypto" && !group && promo && (
          <section className="mb-4 flex flex-wrap items-center gap-4 border-y border-border py-4">
            <div>
              <h2 className="text-base font-semibold">Perpetuals</h2>
              <p className="mt-1 text-secondary">Explore crypto markets</p>
            </div>
            <Link
              href="/perps"
              className="ml-auto flex items-center gap-2 font-medium text-domain hover:underline"
            >
              Explore perps
              <ChevronRight className="size-5" />
            </Link>
            <button
              aria-label="Dismiss perpetuals banner"
              onClick={() => setPromo(false)}
              className="grid size-9 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface hover:text-primary"
            >
              <X className="size-4" />
            </button>
          </section>
        )}

        {featured && (
          <section aria-label="Featured market" className="mb-4">
            <div className="relative h-[440px] overflow-hidden rounded-xl border border-border bg-surface shadow-card">
              {/* the pager rides in the card's header beside the link and
                  save actions on wide screens, and drops under the card
                  below xl where the header has no room for it */}
              {isBinary(featured) ? (
                <BinarySlide
                  key={featured.id}
                  event={featured}
                  eager
                  headerExtra={featuredPager("ml-2 hidden xl:flex")}
                />
              ) : (
                <MarketSlide
                  key={featured.id}
                  event={featured}
                  eager
                  headerExtra={featuredPager("ml-2 hidden xl:flex")}
                />
              )}
            </div>
            {featuredPager("flex justify-end py-2 xl:hidden")}
          </section>
        )}

        {visible.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {visible.map((e) => (
              <MarketCard key={e.id} event={e} label={group || undefined} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-4 py-12">
            <p className="text-secondary">No markets match this selection.</p>
            <Link
              href={`/?category=${param}`}
              onClick={() => {
                setQuery("");
                setSavedOnly(false);
                setFrequency("all");
              }}
              className="flex h-9 items-center rounded-sm border border-border bg-surface px-4 font-medium text-primary transition-colors hover:border-border-active hover:bg-element-2"
            >
              Show all {label.toLowerCase()} markets
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

function SidebarLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-3 transition-colors md:min-h-12 md:whitespace-normal ${
        current
          ? "bg-[color-mix(in_oklab,var(--domain-accent)_10%,transparent)] text-domain"
          : "text-secondary hover:bg-surface hover:text-primary"
      }`}
    >
      {children}
    </Link>
  );
}

function PagerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-full text-secondary transition-colors hover:bg-surface hover:text-primary disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** The quote a sort reads: the Yes side of a binary, or the favourite. */
function lead(event: MarketEvent): Market {
  if (isBinary(event)) return event.markets[0];
  return event.markets.reduce((best, m) =>
    parseFloat(m.outcomePrices[0]) > parseFloat(best.outcomePrices[0]) ? m : best,
  );
}

function closes(event: MarketEvent): number {
  const iso = event.closesAt ?? event.endDate;
  const at = Date.parse(iso?.includes("T") ? iso : `${iso}T23:59:59Z`);
  return Number.isNaN(at) ? Infinity : at;
}

function sortEvents(events: MarketEvent[], sort: SortKey): MarketEvent[] {
  const list = [...events];
  switch (sort) {
    case "movers":
      return list.sort(
        (a, b) =>
          Math.abs(lead(b).oneDayPriceChange ?? 0) - Math.abs(lead(a).oneDayPriceChange ?? 0),
      );
    case "closing":
      return list.sort((a, b) => closes(a) - closes(b));
    case "volume":
      return list.sort((a, b) => (parseFloat(b.volume) || 0) - (parseFloat(a.volume) || 0));
    case "balanced":
      return list.sort(
        (a, b) =>
          Math.abs(parseFloat(lead(a).outcomePrices[0]) - 0.5) -
          Math.abs(parseFloat(lead(b).outcomePrices[0]) - 0.5),
      );
    default:
      // the feed already arrives in 24h-volume order — that IS trending
      return list;
  }
}
