"use client";

import { useSyncExternalStore } from "react";

/**
 * Small per-viewer preferences for the admin desk (amounts in ₦ or $,
 * the Traders page's tab and sort), kept in this browser's localStorage.
 *
 * Conveniences only: storage can be blocked or cleared, so every read
 * and write is guarded and a missing value falls back to the default.
 * The server render and hydration always see the default; the stored
 * value takes over on the client's first pass after that.
 */
export interface LocalPref<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
  /** What the server render (and hydration) sees. */
  fallback: T;
}

export function localPref<T>(
  key: string,
  /** Must be a stable value — it is the server snapshot. */
  fallback: T,
  /** Turn a parsed JSON value back into a T, or null if it isn't one. */
  parse: (raw: unknown) => T | null,
): LocalPref<T> {
  let current: T | undefined; // undefined: not read yet
  const listeners = new Set<() => void>();

  const read = (): T => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return parse(JSON.parse(raw)) ?? fallback;
    } catch {
      return fallback; // storage blocked, or a mangled value
    }
  };

  return {
    fallback,
    get() {
      if (typeof window === "undefined") return fallback;
      if (current === undefined) current = read();
      return current;
    },
    set(next) {
      current = next;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // storage blocked: the choice still holds until the page reloads
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The preference's current value, re-rendering when it changes. */
export function useLocalPref<T>(pref: LocalPref<T>): T {
  return useSyncExternalStore(pref.subscribe, pref.get, () => pref.fallback);
}
