import Image from "next/image";
import type { MarketEvent } from "@/types/market";

/**
 * Event icon tile: renders the real market image when the event came from
 * the live Gamma API (`iconUrl`), else the emoji stand-in from fixtures.
 * Size/radius/type-scale come from the call site via `className`
 * (e.g. "size-10 rounded-md text-xl"); `px` is the matching pixel size
 * for next/image.
 *
 * Worldstreet's own markets are the one case that skips the optimizer:
 * their icon is whatever URL an admin pasted on the desk, which can't
 * be an entry in `images.remotePatterns` up front. The API only accepts
 * absolute https URLs for it.
 *
 * Icons load lazily by default — a board renders dozens, most below the
 * fold. `eager` is for the one or two on screen at first paint (the
 * featured market, a market page's lockup): fetched immediately at high
 * priority. This Next deprecates `priority`; eager + fetchPriority is the
 * documented replacement when an image isn't the page's single LCP.
 */
export function EventIcon({
  event,
  className,
  px,
  eager = false,
}: {
  event: Pick<MarketEvent, "icon" | "iconUrl" | "source">;
  className: string;
  px: number;
  eager?: boolean;
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden bg-element-2 ${className}`}
    >
      {event.iconUrl ? (
        <Image
          src={event.iconUrl}
          alt=""
          width={px}
          height={px}
          unoptimized={event.source === "worldstreet"}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : undefined}
          className="size-full object-cover"
        />
      ) : (
        event.icon
      )}
    </span>
  );
}
