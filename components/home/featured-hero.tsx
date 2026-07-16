"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { MarketEvent } from "@/types/market";
import { MOCK_EVENTS } from "@/lib/mock-events";
import { BinarySlide } from "./hero/binary-slide";
import { GameSlide } from "./hero/game-slide";
import { MarketSlide } from "./hero/market-slide";

/**
 * Featured hero carousel. Mirrors the real site's mechanism (recon §9):
 * React state swap with a 300ms fade (their site-wide motion constant),
 * width-animated dots (300ms ease-in-out), pager pills labeled with the
 * neighboring slides. Auto-advances every 8s, paused while hovered.
 */
const AUTO_ADVANCE_MS = 8000;
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
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    if (hovering) return;
    const id = setInterval(
      () => setIndex((i) => (i + 1) % slides.length),
      AUTO_ADVANCE_MS,
    );
    return () => clearInterval(id);
  }, [hovering, slides.length]);

  const prev = (index - 1 + slides.length) % slides.length;
  const next = (index + 1) % slides.length;

  return (
    <div className="min-w-0 flex-1">
      {/* card: slides stacked, active one fades in over 300ms */}
      <div
        className={`relative ${HERO_HEIGHT} overflow-hidden rounded-[18px] border border-border bg-hero-surface`}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        {slides.map((s, i) => (
          <div
            key={s.key}
            className={`absolute inset-0 transition-opacity duration-300 ease-in-out ${
              i === index ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            aria-hidden={i !== index}
          >
            {s.render()}
          </div>
        ))}
      </div>

      {/* dots + pagers strip */}
      <div className="mt-2 flex h-14 items-center">
        <div className="flex items-center gap-1.5 pl-4">
          {slides.map((s, i) => (
            <button
              key={s.key}
              aria-label={`Go to ${s.label}`}
              onClick={() => setIndex(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ease-in-out ${
                i === index ? "w-8 bg-border-active" : "w-1.5 bg-element-3 hover:bg-border-active"
              }`}
            />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
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
