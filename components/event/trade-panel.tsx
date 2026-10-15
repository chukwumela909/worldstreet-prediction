"use client";

import Link from "next/link";
import { isBinary, type MarketEvent } from "@/types/market";
import { toCents } from "@/lib/format";
import { EventIcon } from "@/components/market/event-icon";
import { useTradeSelection } from "./trade-context";

/**
 * Body of the "Trade outcome" card for Polymarket-fed events (the card,
 * its title and the narrow-screen sheet come from MarketDetail). Display
 * only: these markets are mirrored for their prices and charts, and
 * nothing here can be traded — Worldstreet's own book is the
 * naira-denominated Local category, which has a real panel at
 * /local/[slug].
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
    <div>
      {/* what's being shown */}
      <div className="flex items-center gap-2.5">
        <EventIcon event={event} className="size-9 rounded-md text-lg" px={36} />
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
          side="yes"
          active={side === "yes"}
          onClick={() => setSide("yes")}
        />
        <SideToggle
          label={`No ${toCents(market.outcomePrices[1])}`}
          side="no"
          active={side === "no"}
          onClick={() => setSide("no")}
        />
      </div>

      <Link
        href="/?category=local"
        className="mt-4 flex h-11 w-full items-center justify-center rounded-md bg-accent text-base font-semibold text-on-accent transition-colors hover:bg-accent-hover"
      >
        Trade Local markets
      </Link>
      <p className="mt-3 text-center text-xs leading-5 text-secondary">
        Local markets are credit-denominated and settle against
        WorldStreet.
      </p>
    </div>
  );
}

/** Buy-button state model (AGENTS.md): rest = tint, selected = solid. */
export function SideToggle({
  label,
  side,
  active,
  onClick,
}: {
  label: string;
  side: "yes" | "no";
  active: boolean;
  onClick: () => void;
}) {
  const palette =
    side === "yes"
      ? active
        ? "bg-yes-solid text-white"
        : "bg-yes-tint text-yes hover:bg-yes-solid hover:text-white"
      : active
        ? "bg-no-solid text-white"
        : "bg-no-tint text-no hover:bg-no-solid hover:text-white";
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-11 min-w-0 flex-1 truncate rounded-sm px-2 text-sm font-semibold transition-colors ${palette}`}
    >
      {label}
    </button>
  );
}
