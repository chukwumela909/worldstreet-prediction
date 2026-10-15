/** Shared header/footer pieces for hero slides. */

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import type { MarketEvent } from "@/types/market";
import { EventIcon } from "@/components/market/event-icon";
import { WatchButton } from "@/components/market/watch-button";
import { CopyLinkButton } from "./copy-link-button";

/** What a slide passes down to its header beyond the event itself. */
export interface SlideHeaderProps {
  /** Rendered after the actions — the category page's "‹ 1 of N ›" pager. */
  headerExtra?: ReactNode;
  /** Load the icon eagerly: this slide is on screen at first paint. */
  eager?: boolean;
}

/**
 * Featured-market header: icon, "{crumb} · Featured", the title as the
 * link into the market, and copy-link / watchlist actions on the right.
 */
export function HeroHeader({
  icon,
  iconUrl,
  source,
  crumb,
  title,
  slug,
  headerExtra,
  eager = false,
}: {
  icon: string;
  iconUrl?: string;
  /** Kept so EventIcon's admin-pasted-URL guard still applies here. */
  source?: MarketEvent["source"];
  crumb: string;
  title: string;
  /** Polymarket event slug — enables the title link and the actions. */
  slug?: string;
} & SlideHeaderProps) {
  return (
    <div className="flex items-center gap-3">
      {(icon || iconUrl) && (
        <EventIcon
          event={{ icon, iconUrl, source }}
          className="size-12 rounded-md text-2xl"
          px={48}
          eager={eager}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-secondary">{crumb} · Featured</p>
        <h2 className="mt-0.5 line-clamp-2 text-base font-semibold sm:text-xl">
          {slug ? (
            <Link href={`/event/${slug}`} className="hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </h2>
      </div>
      {(slug || headerExtra) && (
        <div className="flex shrink-0 items-center gap-1 self-start">
          {slug && (
            <>
              <CopyLinkButton path={`/event/${slug}`} />
              <WatchButton slug={slug} size="md" />
            </>
          )}
          {headerExtra}
        </div>
      )}
    </div>
  );
}

/** "Market · Pays out · Odds" captions over a featured market's outcome rows. */
export function QuoteColumnLabels() {
  return (
    <div className="mb-1 flex items-center gap-3 text-xs text-secondary">
      <span className="flex-1">Market</span>
      <span>Pays out</span>
      <span className="w-16 text-center">Odds</span>
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
    <div className="flex items-center justify-between pt-4 text-xs text-secondary">
      <span>{volumeLabel ?? (volume ? heroVolume(volume) : "")}</span>
      <span className="flex items-center gap-2">
        {endDate && <>Ends {heroDate(endDate)} ·</>}
        <span className="flex items-center gap-1 font-semibold">
          <LogoMark />
          WorldStreet
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
 * The WorldStreet mark: black W on a lime rounded square (the same file is
 * app/icon.svg, the favicon). Full-colour asset, so it carries its own
 * contrast on both themes. SVG, so next/image serves it as-is.
 */
export function LogoMark({
  className = "size-3.5",
  eager = false,
}: {
  className?: string;
  /** The header's copy is above the fold on every page — load it at once. */
  eager?: boolean;
}) {
  return (
    <Image
      src="/worldstreet-logo.svg"
      alt=""
      width={32}
      height={32}
      unoptimized
      loading={eager ? "eager" : "lazy"}
      className={className}
      aria-hidden
    />
  );
}
