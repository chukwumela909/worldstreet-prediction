import { Clock, Link2 } from "lucide-react";
import type { MarketEvent } from "@/types/market";
import { formatVolume } from "@/lib/format";
import { WatchButton } from "@/components/market/watch-button";

/** Event page header: icon, breadcrumb category, title, volume + end date. */
export function EventHeader({ event }: { event: MarketEvent }) {
  const endDate = new Date(event.endDate + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="flex items-start gap-3.5">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-element-2 text-3xl">
        {event.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-secondary">
          {event.category}
          {event.subcategory && ` · ${event.subcategory}`}
        </p>
        <h1 className="mt-0.5 truncate text-xl font-semibold tracking-tight">
          {event.title}
        </h1>
        <div className="mt-1.5 flex items-center gap-3 text-[13px] font-medium text-tertiary">
          <span>{formatVolume(event.volume)}</span>
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" />
            {endDate}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-secondary">
        <Link2 className="size-4.5 cursor-pointer hover:text-primary" />
        <WatchButton slug={event.slug} size="md" />
      </div>
    </div>
  );
}
