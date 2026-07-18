import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/nav/site-header";
import { EventHeader } from "@/components/event/event-header";
import { EventTabs } from "@/components/event/event-tabs";
import { OutcomeList } from "@/components/event/outcome-list";
import { PriceChart } from "@/components/event/price-chart";
import { TradePanel } from "@/components/event/trade-panel";
import { TradeProvider } from "@/components/event/trade-context";
import { MOCK_EVENTS } from "@/lib/mock-events";
import { getEventBySlug } from "@/lib/polymarket";
import { isBinary, type MarketEvent } from "@/types/market";

interface Props {
  params: Promise<{ slug: string }>;
}

/**
 * Live Gamma event first (fetch memoization dedupes the request between
 * generateMetadata and the page), then the mock fixtures — so fixture
 * links (portfolio, watchlist) keep resolving when live data lacks the
 * slug or the API is unreachable.
 */
async function loadEvent(slug: string): Promise<MarketEvent | undefined> {
  try {
    const live = await getEventBySlug(slug);
    if (live) return live;
  } catch (err) {
    console.warn(`[polymarket] event "${slug}" falling back to fixtures:`, err);
  }
  return MOCK_EVENTS.find((e) => e.slug === slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await loadEvent(slug);
  return { title: event ? `${event.title} | Worldstreet` : "Worldstreet" };
}

export default async function EventPage({ params }: Props) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) notFound();

  return (
    <>
      <SiteHeader />
      <TradeProvider event={event}>
        <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 pb-16 pt-4 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <EventHeader event={event} />
            <div className="mt-5">
              <PriceChart event={event} />
            </div>
            {!isBinary(event) && (
              <div className="mt-5">
                <OutcomeList event={event} />
              </div>
            )}
            <div className="mt-8">
              <EventTabs event={event} />
            </div>
          </div>
          <TradePanel event={event} />
        </main>
      </TradeProvider>
    </>
  );
}
