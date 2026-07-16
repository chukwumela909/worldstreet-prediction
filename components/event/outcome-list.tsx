"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { type Market, type MarketEvent } from "@/types/market";
import { formatVolume, toCents, toPercent } from "@/lib/format";
import { dayDelta } from "@/lib/mock-series";
import { useTradeSelection } from "./trade-context";

/**
 * Outcome rows for multi-outcome events: name/vol · % + delta ·
 * Buy Yes n¢ / Buy No n¢. Clicking a buy button selects that
 * market+side in the trade panel (selected = solid button).
 */
export function OutcomeList({ event }: { event: MarketEvent }) {
  return (
    <div className="divide-y divide-border border-t border-border">
      {event.markets.map((m) => (
        <OutcomeRow key={m.id} market={m} />
      ))}
    </div>
  );
}

function OutcomeRow({ market }: { market: Market }) {
  const { marketId, side, select } = useTradeSelection();
  const pct = toPercent(market.outcomePrices[0]);
  const delta = dayDelta(market);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold">
          {market.groupItemTitle ?? market.question}
        </p>
        <p className="text-[13px] font-medium text-tertiary">
          {formatVolume(market.volume)}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-[26px] font-semibold leading-none">{pct}%</span>
        {delta !== 0 && (
          <span
            className={`flex items-center text-xs font-semibold ${
              delta > 0 ? "text-yes" : "text-no"
            }`}
          >
            {delta > 0 ? (
              <ChevronUp className="size-3.5" strokeWidth={3} />
            ) : (
              <ChevronDown className="size-3.5" strokeWidth={3} />
            )}
            {Math.abs(delta)}%
          </span>
        )}
      </div>

      <div className="flex w-full gap-2 sm:w-auto">
        <BuySideButton
          label={`Buy Yes ${toCents(market.outcomePrices[0])}`}
          side="yes"
          selected={marketId === market.id && side === "yes"}
          onClick={() => select(market.id, "yes")}
        />
        <BuySideButton
          label={`Buy No ${toCents(market.outcomePrices[1])}`}
          side="no"
          selected={marketId === market.id && side === "no"}
          onClick={() => select(market.id, "no")}
        />
      </div>
    </div>
  );
}

function BuySideButton({
  label,
  side,
  selected,
  onClick,
}: {
  label: string;
  side: "yes" | "no";
  selected: boolean;
  onClick: () => void;
}) {
  const palette =
    side === "yes"
      ? selected
        ? "bg-yes-solid text-white"
        : "bg-yes-tint text-yes hover:bg-yes-solid hover:text-white"
      : selected
        ? "bg-no-solid text-white"
        : "bg-no-tint text-no hover:bg-no-solid hover:text-white";
  return (
    <button
      onClick={onClick}
      className={`h-11 flex-1 whitespace-nowrap rounded-sm text-sm font-semibold transition-colors sm:w-[124px] sm:flex-none ${palette}`}
    >
      {label}
    </button>
  );
}
