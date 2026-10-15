"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  MagnifyingGlassIcon as Search,
  XMarkIcon as X,
} from "@heroicons/react/24/outline";
import { setSearchTerm, useSearchTerm } from "@/lib/search-store";

/**
 * Top-nav market search. Live-filters the home grid via the shared
 * search store; "/" focuses it from anywhere, Escape clears + blurs,
 * Enter jumps to the home grid when invoked from another page.
 */
export function SearchBox() {
  const term = useSearchTerm();
  const inputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    // full-width line of its own below lg (order-last), inline from lg up
    <div
      role="search"
      className="relative order-last min-w-0 basis-full lg:order-none lg:max-w-[640px] lg:flex-1 lg:basis-auto"
    >
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tertiary"
      />
      <input
        ref={inputRef}
        type="search"
        placeholder="Search markets..."
        value={term}
        onChange={(e) => setSearchTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setSearchTerm("");
            inputRef.current?.blur();
          }
          if (e.key === "Enter" && pathname !== "/") router.push("/");
        }}
        className="h-9 w-full rounded-lg border border-border bg-surface pl-10 pr-10 text-[13px] text-primary placeholder:text-tertiary outline-none transition-colors hover:border-border-hover focus:border-border-active [&::-webkit-search-cancel-button]:hidden"
        aria-label="Search prediction markets"
      />
      {term ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setSearchTerm("");
            inputRef.current?.focus();
          }}
          className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-tertiary transition-colors hover:bg-element-2 hover:text-primary"
        >
          <X className="size-4" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-2 top-1/2 grid h-5 min-w-5 -translate-y-1/2 place-items-center rounded-xs border border-border px-1 font-mono text-[11px] text-tertiary">
          /
        </kbd>
      )}
    </div>
  );
}
