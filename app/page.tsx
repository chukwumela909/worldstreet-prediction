import { SiteHeader } from "@/components/nav/site-header";
import { FeaturedHero } from "@/components/home/featured-hero";
import { MarketBrowser } from "@/components/home/market-browser";
import { PromoRail } from "@/components/home/promo-rail";
import { MOCK_EVENTS } from "@/lib/mock-events";
import { getEvents, getHotTopics } from "@/lib/polymarket";
import { HOT_TOPICS } from "@/lib/mock-home";
import type { HotTopic } from "@/lib/hot-topics";
import type { MarketEvent } from "@/types/market";

/** Live Gamma events, or the mock fixtures when the API is unreachable. */
async function loadEvents(): Promise<MarketEvent[]> {
  try {
    const events = await getEvents({ limit: 24 });
    if (events.length > 0) return events;
  } catch (err) {
    console.warn("[polymarket] home falling back to fixtures:", err);
  }
  return MOCK_EVENTS;
}

/** Live tag rankings, or the mock rail when the API is unreachable. */
async function loadHotTopics(): Promise<HotTopic[]> {
  try {
    const topics = await getHotTopics();
    if (topics.length > 0) return topics;
  } catch (err) {
    console.warn("[polymarket] hot topics falling back to fixtures:", err);
  }
  return HOT_TOPICS;
}

export default async function Home() {
  // independent fetches — kick both off before awaiting either
  const [events, topics] = await Promise.all([loadEvents(), loadHotTopics()]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1280px] px-6 pb-16">
        {/* hero + promo rail */}
        <div className="flex gap-8 pt-1.5">
          <FeaturedHero events={events} />
          <PromoRail topics={topics} />
        </div>

        {/* all markets */}
        <MarketBrowser events={events} />
      </main>
    </>
  );
}
