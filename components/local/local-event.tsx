"use client";

import { BarChart3, Clock, Droplets } from "lucide-react";
import { isBinary, type Market, type MarketEvent } from "@/types/market";
import { formatNaira, formatNairaCompact, toPercent } from "@/lib/format";
import { priceToKobo } from "@/lib/local-trades";
import { EventIcon } from "@/components/market/event-icon";
import { BuySideButton } from "@/components/event/outcome-list";
import { TradeProvider, useTradeSelection } from "@/components/event/trade-context";
import { BaysePriceChart } from "@/components/local/bayse-price-chart";
import { LocalTradePanel } from "@/components/local/local-trade-panel";
import { useLiveBayseEvent } from "@/lib/use-live-bayse";

/**
 * Detail page body for a Bayse (Local) event: header with naira stats,
 * price chart, outcome rows, and rules, with the naira trade panel on
 * the right. Clicking a buy pill selects that market+side in the panel,
 * same as the Polymarket event page.
 *
 * Prices poll from the server-rendered snapshot, so what the panel
 * stakes against stays close to what the API will re-price it at.
 */
export function LocalEvent({ event: initial }: { event: MarketEvent }) {
  const event = useLiveBayseEvent(initial);

  return (
    <TradeProvider event={event}>
      <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 pb-16 pt-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <LocalHeader event={event} />
          <div className="mt-5">
            <BaysePriceChart event={event} />
          </div>
          {!isBinary(event) && (
            <div className="mt-5">
              <LocalOutcomeList event={event} />
            </div>
          )}
          <LocalRules event={event} />
        </div>
        <LocalTradePanel event={event} />
      </main>
    </TradeProvider>
  );
}

/* ---------- header ---------- */

function LocalHeader({ event }: { event: MarketEvent }) {
  const endDate = event.endDate
    ? new Date(event.endDate + "T00:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <div className="flex items-start gap-3.5">
      <EventIcon event={event} className="size-14 rounded-lg text-3xl" px={56} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-secondary">
          Local · {event.tags?.[0] ?? event.category}
        </p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight">
          {event.title}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[13px] font-medium text-tertiary">
          {event.trades !== undefined && (
            <span className="flex items-center gap-1">
              <BarChart3 className="size-3.5" />
              {event.trades.toLocaleString("en-US")} Trades
            </span>
          )}
          {event.liquidityNgn && (
            <span className="flex items-center gap-1">
              <Droplets className="size-3.5" />
              {formatNairaCompact(parseFloat(event.liquidityNgn))}
            </span>
          )}
          {endDate && (
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" />
              Ends {endDate}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- outcomes (multi) ---------- */

/** Outcome price as ₦ per ₦100 share, e.g. "₦58". */
function nairaPrice(market: Market, side: 0 | 1): string {
  return formatNaira(priceToKobo(market.outcomePrices[side]));
}

function LocalOutcomeList({ event }: { event: MarketEvent }) {
  return (
    <div className="divide-y divide-border border-t border-border">
      {event.markets.map((m) => (
        <LocalOutcomeRow key={m.id} market={m} />
      ))}
    </div>
  );
}

function LocalOutcomeRow({ market }: { market: Market }) {
  const { marketId, side, select } = useTradeSelection();
  const pct = toPercent(market.outcomePrices[0]);
  const name = market.groupItemTitle ?? market.question;
  const labels = market.outcomeLabels ?? ["Yes", "No"];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">{name}</p>
      <span className="text-[26px] font-semibold leading-none">{pct}%</span>
      <div className="flex w-full gap-2 sm:w-auto">
        <BuySideButton
          side="yes"
          label={`Buy ${labels[0]} ${nairaPrice(market, 0)}`}
          selected={marketId === market.id && side === "yes"}
          onClick={() => select(market.id, "yes")}
        />
        <BuySideButton
          side="no"
          label={`Buy ${labels[1]} ${nairaPrice(market, 1)}`}
          selected={marketId === market.id && side === "no"}
          onClick={() => select(market.id, "no")}
        />
      </div>
    </div>
  );
}

/* ---------- rules ---------- */

/** Relay rules/description are lightly markdown-ish; render as plain text. */
function plainText(raw: string): string {
  return raw.replace(/\*\*/g, "").replace(/\r\n/g, "\n").trim();
}

function LocalRules({ event }: { event: MarketEvent }) {
  const binary = isBinary(event);
  const sections = [
    ...(event.description ? [{ id: "about", title: "About this market", body: event.description }] : []),
    ...event.markets
      .filter((m) => m.rules)
      .map((m) => ({
        id: m.id,
        title: binary ? "Rules" : `Rules — ${m.groupItemTitle ?? m.question}`,
        body: m.rules!,
      })),
  ];
  if (sections.length === 0 && !event.resolutionSource) return null;

  return (
    <div className="mt-8 flex flex-col gap-5">
      {sections.map((s) => (
        <section key={s.id}>
          <h2 className="text-base font-semibold">{s.title}</h2>
          <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-secondary">
            {plainText(s.body)}
          </p>
        </section>
      ))}
      {event.resolutionSource && (
        <p className="text-sm text-tertiary">
          Resolution source:{" "}
          <a
            href={event.resolutionSource}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-accent hover:underline"
          >
            {event.resolutionSource}
          </a>
        </p>
      )}
    </div>
  );
}
