import Link from "next/link";
import {
  CurrencyDollarIcon as Bitcoin,
  ChevronRightIcon as ChevronRight,
  ArrowTrendingUpIcon as TrendingUp,
} from "@heroicons/react/24/outline";
import type { HotTopic } from "@/lib/hot-topics";
import { WatchlistPromo } from "./watchlist-promo";

/**
 * Right rail beside the featured market: a Perpetuals promo, the visitor's
 * watchlist, the Hot topics ranked list, and an Explore all link down to
 * the board.
 *
 * `topics` carries live tag volume; the list section is simply omitted
 * when the ranking fetch failed (empty array).
 */
export function PromoRail({ topics }: { topics: HotTopic[] }) {
  return (
    <aside aria-label="Discover" className="hidden min-w-0 flex-col gap-3 lg:flex">
      <article className="relative overflow-hidden rounded-xl border border-border bg-surface p-4 shadow-card">
        <span
          aria-hidden="true"
          className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full bg-accent text-on-accent"
        >
          <Bitcoin className="size-5" />
        </span>
        <h2 className="pr-10 text-[15px] font-semibold">Perpetuals</h2>
        <p className="mt-1 text-sm text-secondary">Crypto, around the clock.</p>
        <Link
          href="/perps"
          className="ml-auto mt-3 flex h-7 w-fit items-center gap-1.5 rounded-sm border border-border px-3 text-xs font-medium text-primary transition-colors hover:border-border-active hover:bg-element-2"
        >
          Explore perpetuals
          <TrendingUp className="size-4" />
        </Link>
      </article>

      <WatchlistPromo />

      {/* Hot topics — omitted entirely when the live ranking is unavailable */}
      {topics.length > 0 && (
        <section className="pt-2">
          <h2 className="flex items-center gap-1 text-[15px] font-semibold">
            Hot topics
            <ChevronRight className="size-4 text-secondary" />
          </h2>
          <ol className="my-2">
            {topics.map((t) => (
              <li key={t.slug ?? t.rank}>
                <button className="group -mx-2 grid min-h-10 w-[calc(100%+1rem)] grid-cols-[1.25rem_minmax(0,1fr)_auto_1rem] items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-element-2">
                  <span className="text-xs text-secondary">{t.rank}</span>
                  <span className="truncate text-sm font-medium">{t.name}</span>
                  <span className="text-xs text-secondary">{t.volumeToday} today</span>
                  <ChevronRight className="size-4 text-tertiary group-hover:text-secondary" />
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <a
        href="#markets"
        className="flex h-10 w-full items-center justify-center rounded-md bg-element-2 text-sm font-semibold text-primary transition-colors hover:bg-element-3"
      >
        Explore all
      </a>
    </aside>
  );
}
