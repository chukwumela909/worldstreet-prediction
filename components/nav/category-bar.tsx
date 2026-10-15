"use client";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { BAR_CATEGORIES, CATEGORY_TABS } from "@/lib/categories";
import { ScrollStrip } from "@/components/scroll-strip";
import { CategoryMenu } from "@/components/nav/category-menu";
import { CATEGORY_ICONS, categoryHref } from "@/components/nav/category-icons";

const TABS = BAR_CATEGORIES.map((p) => CATEGORY_TABS.find((t) => t.param === p)).filter(
  (t) => t !== undefined,
);

/**
 * Category row under the top nav. It lives in the root layout, so it
 * persists across navigations and reads the active tab from the URL
 * itself: only the home route has a current tab (`/?category=…`);
 * everywhere else — a market page, the leaderboard — none is current.
 */
export function CategoryBar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const active = pathname === "/" ? (params.get("category") ?? undefined) : undefined;
  return <CategoryBarView active={active} />;
}

/**
 * The row itself: one ghost tab per category with its icon, the active
 * one in primary text over a 2px gold underline; the strip scrolls with
 * edge pagers when it overflows, and the trailing menu lists every
 * category. Hovering a tab warms its full page, so the click that
 * follows usually has its data already.
 */
export function CategoryBarView({ active }: { active?: string }) {
  const router = useRouter();
  return (
    <nav
      aria-label="Market categories"
      className="mx-auto flex w-full max-w-[1400px] items-center gap-2 px-4 sm:px-6"
    >
      <ScrollStrip className="items-center gap-1">
        {TABS.map(({ param, label }) => {
          const Icon = CATEGORY_ICONS[param];
          const current = active === param;
          const href = categoryHref(param);
          return (
            <Link
              key={param}
              href={href}
              aria-current={current ? "page" : undefined}
              onPointerEnter={() => router.prefetch(href)}
              onFocus={() => router.prefetch(href)}
              className={`flex h-12 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors ${
                current
                  ? "border-accent text-primary"
                  : "border-transparent text-secondary hover:text-primary"
              }`}
            >
              {Icon && <Icon className="size-4" />}
              {label}
            </Link>
          );
        })}
      </ScrollStrip>
      <CategoryMenu active={active} />
    </nav>
  );
}
