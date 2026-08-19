/** Shared header/footer pieces for hero slides. */

import Image from "next/image";
import { EventIcon } from "@/components/market/event-icon";

export function HeroHeader({
  icon,
  iconUrl,
  crumb,
  title,
}: {
  icon: string;
  iconUrl?: string;
  crumb: string;
  title: string;
}) {
  return (
    <div className="flex items-center gap-4">
      <EventIcon
        event={{ icon, iconUrl }}
        className="size-14 rounded-lg text-3xl"
        px={56}
      />
      <div>
        <p className="text-sm font-medium text-secondary">{crumb}</p>
        <h2 className="text-2xl font-semibold leading-8">{title}</h2>
      </div>
    </div>
  );
}

export function HeroFooter({
  volume,
  endDate,
  volumeLabel,
}: {
  volume?: string;
  endDate?: string;
  volumeLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between pt-3 text-[13px] font-medium tracking-tight text-tertiary">
      <span>{volumeLabel ?? (volume ? heroVolume(volume) : "")}</span>
      <span className="flex items-center gap-2">
        {endDate && <>Ends {heroDate(endDate)} ·</>}
        <span className="flex items-center gap-1 font-semibold">
          <LogoMark />
          Worldstreet
        </span>
      </span>
    </div>
  );
}

function heroVolume(volume: string): string {
  const n = parseFloat(volume);
  if (n >= 1_000_000_000) return `$${Math.round(n / 1_000_000_000)}B Vol`;
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M Vol`;
  return `$${Math.round(n / 1_000)}K Vol`;
}

function heroDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The Worldstreet badge (WorldStreet4.png): black W on a gold rounded square.
 * Full-color asset, so it carries its own contrast on both themes.
 */
export function LogoMark({ className = "h-3 w-auto" }: { className?: string }) {
  return (
    <Image
      src="/worldstreet-logo.png"
      alt=""
      width={372}
      height={339}
      className={className}
      aria-hidden
    />
  );
}
