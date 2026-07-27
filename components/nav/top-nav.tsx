import Link from "next/link";
import { Info, Search } from "lucide-react";
import { LogoMark } from "@/components/home/hero/shared";
import { NavActions } from "@/components/nav/nav-actions";
import { SearchBox } from "@/components/nav/search-box";

/**
 * Top navigation bar (~60px) — logged-out state.
 * Specs: docs/polymarket-recon.md §7 (search h40 rounded-md,
 * Log In ghost / Sign Up solid pills h32 radius-18).
 */
export function TopNav() {
  return (
    <div className="mx-auto flex h-[60px] w-full max-w-[1280px] items-center gap-4 px-6">
      {/* Logo */}
      <Link href="/" className="flex shrink-0 items-center gap-2">
        <LogoMark className="h-5 w-auto" />
        <span className="text-lg font-bold tracking-tight">Worldstreet</span>
      </Link>

      {/* Search — full input on ≥md, icon button below */}
      <SearchBox />
      <button
        aria-label="Search"
        className="flex size-9 items-center justify-center rounded-md bg-surface text-secondary md:hidden"
      >
        <Search className="size-4.5" strokeWidth={2} />
      </button>

      {/* Right actions */}
      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        <button className="hidden items-center gap-1.5 text-sm font-semibold text-accent sm:flex">
          <Info className="size-4" strokeWidth={2.5} />
          How it works
        </button>
        <NavActions />
      </div>
    </div>
  );
}
