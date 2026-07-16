"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { MarketEvent } from "@/types/market";
import { MOCK_EVENTS } from "@/lib/mock-events";
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
const HERO_HEIGHT = "h-[471px]";

interface Slide {
  key: string;
  label: string;
  render: () => React.ReactNode;
}

export function FeaturedHero({ event }: { event: MarketEvent }) {
  const slides = useMemo<Slide[]>(() => {
    const btc = MOCK_EVENTS.find((e) => e.slug === "btc-150k-2026");
    const list: Slide[] = [
      { key: "market", label: event.title, render: () => <MarketSlide event={event} /> },
      { key: "game", label: "Spain vs. Argentina", render: () => <GameSlide /> },
    ];
    if (btc) {
      list.push({ key: "btc", label: "Bitcoin $150k", render: () => <BinarySlide event={btc} /> });
    }
    return list;
  }, [event]);

  const [index, setIndex] = useState(0);
  const n = slides.length;
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
        className={`relative ${HERO_HEIGHT} overflow-hidden rounded-[18px] border border-border bg-hero-surface`}
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
                {s.render()}
              </div>
            );
          })}
        </div>
      </div>

      {/* dots + pagers strip */}
      <div className="mt-2 flex h-14 items-center">
        <div className="-mx-1.5 flex items-center pl-4">
          {slides.map((s, i) => (
            <button
              key={s.key}
              aria-label={`Go to ${s.label}`}
              onClick={() => setIndex(i)}
              className="flex h-[30px] items-center px-1.5"
            >
              <span
                className={`h-1.5 rounded-full transition-all duration-300 ease-in-out ${
                  i === index
                    ? "w-[26px] bg-border-active"
                    : "w-1.5 bg-element-3 hover:bg-border-active"
                }`}
              />
            </button>
          ))}
        </div>
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <button
            onClick={() => setIndex(prev)}
            className="flex h-10 items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-base text-primary transition-colors duration-[120ms] ease-out hover:bg-element-2"
          >
            <ChevronLeft className="size-4 text-secondary" />
            {slides[prev].label}
          </button>
          <button
            onClick={() => setIndex(next)}
            className="flex h-10 items-center gap-1.5 rounded-full bg-surface pl-4 pr-3 text-base text-primary transition-colors duration-[120ms] ease-out hover:bg-element-2"
          >
            {slides[next].label}
            <ChevronRight className="size-4 text-secondary" />
          </button>
        </div>
      </div>
    </div>
  );
}
