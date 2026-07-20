import { SiteHeader } from "@/components/nav/site-header";
import { FeaturedHero } from "@/components/home/featured-hero";
import { MarketBrowser } from "@/components/home/market-browser";
import { PromoRail } from "@/components/home/promo-rail";
import { MOCK_EVENTS } from "@/lib/mock-events";
import { getEvents } from "@/lib/polymarket";
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

export default async function Home() {
  const events = await loadEvents();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1280px] px-6 pb-16">
        {/* hero + promo rail */}
        <div className="flex gap-8 pt-1.5">
          <FeaturedHero events={events} />
          <PromoRail />
        </div>

        {/* all markets */}
        <MarketBrowser events={events} />
      </main>
    </>
  );
}
