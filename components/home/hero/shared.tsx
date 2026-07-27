/** Shared header/footer pieces for hero slides. */

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
 * The bare Worldstreet "W" — no badge, no plate (WorldStreet1x.png). Monochrome
 * by design: it takes `text-primary`, so it reads white on the dark theme the
 * way the source asset does, and flips to ink on light instead of vanishing.
 */
export function LogoMark({ className = "h-3 w-auto" }: { className?: string }) {
  return (
    <svg
      viewBox="11 26 78 48"
      className={`${className} text-primary`}
      fill="currentColor"
      aria-hidden
    >
      <polygon points="11.7,27 38.4,73 53.5,30" />
      <polygon points="46.5,30 61.6,73 88.3,27" />
    </svg>
  );
}
