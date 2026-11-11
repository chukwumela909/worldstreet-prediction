"use client";

import { useSyncExternalStore } from "react";

/**
 * Small per-viewer preferences for the admin desk (amounts in ₦ or $,
 * the Traders page's tab and sort), kept in this browser's localStorage
 * — or, for a choice that should only last the visit (showing hidden
 * amounts), its sessionStorage: this tab, reloads included, then back
 * to the default.
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
  /** "session": kept for this tab only, so each new visit starts at the default. */
  area: "local" | "session" = "local",
): LocalPref<T> {
  let current: T | undefined; // undefined: not read yet
  const listeners = new Set<() => void>();
  // a getter, not a value: touching either storage can throw when it's blocked
  const storage = () => (area === "session" ? sessionStorage : localStorage);

  const read = (): T => {
    try {
      const raw = storage().getItem(key);
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
        storage().setItem(key, JSON.stringify(next));
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
