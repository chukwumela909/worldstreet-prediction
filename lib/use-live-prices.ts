"use client";

import { useEffect, useMemo, useState } from "react";
import type { MarketEvent } from "@/types/market";
import { fetchEvents } from "@/lib/use-live-events";

/**
 * Keep a server-rendered set of events ticking: re-fetch the same slugs
 * every `intervalMs` and swap in the fresh prices, so percentages, buy
 * buttons, and legends move without a reload — the polling half of what
 * Polymarket does over WebSockets.
 *
 * Ticks fire on a plain interval — browsers throttle background-tab
 * timers on their own (and embedded webviews can report "hidden" while
 * fully visible, so an explicit visibility gate would break there).
 * Regaining focus refreshes immediately. Slugs the refetch doesn't
 * return (e.g. a market that just closed) keep their last known data
 * rather than disappearing mid-view.
 */
const DEFAULT_INTERVAL_MS = 10_000;

export function useLivePrices(
  initial: MarketEvent[],
  intervalMs = DEFAULT_INTERVAL_MS,
): MarketEvent[] {
  // keyed off content, not array identity
  const slugsKey = useMemo(
    () => [...new Set(initial.map((e) => e.slug))].sort().join(","),
    [initial],
  );

  const [bySlug, setBySlug] = useState<Record<string, MarketEvent>>({});

  useEffect(() => {
    if (!slugsKey) return;
    let cancelled = false;

    const tick = () => {
      fetchEvents(slugsKey.split(",")).then((events) => {
        if (cancelled || events.length === 0) return;
        setBySlug((prev) => {
          const next = { ...prev };
          for (const e of events) next[e.slug] = e;
          return next;
        });
      });
    };

    const id = setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [slugsKey, intervalMs]);

  return useMemo(
    () => initial.map((e) => bySlug[e.slug] ?? e),
    [initial, bySlug],
  );
}
