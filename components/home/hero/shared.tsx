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

export function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
      <path d="M4 4h16v3.2L12 10 4 7.2V4zm0 6.4L12 13.2l8-2.8v3.2L12 16.4 4 13.6v-3.2zm0 6.4 8 2.8 8-2.8V20l-8 2.8L4 20v-3.2z" />
    </svg>
  );
}
