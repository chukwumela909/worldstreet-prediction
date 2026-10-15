"use client";

import { useState } from "react";
import Image from "next/image";
import type { GameTeam } from "@/types/market";

/**
 * A team's crest beside its name — the reference's ParticipantMark. The
 * logo comes from the feed (lib/polymarket.ts only keeps URLs on the
 * hosts next.config.ts allows); a team without one, or whose logo fails
 * to load, shows its abbreviation instead. Decorative: the name is always
 * printed next to it.
 */
export function TeamMark({
  team,
  px,
  className,
}: {
  team: GameTeam;
  /** Rendered size in px, matching the `size-*` in className. */
  px: number;
  className: string;
}) {
  // the URL that failed, so a new logo gets its own attempt
  const [failed, setFailed] = useState<string | null>(null);
  const logo = team.logoUrl && failed !== team.logoUrl ? team.logoUrl : null;

  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center overflow-hidden ${className}`}
    >
      {logo ? (
        <Image
          src={logo}
          alt=""
          width={px}
          height={px}
          loading="lazy"
          onError={() => setFailed(logo)}
          className="size-full object-contain"
        />
      ) : (
        <span className="text-xs font-medium uppercase text-secondary">
          {(team.abbreviation ?? team.name).slice(0, 4)}
        </span>
      )}
    </span>
  );
}
