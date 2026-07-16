"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
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
    <div className="relative hidden min-w-0 flex-1 max-w-3xl md:block">
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-secondary"
        strokeWidth={2}
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
        className="h-10 w-full rounded-md bg-surface pl-11 pr-9 text-sm text-primary placeholder:text-secondary outline-none focus:ring-1 focus:ring-border-active [&::-webkit-search-cancel-button]:hidden"
        aria-label="Search markets"
      />
      {!term && (
        <kbd className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-tertiary">
          /
        </kbd>
      )}
    </div>
  );
}
