"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  PresentationChartLineIcon as ChartLine,
  TrophyIcon as Trophy,
  WalletIcon as Wallet,
} from "@heroicons/react/24/solid";
import type { HeroIcon } from "@/components/icons";

const ITEMS: { href: string; label: string; icon: HeroIcon; match: (p: string) => boolean }[] = [
  {
    href: "/",
    label: "Markets",
    icon: ChartLine,
    match: (p) => p === "/" || p.startsWith("/event") || p.startsWith("/local"),
  },
  { href: "/portfolio", label: "Positions", icon: Wallet, match: (p) => p.startsWith("/portfolio") },
  { href: "/leaderboard", label: "Rankings", icon: Trophy, match: (p) => p.startsWith("/leaderboard") },
];

/**
 * Floating bottom dock on phones: one icon per section, the current one
 * raised. Hidden from md up, where the header's primary nav does the job.
 * The admin desk has its own shell, so the dock stays off it.
 */
export function MobileDock() {
  const pathname = usePathname();
  if (pathname.startsWith("/admin")) return null;

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-4 z-50 flex justify-center md:hidden"
    >
      <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-1.5 shadow-popover">
        {ITEMS.map(({ href, label, icon: Icon, match }) => {
          const current = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={current ? "page" : undefined}
              className={`grid size-11 place-items-center rounded-full transition-colors ${
                current ? "bg-element-3 text-primary" : "text-secondary hover:text-primary"
              }`}
            >
              <Icon className="size-5" />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
