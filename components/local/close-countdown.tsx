"use client";

import { Clock } from "lucide-react";
import type { MarketEvent } from "@/types/market";
import { useTickingNow } from "@/lib/use-now";
import {
  formatCountdown,
  showsCountdown,
  tradingStopsAt,
} from "@/lib/countdown";

/**
 * Live "time left to trade" for a Local market, in red — the automated
 * 15-minute series live and die inside the time someone spends reading
 * the page, and a date is no use to them.
 *
 * Renders nothing at all for markets that are days out, so the colour
 * keeps meaning something: on a card or a header, red here always means
 * "this is closing now".
 */
export function CloseCountdown({
  event,
  className = "",
}: {
  event: MarketEvent;
  className?: string;
}) {
  const now = useTickingNow();
  const stopsAt = tradingStopsAt(event);
  if (stopsAt === null || now === null) return null;

  const msLeft = stopsAt - now;
  if (msLeft > 0 && !showsCountdown(event, msLeft)) return null;

  return (
    <span
      className={`flex items-center gap-1 font-semibold text-no ${className}`}
    >
      <Clock className="size-3.5 shrink-0" />
      {msLeft <= 0
        ? "Trading closed"
        : `${event.countdown ? "Trading stops in" : "Closes in"} ${formatCountdown(msLeft)}`}
    </span>
  );
}
