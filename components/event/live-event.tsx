"use client";

import {
  ClockIcon as Clock,
  ChatBubbleOvalLeftIcon as MessageCircle,
} from "@heroicons/react/24/outline";
import type { MarketEvent } from "@/types/market";
import { formatVolume } from "@/lib/format";
import { DetailBreadcrumb, EventLockup } from "@/components/event/event-header";
import { EventTabs } from "@/components/event/event-tabs";
import { DetailCard, MarketDetail, StatusToken } from "@/components/event/market-detail";
import { MarketInfo } from "@/components/event/market-info";
import { OutcomeList } from "@/components/event/outcome-list";
import { PriceChart } from "@/components/event/price-chart";
import { LocalTradePanel } from "@/components/local/local-trade-panel";
import { TradeProvider } from "@/components/event/trade-context";
import { useLivePrices } from "@/lib/use-live-prices";

/**
 * Client shell for the event page: takes the server-rendered event and
 * keeps its prices ticking via the shared poll, so the chance header,
 * outcome rows, and trade panel move without a reload.
 *
 * Status is always "Open" here, and that is the data talking: the Gamma
 * mapper drops closed or inactive markets, and an event left with none
 * never reaches this page (it 404s).
 */
export function LiveEvent({ event: initial }: { event: MarketEvent }) {
  const [event = initial] = useLivePrices([initial]);
  const sub = event.subcategory ?? event.tags?.[0];

  return (
    <TradeProvider event={event}>
      <MarketDetail
        breadcrumb={<DetailBreadcrumb category={event.category} watchSlug={event.slug} />}
        ticket={<LocalTradePanel event={event} />}
      >
        <EventLockup
          event={event}
          eyebrow={sub ? `${event.category} · ${sub}` : event.category}
          status={<StatusToken status="Open" />}
          meta={
            <>
              <span>{formatVolume(event.volume)}</span>
              <EndDate endDate={event.endDate} />
            </>
          }
        />

        <DetailCard title="Market probability">
          <PriceChart event={event} />
        </DetailCard>

        <OutcomeList event={event} />

        <MarketInfo event={event} />

        <DetailCard
          title="Social & activity"
          icon={<MessageCircle className="size-5 text-secondary" />}
        >
          <EventTabs event={event} />
        </DetailCard>
      </MarketDetail>
    </TradeProvider>
  );
}

function EndDate({ endDate }: { endDate: string }) {
  if (!endDate) return null;
  const at = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(at)) return null;
  return (
    <span className="flex items-center gap-1">
      <Clock className="size-3.5" />
      {new Date(at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })}
    </span>
  );
}
