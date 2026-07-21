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
 * newest-first for Breaking) — see lib/categories.ts. The hero always
 * shows the global trending feed.
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
      ? getEvents({ limit: 24, tagSlug: tab.tagSlug, order: tab.order }).catch(
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
        {trending === null || trending.length === 0 ? (
          <div className="flex min-h-[400px] flex-col items-center justify-center gap-2 text-center">
            <p className="text-lg font-semibold">Live market data is unavailable</p>
            <p className="max-w-md text-sm text-secondary">
              We couldn&apos;t reach Polymarket&apos;s public API. Refresh in a
              moment — nothing is shown here unless it&apos;s real market data.
            </p>
          </div>
        ) : (
          <>
            {/* hero + promo rail */}
            <div className="flex gap-8 pt-1.5">
              <FeaturedHero events={trending} game={game} />
              <PromoRail topics={topics} />
            </div>

            {/* market grid, scoped to the active category tab */}
            {grid === null || grid.length === 0 ? (
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
          </>
        )}
      </main>
    </>
  );
}
