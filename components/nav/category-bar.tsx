import Link from "next/link";
import { TrendingUp, Zap } from "lucide-react";
import { CATEGORY_TABS } from "@/lib/categories";
import { ScrollStrip } from "@/components/scroll-strip";

/**
 * Category pill bar (~56px) below the top nav — a slider strip with
 * chevron pagers when the pills overflow. Each pill links to the home
 * page scoped to its own live Gamma query (`/?category=...`).
 * Inactive pills text-secondary, active text-primary; 14px semibold.
 */
export function CategoryBar({ active = "trending" }: { active?: string }) {
  const [trending, worldCup, breaking, ...rest] = CATEGORY_TABS;

  const pill = (isActive: boolean, extra = "") =>
    `flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-sm font-semibold transition-colors ${
      extra || (isActive ? "text-primary" : "text-secondary hover:text-primary")
    }`;

  const href = (param: string) =>
    param === "trending" ? "/" : `/?category=${param}`;

  return (
    <nav className="flex h-14 items-center px-4">
      <ScrollStrip className="items-center gap-1">
        <Link href={href(trending.param)} className={pill(active === trending.param)}>
          <TrendingUp className="size-4" strokeWidth={2.5} />
          {trending.label}
        </Link>

        {/* featured group after Trending, then divider, like the real site */}
        <span className="mx-1.5 flex items-center gap-1.5">
          <Link
            href={href(worldCup.param)}
            className={pill(
              active === worldCup.param,
              active === worldCup.param
                ? "text-yellow-500"
                : "text-yellow-500 hover:text-yellow-600",
            )}
          >
            <span className="text-base leading-none">⚽</span>
            {worldCup.label}
          </Link>
          <button className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-sm font-semibold text-secondary hover:text-primary">
            <span className="text-base leading-none">🎛️</span>
            Combos
          </button>
          <Link href={href(breaking.param)} className={pill(active === breaking.param)}>
            <Zap className="size-4 text-yellow-500" strokeWidth={2.5} />
            {breaking.label}
          </Link>
          <span className="h-4 w-px bg-border-active/40" />
        </span>

        {rest.map((tab) => (
          <Link key={tab.param} href={href(tab.param)} className={pill(active === tab.param)}>
            {tab.label}
          </Link>
        ))}
      </ScrollStrip>
    </nav>
  );
}
