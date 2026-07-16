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
