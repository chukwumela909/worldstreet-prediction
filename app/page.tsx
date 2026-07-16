import { Bookmark, Search, SlidersHorizontal } from "lucide-react";
import { SiteHeader } from "@/components/nav/site-header";
import { FeaturedHero } from "@/components/home/featured-hero";
import { MarketFilters } from "@/components/home/market-filters";
import { PromoRail } from "@/components/home/promo-rail";
import { MarketCard } from "@/components/market/market-card";
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
        <div className="mt-7 flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">All markets</h2>
          <div className="flex items-center gap-4 text-primary">
            <Search className="size-4.5 cursor-pointer" strokeWidth={2} />
            <SlidersHorizontal className="size-4.5 cursor-pointer" strokeWidth={2} />
            <Bookmark className="size-4.5 cursor-pointer" strokeWidth={2} />
          </div>
        </div>
        <MarketFilters />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3 pt-3">
          {MOCK_EVENTS.map((event) => (
            <MarketCard key={event.id} event={event} />
          ))}
        </div>
      </main>
    </>
  );
}
