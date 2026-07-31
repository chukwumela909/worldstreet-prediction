"use client";

import Link from "next/link";
import { isBinary, type MarketEvent } from "@/types/market";
import { toCents } from "@/lib/format";
import { useTradeSelection } from "./trade-context";

/**
 * Right-rail panel for Polymarket-fed events (~306px). Display only:
 * these markets are mirrored for their prices and charts, and nothing
 * here can be traded — Worldstreet's own book is the naira-denominated
 * Local category, which has a real panel at /local/[slug].
 *
 * It used to execute against a localStorage store with demo cash. That
 * was fine as a UI demo and dangerous next to a live wallet, so the
 * order form is gone rather than disabled: nothing on this page should
 * look one click away from spending money.
 *
 * The Yes/No pills still select, because the outcome rows and the chart
 * read the same selection.
 */
export function TradePanel({ event }: { event: MarketEvent }) {
  const { marketId, side, setSide } = useTradeSelection();
  const market = event.markets.find((m) => m.id === marketId) ?? event.markets[0];

  return (
    <aside className="w-full lg:w-[306px] lg:shrink-0">
      <div className="lg:sticky lg:top-[124px] rounded-xl border border-border bg-surface p-4 shadow-card">
        {/* what's being shown */}
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-element-2 text-lg">
            {event.icon}
          </span>
          <div className="min-w-0 text-sm font-semibold leading-tight">
            <p className="truncate text-secondary">{event.title}</p>
            {!isBinary(event) && (
              <p className="truncate">
                {market.groupItemTitle}
                <span className={side === "yes" ? "text-yes" : "text-no"}>
                  {" "}· {side === "yes" ? "Yes" : "No"}
                </span>
              </p>
            )}
          </div>
        </div>

        {/* prices */}
        <div className="mt-4 flex gap-2">
          <SideToggle
            label={`Yes ${toCents(market.outcomePrices[0])}`}
            active={side === "yes"}
            activeClass="bg-yes-solid text-white"
            onClick={() => setSide("yes")}
          />
          <SideToggle
            label={`No ${toCents(market.outcomePrices[1])}`}
            active={side === "no"}
            activeClass="bg-no-solid text-white"
            onClick={() => setSide("no")}
          />
        </div>

        <Link
          href="/?category=local"
          className="mt-4 flex h-11 w-full items-center justify-center rounded-md bg-accent text-base font-semibold text-on-accent transition-colors hover:bg-accent-hover"
        >
          Trade Local markets
        </Link>
        <p className="mt-3 text-center text-xs leading-5 text-tertiary">
          Local markets are credit-denominated and settle against
          Worldstreet.
        </p>
      </div>
    </aside>
  );
}

function SideToggle({
  label,
  active,
  activeClass,
  onClick,
}: {
  label: string;
  active: boolean;
  activeClass: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-11 flex-1 rounded-sm text-sm font-semibold transition-colors ${
        active
          ? activeClass
          : "bg-element-2 text-secondary hover:bg-element-3 hover:text-primary"
      }`}
    >
      {label}
    </button>
  );
}
