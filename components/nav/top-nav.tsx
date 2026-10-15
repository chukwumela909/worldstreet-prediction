import Link from "next/link";
import { LogoMark } from "@/components/home/hero/shared";
import { NavActions } from "@/components/nav/nav-actions";
import { PrimaryNav } from "@/components/nav/primary-nav";
import { SearchBox } from "@/components/nav/search-box";

/**
 * Top row of the header (80px on desktop): the WorldStreet lockup, the
 * primary nav, the market search and the account actions. It wraps the
 * way the reference header does: below lg the search takes its own
 * full-width line, and below md the primary nav does too, so a phone gets
 * brand + actions, then nav, then search.
 */
export function TopNav() {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:min-h-20 lg:flex-nowrap lg:py-0">
      <Link
        href="/"
        aria-label="WorldStreet predictions home"
        className="flex shrink-0 items-center gap-2 text-base font-bold md:text-xl"
      >
        <LogoMark className="size-8" eager />
        WorldStreet
      </Link>

      <PrimaryNav />
      <SearchBox />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <NavActions />
      </div>
    </div>
  );
}
