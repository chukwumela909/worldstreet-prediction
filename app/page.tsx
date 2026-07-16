import { SiteHeader } from "@/components/nav/site-header";
import { FeaturedHero } from "@/components/home/featured-hero";
import { MarketBrowser } from "@/components/home/market-browser";
import { PromoRail } from "@/components/home/promo-rail";
import { MOCK_EVENTS } from "@/lib/mock-events";

export default function Home() {
  const heroEvent = MOCK_EVENTS[0]; // World Cup Winner

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1280px] px-6 pb-16">
        {/* hero + promo rail */}
        <div className="flex gap-8 pt-1.5">
          <FeaturedHero event={heroEvent} />
          <PromoRail />
        </div>

        {/* all markets */}
        <MarketBrowser events={MOCK_EVENTS} />
      </main>
    </>
  );
}
