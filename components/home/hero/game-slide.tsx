"use client";

import {
  ChevronLeftIcon as ChevronLeft,
  ChevronRightIcon as ChevronRight,
} from "@heroicons/react/24/outline";
import type { FeaturedGame, GameLineGroup } from "@/lib/polymarket";
import { useAuth } from "@/components/auth/auth-context";
import { toMultiplier } from "@/lib/format";
import { OutcomeRow } from "@/components/market/outcome-row";
import { PILL_TONE, QuotePill, outcomeTone } from "@/components/market/outcome-quote";
import { HeroFooter, HeroHeader, QuoteColumnLabels, type SlideHeaderProps } from "./shared";

/**
 * Sports game hero slide: the three-way moneyline as quote rows, spread
 * and total pickers under them; team badges + kickoff on the right. Data
 * is a live soccer game picked server-side (see getFeaturedGame).
 */
export function GameSlide({
  game,
  headerExtra,
  eager,
}: { game: FeaturedGame } & SlideHeaderProps) {
  const { user, openAuth } = useAuth();
  const gate = () => {
    if (!user) openAuth();
  };
  const href = `/event/${game.slug}`;
  const moneyline = [
    { label: game.home.name, pct: game.home.pct },
    ...(game.draw ? [{ label: "Draw", pct: game.draw.pct }] : []),
    { label: game.away.name, pct: game.away.pct },
  ];

  return (
    <div className="flex h-full flex-col p-6">
      <HeroHeader
        headerExtra={headerExtra}
        eager={eager}
        icon=""
        iconUrl={game.iconUrl}
        crumb={game.breadcrumb}
        title={game.title}
        slug={game.slug}
      />

      <div className="mt-5 flex min-h-0 flex-1 gap-10">
        {/* left controls */}
        <div className="w-full min-w-0 md:w-[400px] md:shrink-0">
          <QuoteColumnLabels />
          <div className="flex flex-col gap-1">
            {moneyline.map((o, i) => (
              <OutcomeRow
                key={o.label}
                label={o.label}
                tone={outcomeTone(i)}
                pct={o.pct}
                multiplier={toMultiplier(String(o.pct / 100))}
                href={href}
              />
            ))}
          </div>

          {game.spread && (
            <PickerRow label="Spread" group={game.spread} onPick={gate} />
          )}
          {game.total && <PickerRow label="Total" group={game.total} onPick={gate} />}
        </div>

        {/* center: badges + kickoff */}
        <div className="hidden flex-1 items-start justify-center gap-12 pt-4 md:flex">
          <TeamBadge name={game.home.name} />
          <div className="pt-3 text-center">
            <p className="text-xl font-semibold">{game.kickoff}</p>
            <p className="mt-0.5 text-sm font-medium text-secondary">{game.date}</p>
          </div>
          <TeamBadge name={game.away.name} />
        </div>
      </div>

      <HeroFooter volume={game.volume} />
    </div>
  );
}

function PickerRow({
  label,
  group,
  onPick,
}: {
  label: string;
  group: GameLineGroup;
  onPick: () => void;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold">{label}</span>
        <span className="flex items-center gap-2 text-sm font-semibold">
          <ChevronLeft className="size-4 cursor-pointer text-tertiary hover:text-secondary" />
          {group.lines.map((l) => (
            <span
              key={l}
              className={l === group.active ? "text-primary" : "text-tertiary"}
            >
              {l}
            </span>
          ))}
          <ChevronRight className="size-4 cursor-pointer text-tertiary hover:text-secondary" />
        </span>
      </div>
      <div className="mt-1.5 flex gap-2">
        {group.options.map((o) => (
          <QuotePill
            key={o.label}
            tone={PILL_TONE}
            onClick={onPick}
            className="min-w-0 flex-1 truncate"
          >
            {o.label} · {Math.round(o.price * 100)}¢
          </QuotePill>
        ))}
      </div>
    </div>
  );
}

function TeamBadge({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return (
    <div className="flex flex-col items-center gap-2">
      <span
        className="flex size-12 items-center justify-center rounded-full text-sm font-bold text-white"
        style={{
          background: `linear-gradient(135deg, hsl(${h} 60% 50%), hsl(${(h + 80) % 360} 60% 40%))`,
        }}
      >
        {initials}
      </span>
      <span className="max-w-28 truncate text-base font-semibold">{name}</span>
    </div>
  );
}
