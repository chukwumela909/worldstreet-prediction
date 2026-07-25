"use client";

import { useSyncExternalStore } from "react";

/**
 * Bookmarked event slugs, newest first — the one piece of per-browser
 * state the app still keeps locally, because a watchlist is a display
 * preference and needs no backend to be honest.
 *
 * This replaced a mock portfolio store that held demo cash, positions
 * and trade history in localStorage. Real money lives in the central
 * wallet and the naira ledger (services/api); nothing here pretends to.
 *
 * SSR renders the empty default and the client snapshot takes over after
 * hydration, so the bookmark icons settle a frame late rather than
 * mismatching.
 */

const STORAGE_KEY = "ws-watchlist";
/** What the mock portfolio wrote; read once so old bookmarks survive. */
const LEGACY_KEY = "ws-portfolio";

const EMPTY: string[] = [];

let watchlist: string[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      watchlist = JSON.parse(raw) as string[];
      return;
    }
    // migrate the watchlist out of the old portfolio blob, once
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as { watchlist?: string[] };
      if (Array.isArray(parsed.watchlist) && parsed.watchlist.length > 0) {
        watchlist = parsed.watchlist;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
      }
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    /* corrupt or unavailable storage — start empty */
  }
}

function commit(next: string[]) {
  watchlist = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
  } catch {
    /* storage unavailable — state still lives in memory */
  }
  listeners.forEach((l) => l());
}

export function toggleWatchlist(slug: string) {
  load();
  commit(
    watchlist.includes(slug)
      ? watchlist.filter((s) => s !== slug)
      : [slug, ...watchlist],
  );
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useWatchlist(): string[] {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return watchlist;
    },
    () => EMPTY,
  );
}
