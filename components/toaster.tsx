"use client";

import { useEffect, useState } from "react";
import {
  CheckBadgeIcon,
  QuestionMarkCircleIcon,
  XCircleIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";
import { dismissToast, useToast, type ToastTone } from "@/lib/toast-store";

/** How long the card stays "loud" (filled) before it settles. */
const LOUD_MS = 1600;
/** How long a toast stays up in all. */
const VISIBLE_MS = 3500;

const GLYPHS = {
  neutral: QuestionMarkCircleIcon,
  success: CheckBadgeIcon,
  error: XCircleIcon,
} satisfies Record<ToastTone, unknown>;

/** The quiet state's disc: a filled status mark on a neutral card. */
const BADGE: Record<ToastTone, string> = {
  neutral: "bg-overlay text-secondary",
  success: "bg-yes text-page",
  error: "bg-no text-page",
};

/** The loud entrance: the whole card floods in the tone. */
const LOUD: Record<ToastTone, string> = {
  neutral: "bg-overlay text-primary",
  success: "bg-yes text-page",
  error: "bg-no text-page",
};

/**
 * The app's toast, bottom-right (above the mobile dock on phones). It
 * arrives loud — the card filled in its tone, so a glance registers it —
 * then settles to a neutral card carrying a coloured disc, and leaves on
 * its own. Reduced motion skips the loud phase.
 */
export function Toaster() {
  const toast = useToast();

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(dismissToast, VISIBLE_MS);
    return () => clearTimeout(id);
  }, [toast]);

  if (!toast) return null;
  return (
    <div className="fixed bottom-24 right-4 z-[60] w-[min(360px,calc(100vw-32px))] sm:bottom-6 sm:right-6">
      <ToastCard key={toast.key} title={toast.title} tone={toast.tone} />
    </div>
  );
}

function ToastCard({ title, tone }: { title: string; tone: ToastTone }) {
  const [loud, setLoud] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setLoud(false), LOUD_MS);
    return () => clearTimeout(id);
  }, []);
  const Glyph = GLYPHS[tone];

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`w-full rounded-xl p-4 shadow-popover transition-colors duration-300 ${
        loud ? `${LOUD[tone]} motion-reduce:bg-element-2 motion-reduce:text-primary` : "bg-element-2"
      }`}
    >
      <div className="flex items-center gap-3.5">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-full transition-colors duration-300 ${
            loud ? "bg-sunken/20 text-current" : BADGE[tone]
          }`}
        >
          <Glyph className="size-5" aria-hidden="true" />
        </span>
        <p
          className={`min-w-0 flex-1 text-[14.5px] font-semibold leading-tight tracking-[-0.005em] ${
            loud ? "" : "text-primary"
          }`}
        >
          {title}
        </p>
        <button
          type="button"
          onClick={dismissToast}
          aria-label={`Dismiss ${title}`}
          className={`grid size-8 shrink-0 place-items-center rounded-lg transition-colors ${
            loud ? "opacity-70 hover:opacity-100" : "text-tertiary hover:bg-overlay hover:text-primary"
          }`}
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
