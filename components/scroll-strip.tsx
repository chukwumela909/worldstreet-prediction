"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Horizontal slider strip (the real site's scroll-fade pattern, recon §9):
 * hidden scrollbar, gradient edge fades, and chevron pagers that appear
 * only when there is overflow in that direction.
 */
export function ScrollStrip({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 1);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const from = el.scrollLeft;
    const target = from + dir * el.clientWidth * 0.6;
    el.scrollTo({ left: target, behavior: "smooth" });
    // environments that ignore smooth scrolling (e.g. reduced motion)
    // never start the animation — jump instantly instead; refresh pager
    // state directly since not every environment fires scroll events
    window.setTimeout(() => {
      if (el.scrollLeft === from) el.scrollLeft = target;
      update();
    }, 100);
    window.setTimeout(update, 500);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <div
        ref={ref}
        className={`flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      >
        {children}
      </div>
      {canLeft && <Pager side="left" onClick={() => page(-1)} />}
      {canRight && <Pager side="right" onClick={() => page(1)} />}
    </div>
  );
}

function Pager({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <div
      className={`pointer-events-none absolute inset-y-0 flex w-14 items-center ${
        side === "left"
          ? "left-0 justify-start bg-gradient-to-r"
          : "right-0 justify-end bg-gradient-to-l"
      } from-page via-page/80 to-transparent`}
    >
      <button
        aria-label={side === "left" ? "Scroll left" : "Scroll right"}
        onClick={onClick}
        className="pointer-events-auto flex size-6 items-center justify-center text-secondary transition-colors duration-150 ease-in-out hover:text-primary"
      >
        <Icon className="size-4.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}
