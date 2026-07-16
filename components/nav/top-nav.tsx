import Link from "next/link";
import { Info, Menu, Search } from "lucide-react";
import { SearchBox } from "@/components/nav/search-box";

/**
 * Top navigation bar (~60px) — logged-out state.
 * Specs: docs/polymarket-recon.md §7 (search h40 rounded-md,
 * Log In ghost / Sign Up solid pills h32 radius-18).
 */
export function TopNav() {
  return (
    <div className="flex h-[60px] items-center gap-4 px-4">
      {/* Logo */}
      <Link href="/" className="flex shrink-0 items-center gap-2">
        <LogoMark />
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
        <button className="h-8 shrink-0 whitespace-nowrap rounded-full border border-border px-3.5 text-sm font-semibold text-primary hover:border-border-hover">
          Log In
        </button>
        <button className="h-8 shrink-0 whitespace-nowrap rounded-full bg-blue-400 px-3.5 text-sm font-semibold text-white hover:bg-blue-500">
          Sign Up
        </button>
        <button
          aria-label="Menu"
          className="p-1.5 text-primary hover:text-secondary"
        >
          <Menu className="size-5" />
        </button>
      </div>
    </div>
  );
}

/** Placeholder logomark — swapped at rebrand. */
function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-7 text-primary" fill="currentColor" aria-hidden>
      <path d="M4 4h16v3.2L12 10 4 7.2V4zm0 6.4L12 13.2l8-2.8v3.2L12 16.4 4 13.6v-3.2zm0 6.4 8 2.8 8-2.8V20l-8 2.8L4 20v-3.2z" transform="scale(0.86) translate(2 0)" />
    </svg>
  );
}
