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
 * The Worldstreet badge — black "W" on a gold rounded square, the lockup
 * worldstreetgold.com serves as its icon. Drawn from tokens (`fill-accent` /
 * `fill-on-accent`) rather than the brand's pinned hex, so a repoint of the
 * accent primitive carries the mark with it.
 */
export function LogoMark({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <rect width="100" height="100" rx="12" className="fill-accent" />
      <g className="fill-on-accent">
        <polygon points="11.7,27 38.4,73 53.5,30" />
        <polygon points="46.5,30 61.6,73 88.3,27" />
      </g>
    </svg>
  );
}
