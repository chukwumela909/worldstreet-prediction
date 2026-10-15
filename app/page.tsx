import { Suspense } from "react";
import { after } from "next/server";
import { FeaturedHero } from "@/components/home/featured-hero";
import { MarketBrowser } from "@/components/home/market-browser";
import { PromoRail } from "@/components/home/promo-rail";
import { CategoryScreen } from "@/components/category/category-screen";
import { CategorySkeleton, GridSkeleton, LeadSkeleton } from "@/components/skeletons";
import {
  getEvents,
  getFeaturedGame,
  getHotTopics,
  type FeaturedGame,
} from "@/lib/polymarket";
import { getBayseEvents } from "@/lib/bayse";
import { getWorldstreetEvents } from "@/lib/worldstreet-markets";
import { CATEGORY_TABS, categoryTab, type CategoryTab } from "@/lib/categories";
import { findGroup } from "@/lib/category-groups";
import type { HotTopic } from "@/lib/hot-topics";
import type { MarketEvent } from "@/types/market";

/**
 * Everything on this page is live data — there is deliberately no fixture
 * fallback. The event grid is required (its failure surfaces as an error
 * state); the hot-topics rail and the game slide are optional extras that
 * simply don't render if their fetch fails.
 *
 * `?category=` picks the view (see lib/categories.ts). A bare `/` is the
 * Local book (DEFAULT_CATEGORY), and it and Trending get the home board;
 * every Polymarket category gets its own category page. Every market on
 * every tab trades (lib/book.ts prices them).
 *
 * Nothing here awaits data before returning: each slow part sits behind
 * its own Suspense boundary, so the page shell streams at once and every
 * part fills in as its fetch lands. The boundaries are keyed by the view —
 * a tab switch is a search-param change on the same route, and a freshly
 * keyed boundary is what makes React show the skeleton immediately rather
 * than keep the old tab frozen on screen until the new one has rendered.
 */

async function loadHotTopics(): Promise<HotTopic[]> {
  try {
    return await getHotTopics();
  } catch {
    return [];
  }
}

async function loadFeaturedGame(): Promise<FeaturedGame | null> {
  try {
    return await getFeaturedGame();
  } catch {
    return null;
  }
}

/**
 * The Local tab is two books under one heading: markets WorldStreet
 * wrote, which lead because they're ours and there are few of them, and
 * the Bayse feed behind them. Either source failing leaves the other on
 * the page; only both failing is an outage, since an empty naira book
 * and an unreachable one need to look different.
 */
async function loadLocalEvents(): Promise<MarketEvent[] | null> {
  const [ours, bayse] = await Promise.all([
    getWorldstreetEvents().catch(() => null),
    getBayseEvents().catch(() => null),
  ]);
  if (ours === null && bayse === null) return null;
  return [...(ours ?? []), ...(bayse ?? [])];
}

interface Props {
  searchParams: Promise<{ category?: string; group?: string }>;
}

/** Markets a category page loads — enough for its subgroups to be real. */
const CATEGORY_LIMIT = 36;
/** Markets the home board loads. */
const BOARD_LIMIT = 24;

const MAIN = "mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8";

/**
 * After the response is sent, refresh every other tab's feed in the
 * background. The feeds are cached stale-while-revalidate, so once warm a
 * tab never waits on Polymarket again — this makes sure no visitor is the
 * one who pays a cold fetch (measured at 1–2 s) by clicking a tab first.
 * A warm cache answers these from memory, so repeat runs cost nothing.
 */
function warmOtherTabs(current: string) {
  after(async () => {
    await Promise.allSettled([
      getEvents({ limit: BOARD_LIMIT }),
      ...CATEGORY_TABS.filter(
        (t) => t.param !== current && t.param !== "trending" && t.source !== "local",
      ).map((t) => getEvents({ limit: CATEGORY_LIMIT, tagSlug: t.tagSlug, order: t.order })),
    ]);
  });
}

export default async function Home({ searchParams }: Props) {
  const { category, group = "" } = await searchParams;
  const tab = categoryTab(category);
  warmOtherTabs(tab.param);

  if (tab.param !== "trending" && tab.source !== "local") {
    return (
      <main className={MAIN}>
        <Suspense key={`${tab.param}:${group}`} fallback={<CategorySkeleton />}>
          <CategoryContent tab={tab} group={group} />
        </Suspense>
      </main>
    );
  }

  return (
    <main className={MAIN}>
      {/* The hero and rail are the global Polymarket feed and don't change
          between Local and Trending, so this boundary isn't keyed: switching
          those two tabs keeps the hero on screen. A Gamma outage takes the
          hero away, never the Local book under it. */}
      <Suspense fallback={<LeadSkeleton />}>
        <HomeLead />
      </Suspense>
      <Suspense key={tab.param} fallback={<GridSkeleton />}>
        <HomeGrid tab={tab} />
      </Suspense>
    </main>
  );
}

async function CategoryContent({ tab, group }: { tab: CategoryTab; group: string }) {
  // a sidebar group is its own Gamma tag, fetched whole; a label that
  // names no group is ignored rather than trusted as a tag
  const subgroup = findGroup(tab.param, group);
  const events = await getEvents({
    limit: CATEGORY_LIMIT,
    tagSlug: subgroup?.slug ?? tab.tagSlug,
    order: tab.order,
  }).catch(() => null);
  if (events === null) return <Unavailable source="Polymarket’s public API" />;
  // an empty group still gets the screen, so its sidebar can lead back out
  if (events.length === 0 && !subgroup) {
    return (
      <p className="py-16 text-center text-secondary">No live {tab.label} markets right now.</p>
    );
  }
  return (
    <CategoryScreen
      param={tab.param}
      label={tab.label}
      group={subgroup?.label ?? ""}
      groupSlug={subgroup?.slug}
      events={events}
    />
  );
}

async function HomeLead() {
  // independent fetches — kick all off before awaiting any
  const [trending, topics, game] = await Promise.all([
    getEvents({ limit: BOARD_LIMIT }).catch(() => null),
    loadHotTopics(),
    loadFeaturedGame(),
  ]);
  if (!trending?.length) return null;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2.5fr)_minmax(0,1fr)]">
      <FeaturedHero events={trending} game={game} />
      <PromoRail topics={topics} />
    </div>
  );
}

async function HomeGrid({ tab }: { tab: CategoryTab }) {
  const local = tab.source === "local";
  const grid = local
    ? await loadLocalEvents()
    : await getEvents({ limit: BOARD_LIMIT }).catch(() => null);

  if (grid === null) {
    return (
      <Unavailable source={local ? "the Local market feed" : "Polymarket’s public API"} />
    );
  }
  if (grid.length === 0) {
    return (
      <p className="py-16 text-center text-secondary">No live {tab.label} markets right now.</p>
    );
  }
  return (
    <MarketBrowser
      // key resets the chip/search state when the tab changes
      key={tab.param}
      events={grid}
      heading={local ? `${tab.label} markets` : "All markets"}
    />
  );
}

function Unavailable({ source }: { source: string }) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-2 text-center">
      <p className="text-lg font-semibold">Live market data is unavailable</p>
      <p className="max-w-md text-secondary">
        We couldn&apos;t reach {source}. Refresh in a moment — nothing is shown
        here unless it&apos;s real market data.
      </p>
    </div>
  );
}
