"use client";

import { isBinary, type MarketEvent } from "@/types/market";
import { EventHeader } from "@/components/event/event-header";
import { EventTabs } from "@/components/event/event-tabs";
import { OutcomeList } from "@/components/event/outcome-list";
import { PriceChart } from "@/components/event/price-chart";
import { TradePanel } from "@/components/event/trade-panel";
import { TradeProvider } from "@/components/event/trade-context";
import { useLivePrices } from "@/lib/use-live-prices";

/**
 * Client shell for the event page: takes the server-rendered event and
 * keeps its prices ticking via the shared poll, so the chance header,
 * outcome rows, and trade panel move without a reload.
 */
export function LiveEvent({ event: initial }: { event: MarketEvent }) {
  const [event = initial] = useLivePrices([initial]);

  return (
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
  );
}
