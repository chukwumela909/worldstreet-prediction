"use client";

import { useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Opening the exact thing an alert email links to. Every alert and
 * support email carries a desk link (services/api/src/links.ts):
 *
 *   /admin?alert=<id>                    the alert's card on Today
 *   /admin/customers/support?ref=WS-…    one support request, opened
 *   /admin/money?customer=<authUserId>   one customer's withdrawals
 *
 * A desk reads its parameter with `useLinkedItem`, spreads `mark(…)`
 * onto each card that could be the one and adds `ring(…)` to its
 * classes, and the matching card is ringed and scrolled into view once
 * it renders. When the thing has already
 * been dealt with, the desk shows `LinkedGone` instead of leaving the
 * reader to hunt for it.
 *
 * Pages that use this sit in a <Suspense> (useSearchParams).
 */

/** The ring on the linked card: the same gold as a selected input. */
const RING = "ring-2 ring-accent ring-offset-2 ring-offset-page";

export function useLinkedItem(param: string) {
  const target = useSearchParams().get(param);
  const scrolled = useRef(false);

  // a callback ref fires when the card mounts, i.e. after the data landed
  const scrollTo = useCallback((el: HTMLElement | null) => {
    if (!el || scrolled.current) return;
    scrolled.current = true;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const linked = (isTarget: boolean) => isTarget && target !== null;
  return {
    /** The id/ref in the URL, or null when the page was opened plainly. */
    target,
    /** Spread onto a card: scrolled to when it's the linked one. */
    mark: (isTarget: boolean) => (linked(isTarget) ? { ref: scrollTo, "aria-current": true as const } : {}),
    /** Add to a card's classes: ringed when it's the linked one. */
    ring: (isTarget: boolean) => (linked(isTarget) ? RING : ""),
  };
}

/** "This was already dealt with" — for a linked item that's no longer waiting. */
export function LinkedGone({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="mt-4 rounded-md bg-element-2 px-3 py-2 text-sm font-medium text-secondary">
      {children}
    </p>
  );
}
