import { TrendingUp, Zap } from "lucide-react";
import { CATEGORIES } from "@/types/market";
import { ScrollStrip } from "@/components/scroll-strip";

/**
 * Category pill bar (~56px) below the top nav — a slider strip with
 * chevron pagers when the pills overflow.
 * Inactive pills text-secondary, active text-primary; 14px semibold.
 */
export function CategoryBar({ active = "Trending" }: { active?: string }) {
  return (
    <nav className="flex h-14 items-center px-4">
      <ScrollStrip className="items-center gap-1">
      {CATEGORIES.map((cat, i) => {
        const isActive = cat === active;
        return (
          <span key={cat} className="flex items-center">
            <button
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-sm font-semibold transition-colors ${
                isActive
                  ? "text-primary"
                  : "text-secondary hover:text-primary"
              }`}
            >
              {cat === "Trending" && (
                <TrendingUp className="size-4" strokeWidth={2.5} />
              )}
              {cat === "Politics" && i === 1 && null}
              {cat}
            </button>
            {/* featured group after Trending, then divider, like the real site */}
            {cat === "Trending" && (
              <span className="mx-1.5 flex items-center gap-1.5">
                <button className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-sm font-semibold text-yellow-500 hover:text-yellow-600">
                  <span className="text-base leading-none">⚽</span>
                  World Cup
                </button>
                <button className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-sm font-semibold text-secondary hover:text-primary">
                  <span className="text-base leading-none">🎛️</span>
                  Combos
                </button>
                <button className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-sm font-semibold text-secondary hover:text-primary">
                  <Zap className="size-4 text-yellow-500" strokeWidth={2.5} />
                  Breaking
                </button>
                <span className="h-4 w-px bg-border-active/40" />
              </span>
            )}
          </span>
        );
      })}
      </ScrollStrip>
    </nav>
  );
}
