"use client";

import { useEffect, useState } from "react";
import type { MarketEvent } from "@/types/market";

/**
 * Keep a server-rendered Bayse event ticking, the way useLivePrices does
 * for Polymarket ones: re-fetch the same slug and swap in fresh prices
 * so the header, outcome rows, and trade panel move without a reload.
 *
 * This matters more here than it does there — a stale price in the Local
 * panel is a stake the server re-prices and bounces back for
 * confirmation, so polling is what keeps that interruption rare.
 *
 * A failed or empty refetch keeps the last known event rather than
 * blanking a page someone is mid-trade on.
 */
const DEFAULT_INTERVAL_MS = 10_000;

export function useLiveBayseEvent(
  initial: MarketEvent,
  intervalMs = DEFAULT_INTERVAL_MS,
): MarketEvent {
  const [live, setLive] = useState<MarketEvent | null>(null);
  const { slug } = initial;

  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      fetch(`/api/bayse/event?slug=${encodeURIComponent(slug)}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
        .then((body: { event?: MarketEvent }) => {
          if (!cancelled && body.event) setLive(body.event);
        })
        .catch(() => {
          // keep the last good event; the next tick retries
        });
    };

    const id = setInterval(tick, intervalMs);
    // Plain interval + focus, same reasoning as use-live-prices: embedded
    // webviews can report "hidden" while fully visible.
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
  }, [slug, intervalMs]);

  // Polled data is only ever used for the event it was fetched for, so
  // navigating to another market falls back to its own server render
  // instead of briefly showing the previous market's prices.
  return live?.slug === slug ? live : initial;
}
