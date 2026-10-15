"use client";

import { useMemo, useState } from "react";
import {
  ChevronLeftIcon as ChevronLeft,
  ChevronRightIcon as ChevronRight,
} from "@heroicons/react/24/outline";
import { isBinary, type MarketEvent } from "@/types/market";
import type { FeaturedGame } from "@/lib/polymarket";
import { useLivePrices } from "@/lib/use-live-prices";
import { BinarySlide } from "./hero/binary-slide";
import { GameSlide } from "./hero/game-slide";
import { MarketSlide } from "./hero/market-slide";

/**
 * Featured hero carousel — the real site's exact mechanism (recon §9):
 * every slide stays mounted, absolutely positioned, offset by
 * translateX((i - active) * 100%) with NO transform transition — advancing
 * is an instant swap (only `opacity 120ms ease-in` is declared). Only the
 * active slide and its immediate neighbors are `visibility: visible`.
 * No auto-advance: the real hero moves only via dots / pager pills.
 */
const HERO_HEIGHT = "h-[480px]";

/** Pager pills are narrow — trim long market questions to fit. */
function shortLabel(title: string): string {
  const trimmed = title.replace(/\?$/, "");
  return trimmed.length > 28 ? `${trimmed.slice(0, 27).trimEnd()}…` : trimmed;
}

interface Slide {
  key: string;
  label: string;
  /** `eager`: this slide is the one on screen at first paint. */
  render: (eager: boolean) => React.ReactNode;
}

export function FeaturedHero({
  events: initialEvents,
  game,
}: {
  events: MarketEvent[];
  game: FeaturedGame | null;
}) {
  // slide prices tick with the poll; slide *selection* follows along
  const events = useLivePrices(initialEvents);
  const slides = useMemo<Slide[]>(() => {
    const multi = events.find((e) => !isBinary(e));
    // Longest-horizon binary event, so the slide has real price history
    // and doesn't go stale the moment a daily market settles.
    const binary = events
      .filter(isBinary)
      .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""))[0];

    const list: Slide[] = [];
    if (multi) {
      list.push({
        key: "market",
        label: multi.title,
        render: (eager) => <MarketSlide event={multi} eager={eager} />,
      });
    }
    if (game) {
      list.push({
        key: "game",
        label: shortLabel(game.title),
        render: (eager) => <GameSlide game={game} eager={eager} />,
      });
    }
    if (binary) {
      list.push({
        key: "binary",
        label: shortLabel(binary.title),
        render: (eager) => <BinarySlide event={binary} eager={eager} />,
      });
    }
    return list;
  }, [events, game]);

  const [index, setIndex] = useState(0);
  const n = slides.length;
  if (n === 0) return null;
  const prev = (index - 1 + n) % n;
  const next = (index + 1) % n;

  /** shortest-path offset from active, in slide widths (matches real DOM) */
  const offsetFor = (i: number) => {
    let d = i - index;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    return d;
  };

  return (
    <div className="min-w-0 flex-1">
      <div
        className={`relative ${HERO_HEIGHT} overflow-hidden rounded-xl border border-border bg-surface shadow-card`}
      >
        <div className="absolute inset-0 overflow-hidden">
          {slides.map((s, i) => {
            const d = offsetFor(i);
            return (
              <div
                key={s.key}
                className="absolute inset-0"
                style={{
                  transform: d === 0 ? "none" : `translateX(${d * 100}%)`,
                  visibility: Math.abs(d) <= 1 ? "visible" : "hidden",
                  transition: "opacity 120ms ease-in",
                }}
                aria-hidden={d !== 0}
              >
                {s.render(i === 0)}
              </div>
            );
          })}
        </div>
      </div>

      {/* dots + arrows strip */}
      <div className="mt-2 flex h-10 items-center">
        <div className="-mx-1 flex items-center">
          {slides.map((s, i) => (
            <button
              key={s.key}
              aria-label={`Show featured market: ${s.label}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => setIndex(i)}
              className="flex h-8 items-center px-1"
            >
              <span
                className={`h-1.5 rounded-full transition-all duration-300 ease-in-out ${
                  i === index
                    ? "w-4 bg-primary"
                    : "w-1.5 bg-element-3 hover:bg-border-active"
                }`}
              />
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setIndex(prev)}
            aria-label={`Previous featured market: ${slides[prev].label}`}
            className="flex size-8 items-center justify-center rounded-full text-secondary transition-colors hover:bg-element-2 hover:text-primary"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            onClick={() => setIndex(next)}
            aria-label={`Next featured market: ${slides[next].label}`}
            className="flex size-8 items-center justify-center rounded-full text-secondary transition-colors hover:bg-element-2 hover:text-primary"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
