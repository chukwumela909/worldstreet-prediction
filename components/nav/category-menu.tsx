"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckIcon as Check,
  ChevronDownIcon as ChevronDown,
} from "@heroicons/react/24/outline";
import { CATEGORY_TABS } from "@/lib/categories";
import { CATEGORY_ICONS, categoryHref } from "@/components/nav/category-icons";

/** "All categories" dropdown at the end of the category row. */
export function CategoryMenu({ active }: { active?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        aria-label="All categories"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex size-9 items-center justify-center rounded-sm text-secondary transition-colors hover:bg-surface hover:text-primary"
      >
        <ChevronDown className="size-5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-56 overflow-y-auto rounded-lg border border-border bg-surface p-1.5 shadow-popover">
          {CATEGORY_TABS.map(({ param, label }) => {
            const Icon = CATEGORY_ICONS[param];
            return (
              <Link
                key={param}
                href={categoryHref(param)}
                onClick={() => setOpen(false)}
                className="flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-primary transition-colors hover:bg-element-2"
              >
                {Icon && <Icon className="size-4 text-secondary" />}
                {label}
                {active === param && <Check className="ml-auto size-4 text-accent-ink" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
