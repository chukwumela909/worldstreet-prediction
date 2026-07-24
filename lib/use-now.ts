"use client";

import { useSyncExternalStore } from "react";

/**
 * Stable per-pageload "now" for chart end-times.
 * Server snapshot is null (charts render client-only), client caches
 * one Date.now() so every consumer agrees and hydration stays clean.
 */
let cachedNow: number | null = null;
const subscribeNoop = () => () => {};
const getClientNow = () => (cachedNow ??= Date.now());
const getServerNow = () => null;

export function usePageNow(): number | null {
  return useSyncExternalStore(subscribeNoop, getClientNow, getServerNow);
}

/**
 * A "now" that advances once a second, for countdowns to a closing
 * time. One interval serves every consumer and stops when the last one
 * unmounts; the server snapshot is null, so nothing renders a clock
 * during hydration.
 */
let tickingNow = 0;
let tickTimer: ReturnType<typeof setInterval> | null = null;
const tickListeners = new Set<() => void>();

function subscribeTicking(listener: () => void) {
  tickListeners.add(listener);
  if (!tickTimer) {
    tickingNow = Date.now();
    tickTimer = setInterval(() => {
      tickingNow = Date.now();
      tickListeners.forEach((l) => l());
    }, 1_000);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

// cached, not Date.now() per call — getSnapshot must be stable between ticks
const getTickingNow = () => (tickingNow ||= Date.now());

export function useTickingNow(): number | null {
  return useSyncExternalStore(subscribeTicking, getTickingNow, getServerNow);
}
