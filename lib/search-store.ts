"use client";

import { useSyncExternalStore } from "react";

/**
 * Tiny external store for the market search term, shared between the
 * top-nav search box and the home-grid browser without prop drilling
 * or per-keystroke route updates.
 */
let term = "";
const listeners = new Set<() => void>();

export function setSearchTerm(next: string) {
  term = next;
  listeners.forEach((l) => l());
}

export function getSearchTerm(): string {
  return term;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSearchTerm(): string {
  return useSyncExternalStore(subscribe, () => term, () => "");
}
