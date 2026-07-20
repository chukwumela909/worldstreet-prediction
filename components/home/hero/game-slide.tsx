"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { FeaturedGame, GameLineGroup } from "@/lib/polymarket";
import { useAuth } from "@/components/auth/auth-context";
import { HeroFooter } from "./shared";

/**
 * Sports game hero slide: three-way moneyline buttons, spread and total
 * pickers left; team badges + kickoff center-right. Layout from the
 * game-card hero observed on the live homepage; data is a live soccer
 * game picked server-side (see getFeaturedGame).
 */
export function GameSlide({ game }: { game: FeaturedGame }) {
  const { user, openAuth } = useAuth();
  const gate = () => {
    if (!user) openAuth();
  };
  return (
    <div className="flex h-full flex-col px-[21px] pb-[18px] pt-[23px]">
      <div>
        <p className="text-sm font-medium text-secondary">{game.breadcrumb}</p>
        <h2 className="mt-1 text-2xl font-semibold leading-8">{game.title}</h2>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 gap-10">
        {/* left controls */}
        <div className="w-full min-w-0 md:w-[400px] md:shrink-0">
          {/* moneyline */}
          <div className="flex gap-2">
            <button
              onClick={gate}
              className="h-11 min-w-0 flex-1 truncate rounded-sm bg-red-100 px-2 text-sm font-semibold text-red-700 transition-colors duration-[120ms] ease-out hover:bg-red-200"
            >
              {game.home.name} {game.home.pct}%
            </button>
            {game.draw && (
              <button
                onClick={gate}
                className="h-11 w-24 shrink-0 rounded-sm border border-border text-sm font-semibold text-secondary transition-colors duration-[120ms] ease-out hover:border-border-hover"
              >
                DRAW {game.draw.pct}%
              </button>
            )}
            <button
              onClick={gate}
              className="h-11 min-w-0 flex-1 truncate rounded-sm bg-blue-100 px-2 text-sm font-semibold text-blue-700 transition-colors duration-[120ms] ease-out hover:bg-blue-200"
            >
              {game.away.name} {game.away.pct}%
            </button>
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
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{label}</span>
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
      <div className="mt-2 flex gap-2">
        {group.options.map((o) => (
          <button
            key={o.label}
            onClick={onPick}
            className="h-10 min-w-0 flex-1 truncate rounded-sm bg-element-2 px-2 text-sm font-semibold text-primary transition-colors duration-[120ms] ease-out hover:bg-element-3"
          >
            {o.label} · {Math.round(o.price * 100)}¢
          </button>
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
