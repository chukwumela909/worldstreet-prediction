import { SiteHeader } from "@/components/nav/site-header";
import { FeaturedHero } from "@/components/home/featured-hero";
import { MarketBrowser } from "@/components/home/market-browser";
import { PromoRail } from "@/components/home/promo-rail";
import {
  getEvents,
  getFeaturedGame,
  getHotTopics,
  type FeaturedGame,
} from "@/lib/polymarket";
import { getBayseEvents } from "@/lib/bayse";
import { getWorldstreetEvents } from "@/lib/worldstreet-markets";
import { categoryTab } from "@/lib/categories";
import type { HotTopic } from "@/lib/hot-topics";
import type { MarketEvent } from "@/types/market";

/**
 * Everything on this page is live Gamma data — there is deliberately no
 * fixture fallback. The event grid is required (its failure surfaces as
 * an error state); the hot-topics rail and the game slide are optional
 * extras that simply don't render if their fetch fails.
 *
 * `?category=` scopes the grid to its own live query (per-tag, or
 * newest-first for Breaking) — see lib/categories.ts. A bare `/` is the
 * Local book (DEFAULT_CATEGORY), the only tab anyone can trade on. The
 * hero always shows the global trending feed regardless of tab.
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
 * The Local tab is two books under one heading: markets Worldstreet
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
  searchParams: Promise<{ category?: string }>;
}

export default async function Home({ searchParams }: Props) {
  const { category } = await searchParams;
  const tab = categoryTab(category);
  const scoped = tab.param !== "trending";

  // independent fetches — kick all off before awaiting any
  const [trending, gridEvents, topics, game] = await Promise.all([
    getEvents({ limit: 24 }).catch(() => null),
    scoped
      ? tab.source === "local"
        ? loadLocalEvents()
        : getEvents({ limit: 24, tagSlug: tab.tagSlug, order: tab.order }).catch(
            () => null,
          )
      : null,
    loadHotTopics(),
    loadFeaturedGame(),
  ]);

  const grid: MarketEvent[] | null = scoped ? gridEvents : trending;

  return (
    <>
      <SiteHeader activeCategory={tab.param} />
      <main className="mx-auto w-full max-w-[1280px] px-6 pb-16">
        {/* Hero + rail are the global Polymarket feed. They used to gate the
            whole page, which was the same thing as gating the grid back when
            "/" was Trending. It isn't any more: the front door is the Local
            book, and a Gamma outage must not take the one tradeable market
            down with it. Optional chrome now — absent, not fatal. */}
        {trending !== null && trending.length > 0 && (
          <div className="flex gap-8 pt-1.5">
            <FeaturedHero events={trending} game={game} />
            <PromoRail topics={topics} />
          </div>
        )}

        {/* market grid, scoped to the active category tab */}
        {grid === null ? (
          <div className="flex min-h-[400px] flex-col items-center justify-center gap-2 text-center">
            <p className="text-lg font-semibold">Live market data is unavailable</p>
            <p className="max-w-md text-sm text-secondary">
              We couldn&apos;t reach{" "}
              {tab.source === "local"
                ? "the Local market feed"
                : "Polymarket’s public API"}
              . Refresh in a moment — nothing is shown here unless it&apos;s
              real market data.
            </p>
          </div>
        ) : grid.length === 0 ? (
          <p className="py-16 text-center text-sm text-secondary">
            No live {tab.label} markets right now.
          </p>
        ) : (
          <MarketBrowser
            // key resets the chip/search state when the tab changes
            key={tab.param}
            events={grid}
            heading={scoped ? `${tab.label} markets` : "All markets"}
          />
        )}
      </main>
    </>
  );
}
