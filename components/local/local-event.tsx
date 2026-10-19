"use client";

import {
  ChartBarIcon as BarChart3,
  ClockIcon as Clock,
  CircleStackIcon as Droplets,
} from "@heroicons/react/24/outline";
import { isBinary, type MarketEvent } from "@/types/market";
import { formatNairaCompact, toPercent } from "@/lib/format";
import { DetailBreadcrumb, EventLockup } from "@/components/event/event-header";
import {
  DetailCard,
  MarketDetail,
  StatusToken,
  useRevealTicket,
} from "@/components/event/market-detail";
import { MarketInfo } from "@/components/event/market-info";
import {
  OutcomeQuoteRow,
  OutcomesCard,
  useOutcomePills,
} from "@/components/event/outcome-list";
import { TradeProvider, useTradeSelection } from "@/components/event/trade-context";
import { YES_TONE, outcomeTone } from "@/components/market/outcome-quote";
import { BaysePriceChart } from "@/components/local/bayse-price-chart";
import { LocalTradePanel } from "@/components/local/local-trade-panel";
import { CloseCountdown } from "@/components/local/close-countdown";
import { showsCountdown, tradingStopsAt } from "@/lib/countdown";
import { useTickingNow } from "@/lib/use-now";
import { useLiveLocalEvent } from "@/lib/use-live-local";

/**
 * Detail page body for a Local event of either origin, in the same frame
 * as the Polymarket event page: lockup with naira stats, price chart,
 * outcome rows, rules and timeline, with the naira trade panel in the
 * "Trade outcome" card. Clicking a buy pill selects that market+side in
 * the panel, same as the Polymarket event page.
 *
 * Prices poll from the server-rendered snapshot, so what the panel
 * stakes against stays close to what the API will re-price it at.
 *
 * The chart is Bayse-only. Our own markets are fixed odds — the price
 * is whatever the desk last set, so there is no history to draw and a
 * flat line would imply a market that traded there.
 *
 * No Save button and no social tabs: the watchlist and the comments /
 * holders / activity feeds all resolve against Polymarket.
 */
export function LocalEvent({ event: initial }: { event: MarketEvent }) {
  const event = useLiveLocalEvent(initial);
  const status = useLocalStatus(event);

  return (
    <TradeProvider event={event}>
      <MarketDetail
        breadcrumb={<DetailBreadcrumb category="Local" />}
        ticket={<LocalTradePanel event={event} />}
      >
        <EventLockup
          event={event}
          eyebrow={`Local · ${event.tags?.[0] ?? event.category}`}
          status={status && <StatusToken status={status} />}
          meta={<LocalStats event={event} />}
        />

        {event.source === "bayse" && (
          <DetailCard title="Market probability">
            <BaysePriceChart event={event} />
          </DetailCard>
        )}

        <LocalOutcomeList event={event} />

        <MarketInfo event={event} />
      </MarketDetail>
    </TradeProvider>
  );
}

/**
 * Open / Closed from the same facts the trade panel gates on: the desk's
 * switch and the trading deadline. Null until the clock is known, rather
 * than guessing "Open" for a market that may already have shut.
 */
function useLocalStatus(event: MarketEvent): "Open" | "Closed" | null {
  const now = useTickingNow();
  if (event.tradingOpen === false) return "Closed";
  const stopsAt = tradingStopsAt(event);
  if (stopsAt === null) return "Open";
  if (now === null) return null;
  return stopsAt <= now ? "Closed" : "Open";
}

/* ---------- stats ---------- */

function LocalStats({ event }: { event: MarketEvent }) {
  const now = useTickingNow();
  const stopsAt = tradingStopsAt(event);
  // decided here, not inside CloseCountdown, because the stats line has
  // to know whether to fall back to the date
  const countingDown =
    stopsAt !== null &&
    now !== null &&
    (stopsAt <= now || showsCountdown(event, stopsAt - now));

  const endDate = event.endDate
    ? new Date(event.endDate + "T00:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <>
      {event.trades !== undefined && (
        <span className="flex items-center gap-1">
          <BarChart3 className="size-3.5" />
          {event.trades.toLocaleString("en-US")} Trades
        </span>
      )}
      {/* Bayse reports a pool; on our own markets the house is the
          counterparty, so what there is to report is the stake. */}
      {event.liquidityNgn ? (
        <span className="flex items-center gap-1">
          <Droplets className="size-3.5" />
          {formatNairaCompact(parseFloat(event.liquidityNgn))}
        </span>
      ) : (
        event.stakedNgn !== undefined && (
          <span className="flex items-center gap-1">
            <Droplets className="size-3.5" />
            {formatNairaCompact(parseFloat(event.stakedNgn))} staked
          </span>
        )
      )}
      {/* the clock replaces the date once it's the useful one — a
          15-minute market saying "Ends Jul 25" tells nobody anything */}
      {countingDown ? (
        <CloseCountdown event={event} className="text-xs" />
      ) : (
        endDate && (
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" />
            Ends {endDate}
          </span>
        )
      )}
    </>
  );
}

/* ---------- outcomes ---------- */

/**
 * Always shown, binary included: below 1024px the panel lives in a
 * sheet, so these rows are where a side gets picked. The pills quote
 * what a share costs here — Bayse's price plus the house margin and any
 * live rise, or the desk's price on our own markets (useOutcomePills).
 */
function LocalOutcomeList({ event }: { event: MarketEvent }) {
  const pill = useOutcomePills(event);
  const { marketId, side, select } = useTradeSelection();
  const reveal = useRevealTicket();
  const binary = isBinary(event);
  const choose = (id: string, s: "yes" | "no") => {
    select(id, s);
    reveal();
  };

  return (
    <OutcomesCard>
      {event.markets.map((m, i) => {
        // a binary event's one row would only repeat the title as its name
        const name = binary ? (m.outcomeLabels?.[0] ?? "Yes") : (m.groupItemTitle ?? m.question);
        const yes = pill(m, 0);
        const no = pill(m, 1);
        return (
          <OutcomeQuoteRow
            key={m.id}
            label={name}
            pct={toPercent(m.outcomePrices[0])}
            tone={binary ? YES_TONE : outcomeTone(i)}
            highlighted={!binary && marketId === m.id}
            yes={{
              text: yes,
              label: binary ? yes : `${yes} · ${name}`,
              pressed: marketId === m.id && side === "yes",
              onClick: () => choose(m.id, "yes"),
            }}
            no={{
              text: no,
              label: binary ? no : `${no} · ${name}`,
              pressed: marketId === m.id && side === "no",
              onClick: () => choose(m.id, "no"),
            }}
          />
        );
      })}
    </OutcomesCard>
  );
}
