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
import type { HotTopic } from "@/lib/hot-topics";

/**
 * Everything on this page is live Gamma data — there is deliberately no
 * fixture fallback. The event grid is required (its failure surfaces as
 * an error state); the hot-topics rail and the game slide are optional
 * extras that simply don't render if their fetch fails.
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

export default async function Home() {
  // independent fetches — kick all off before awaiting any
  const [events, topics, game] = await Promise.all([
    getEvents({ limit: 24 }).catch(() => null),
    loadHotTopics(),
    loadFeaturedGame(),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1280px] px-6 pb-16">
        {events === null || events.length === 0 ? (
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
              <FeaturedHero events={events} game={game} />
              <PromoRail topics={topics} />
            </div>

            {/* all markets */}
            <MarketBrowser events={events} />
          </>
        )}
      </main>
    </>
  );
}
