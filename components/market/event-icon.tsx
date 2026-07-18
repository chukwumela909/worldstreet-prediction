import Image from "next/image";
import type { MarketEvent } from "@/types/market";

/**
 * Event icon tile: renders the real market image when the event came from
 * the live Gamma API (`iconUrl`), else the emoji stand-in from fixtures.
 * Size/radius/type-scale come from the call site via `className`
 * (e.g. "size-10 rounded-md text-xl"); `px` is the matching pixel size
 * for next/image.
 */
export function EventIcon({
  event,
  className,
  px,
}: {
  event: Pick<MarketEvent, "icon" | "iconUrl">;
  className: string;
  px: number;
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
          className="size-full object-cover"
        />
      ) : (
        event.icon
      )}
    </span>
  );
}
