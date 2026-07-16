"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { HERO_GAME } from "@/lib/mock-home";
import { HeroFooter } from "./shared";

/**
 * Sports game hero slide (Spain vs. Argentina): team buttons, spread and
 * total pickers left; flags + kickoff center-right. Layout from the
 * game-card hero observed on the live homepage.
 */
export function GameSlide() {
  const g = HERO_GAME;
  return (
    <div className="flex h-full flex-col px-[21px] pb-[18px] pt-[23px]">
      <div>
        <p className="text-sm font-medium text-secondary">{g.breadcrumb}</p>
        <h2 className="mt-1 text-2xl font-semibold leading-8">{g.title}</h2>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 gap-10">
        {/* left controls */}
        <div className="w-[400px] shrink-0">
          {/* moneyline */}
          <div className="flex gap-2">
            <button className="h-11 flex-1 rounded-sm bg-red-100 text-sm font-semibold text-red-700 transition-colors duration-[120ms] ease-out hover:bg-red-200">
              {g.home.name}
            </button>
            <button className="h-11 w-20 rounded-sm border border-border text-sm font-semibold text-secondary transition-colors duration-[120ms] ease-out hover:border-border-hover">
              DRAW
            </button>
            <button className="h-11 flex-1 rounded-sm bg-blue-100 text-sm font-semibold text-blue-700 transition-colors duration-[120ms] ease-out hover:bg-blue-200">
              {g.away.name}
            </button>
          </div>

          <PickerRow label="Spread" lines={[...g.spread.lines]} active={g.spread.active} options={[...g.spread.options]} />
          <PickerRow label="Total" lines={[...g.total.lines]} active={g.total.active} options={[...g.total.options]} />
        </div>

        {/* center: flags + kickoff */}
        <div className="flex flex-1 items-start justify-center gap-12 pt-4">
          <TeamBadge flag={g.home.flag} name={g.home.name} />
          <div className="pt-3 text-center">
            <p className="text-xl font-semibold">{g.kickoff}</p>
            <p className="mt-0.5 text-sm font-medium text-secondary">{g.date}</p>
          </div>
          <TeamBadge flag={g.away.flag} name={g.away.name} />
        </div>
      </div>

      <HeroFooter volumeLabel={g.volume} />
    </div>
  );
}

function PickerRow({
  label,
  lines,
  active,
  options,
}: {
  label: string;
  lines: string[];
  active: string;
  options: string[];
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{label}</span>
        <span className="flex items-center gap-2 text-sm font-semibold">
          <ChevronLeft className="size-4 cursor-pointer text-tertiary hover:text-secondary" />
          {lines.map((l) => (
            <span key={l} className={l === active ? "text-primary" : "text-tertiary"}>
              {l}
            </span>
          ))}
          <ChevronRight className="size-4 cursor-pointer text-tertiary hover:text-secondary" />
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        {options.map((o) => (
          <button
            key={o}
            className="h-10 flex-1 rounded-sm bg-element-2 text-sm font-semibold text-primary transition-colors duration-[120ms] ease-out hover:bg-element-3"
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function TeamBadge({ flag, name }: { flag: string; name: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-5xl leading-none">{flag}</span>
      <span className="text-base font-semibold">{name}</span>
    </div>
  );
}
