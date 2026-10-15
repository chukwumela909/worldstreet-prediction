"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDownIcon as ChevronDown,
  FlagIcon as Flag,
  GlobeEuropeAfricaIcon as Globe,
  InformationCircleIcon as Info,
  MapPinIcon as MapPin,
  SparklesIcon as Sparkles,
  AdjustmentsVerticalIcon as SlidersVertical,
  TrophyIcon as Trophy,
  XMarkIcon as X,
  BoltIcon as Zap,
} from "@heroicons/react/24/outline";
import type { HeroIcon } from "@/components/icons";
import { categoryHref } from "@/components/nav/category-icons";

const LINKS: { href: string; label: string; icon?: HeroIcon; match: (p: string) => boolean }[] = [
  { href: "/", label: "Markets", match: (p) => p === "/" },
  { href: "/perps", label: "Perps", icon: SlidersVertical, match: (p) => p.startsWith("/perps") },
  { href: "/live", label: "Live", icon: Zap, match: (p) => p.startsWith("/live") },
];

/** The More menu: views that don't have a tab of their own. */
const MORE: { href: string; label: string; icon: HeroIcon }[] = [
  { href: categoryHref("breaking"), label: "New markets", icon: Sparkles },
  { href: categoryHref("local"), label: "Local markets", icon: MapPin },
  { href: categoryHref("world-cup"), label: "World Cup", icon: Globe },
  { href: categoryHref("geopolitics"), label: "Geopolitics", icon: Flag },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
];

const ITEM =
  "flex h-9 items-center gap-2 rounded-sm px-3 text-sm font-medium transition-colors hover:bg-surface hover:text-primary";
const MENU_ITEM =
  "flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-primary transition-colors hover:bg-element-2";

/**
 * Ghost buttons beside the logo — Markets, Perps, Live, More — the
 * current section in primary text. Its own spread-out row on phones,
 * inline beside the logo from md.
 */
export function PrimaryNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main navigation"
      className="order-2 flex basis-full items-center justify-between md:order-none md:shrink-0 md:basis-auto md:justify-start"
    >
      {LINKS.map(({ href, label, icon: Icon, match }) => {
        const current = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`${ITEM} ${current ? "text-primary" : "text-secondary"}`}
          >
            {Icon && <Icon className="size-4" />}
            {label}
          </Link>
        );
      })}
      <MoreMenu />
    </nav>
  );
}

function MoreMenu() {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        aria-label="More views"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${ITEM} text-secondary`}
      >
        More
        <ChevronDown className="size-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-surface p-1.5 shadow-popover md:left-0 md:right-auto">
          {MORE.map(({ href, label, icon: Icon }) => (
            <Link key={label} href={href} onClick={() => setOpen(false)} className={MENU_ITEM}>
              <Icon className="size-4 text-secondary" />
              {label}
            </Link>
          ))}
          <button
            onClick={() => {
              setOpen(false);
              setHelp(true);
            }}
            className={MENU_ITEM}
          >
            <Info className="size-4 text-secondary" />
            How it works
          </button>
        </div>
      )}
      {help && <HowItWorks onClose={() => setHelp(false)} />}
    </div>
  );
}

/** "How prediction markets work" — the reference's help dialog. */
function HowItWorks({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-alpha-black-600 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="how-it-works-title"
        className="w-full max-w-md rounded-t-3xl border border-border bg-surface p-6 shadow-popover sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="how-it-works-title" className="text-xl font-semibold">
            How prediction markets work
          </h2>
          <button
            aria-label="Close"
            autoFocus
            onClick={onClose}
            className="grid size-8 shrink-0 place-items-center rounded-sm text-secondary transition-colors hover:bg-element-2 hover:text-primary"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-3 space-y-3 text-sm text-secondary">
          <p>
            Choose a market, review its resolution rules, then buy an outcome. A 60-cent
            share implies a 60% chance.
          </p>
          <p>
            Winning shares pay out in full when the market settles; losing shares pay
            nothing.
          </p>
        </div>
      </div>
    </div>
  );
}
