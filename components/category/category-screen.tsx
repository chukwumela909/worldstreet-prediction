"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDownIcon as ChevronDown,
  ChevronLeftIcon as ChevronLeft,
  ChevronRightIcon as ChevronRight,
  XMarkIcon as X,
} from "@heroicons/react/24/outline";
import { isBinary, type Market, type MarketEvent } from "@/types/market";
import { useLivePrices } from "@/lib/use-live-prices";
import { categoryFeed, useLoadMore } from "@/lib/use-load-more";
import { useWatchlist } from "@/lib/watchlist-store";
import { CATEGORY_GROUPS } from "@/lib/category-groups";
import { SportsTicketProvider } from "@/components/sports/sports-ticket";
import { SportsEventRail } from "@/components/sports/sports-event-rail";
import { SportsBoard } from "@/components/sports/sports-board";
import { MarketCard } from "@/components/market/market-card";
import { BinarySlide } from "@/components/home/hero/binary-slide";
import { MarketSlide } from "@/components/home/hero/market-slide";
import {
  CategoryTools,
  FrequencyMenu,
  FREQUENCIES,
  LoadMore,
  type SortKey,
} from "./category-tools";

/**
 * A category tab's own page (/?category=politics, ...): a subgroup
 * sidebar beside the content — heading and tools, a featured market you
 * can page through, then the grid. The reference's CategoryMarkets screen,
 * on live data.
 *
 * The sidebar is the reference's group list (lib/category-groups.ts),
 * each entry a Polymarket tag. The active group is a URL param the server
 * resolves and fetches by its tag, so `events` arrive already in the
 * group and a filtered view can be linked to.
 */
export function CategoryScreen({
  param,
  label,
  group,
  groupSlug,
  events: initialEvents,
}: {
  param: string;
  label: string;
  /** Active sidebar group's label, or "" for All markets. */
  group: string;
  /** The active group's tag — what Load more keeps paging. */
  groupSlug?: string;
  events: MarketEvent[];
}) {
  // later pages join the first one before anything below derives from
  // it, so sort, search, saved and frequency all see one list
  const { events: loaded, status, loadMore } = useLoadMore(
    initialEvents,
    categoryFeed(param, initialEvents, groupSlug),
  );
  const events = useLivePrices(loaded);
  const watchlist = useWatchlist();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("trending");
  const [reverse, setReverse] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [frequency, setFrequency] = useState("all");
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [promo, setPromo] = useState(true);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    const freq = FREQUENCIES.find((f) => f.value === frequency);
    const filtered = events.filter((e) => {
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
  }, [events, query, frequency, savedOnly, watchlist, sort, reverse]);

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

  const tools = (
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
  );
  const loadMoreButton = <LoadMore status={status} onLoad={loadMore} className="mt-8" />;

  // Sports is the reference's own layout: the games rail over the page,
  // and in the content column the type pills, single-column game cards
  // and the trade ticket beside them, in place of featured + grid
  if (param === "sports") {
    return (
      <SportsTicketProvider events={visible}>
        <SportsEventRail events={events} />
        <section className={LAYOUT}>
          <CategorySidebar param={param} label={label} group={group} />
          <div className="min-w-0">
            <SportsBoard
              events={visible}
              title={group || label}
              tools={tools}
              footer={loadMoreButton}
              resetHref={`/?category=${param}`}
              onReset={() => {
                setQuery("");
                setSavedOnly(false);
              }}
            />
          </div>
        </section>
      </SportsTicketProvider>
    );
  }

  return (
    <section className={LAYOUT}>
      <CategorySidebar param={param} label={label} group={group} />

      <div className="min-w-0">
        <header className="mb-4 flex min-h-12 flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl font-bold tracking-[-0.02em]">{group || label}</h1>
          <div className="flex w-full items-center justify-between gap-3 md:w-auto">
            {tools}
            <FrequencyMenu events={events} value={frequency} onChange={setFrequency} />
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
            <div className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-card md:h-[480px]">
              {/* the pager rides in the card's header beside the link and
                  save actions on wide screens, and drops under the card
                  below xl where the header has no room for it */}
              {isBinary(featured) ? (
                <BinarySlide
                  key={featured.id}
                  event={featured}
                  variant="category"
                  eager
                  headerExtra={featuredPager("ml-2 hidden xl:flex")}
                />
              ) : (
                <MarketSlide
                  key={featured.id}
                  event={featured}
                  variant="category"
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
        {loadMoreButton}
      </div>
    </section>
  );
}

/** Sidebar beside content — the reference's category-layout columns. */
const LAYOUT =
  "grid items-start gap-4 md:grid-cols-[160px_minmax(0,1fr)] md:gap-5 xl:grid-cols-[192px_minmax(0,1fr)] xl:gap-6";

/** Uppercase caption over the Sports sidebar ("Featured"). */
const KICKER =
  "shrink-0 self-center px-1 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-secondary md:self-auto md:px-3";

/**
 * The reference's CategorySidebar: All markets, then the category's
 * groups — a parent with children folds open under a chevron (open
 * already when the active group is in it). Sports adds the "Featured"
 * kicker and the green "What's next" caption. Below md it's one
 * scrolling row, as the reference does under 700px.
 */
function CategorySidebar({
  param,
  label,
  group,
}: {
  param: string;
  label: string;
  group: string;
}) {
  const sports = param === "sports";
  const href = (g: string) =>
    g ? `/?category=${param}&group=${encodeURIComponent(g)}` : `/?category=${param}`;
  const link = (g: string, text = g) => (
    <SidebarLink key={g || "all"} href={href(g)} current={group === g}>
      {text}
    </SidebarLink>
  );

  return (
    <nav
      aria-label={`${label} subgroups`}
      className="flex items-start gap-1 overflow-x-auto border-b border-border pb-3 text-sm [scrollbar-width:none] md:sticky md:top-[152px] md:max-h-[calc(100dvh-192px)] md:flex-col md:items-stretch md:gap-0 md:overflow-y-auto md:border-0 md:pb-0 md:pr-2"
    >
      {sports && <p className={KICKER}>Featured</p>}
      {link("", "All markets")}
      {sports && (
        <p className={`${KICKER} normal-case tracking-normal text-yes md:mt-4`}>What&apos;s next</p>
      )}
      {(CATEGORY_GROUPS[param] ?? []).map((g) =>
        g.children ? (
          <details
            key={g.label}
            open={group === g.label || g.children.some((c) => c.label === group) || undefined}
            className="group/fold shrink-0 open:min-w-48 md:open:min-w-0"
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md px-3 font-medium text-secondary transition-colors hover:bg-surface hover:text-primary md:min-h-12 [&::-webkit-details-marker]:hidden">
              {g.label}
              <ChevronDown className="size-3 transition-transform group-open/fold:rotate-180" />
            </summary>
            <div className="pl-3">
              {g.slug && link(g.label)}
              {g.children.map((c) => link(c.label))}
            </div>
          </details>
        ) : (
          link(g.label)
        ),
      )}
    </nav>
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
