"use client";

import { useSyncExternalStore } from "react";

/**
 * Theme store: html[data-theme] is the source of truth (set before first
 * paint by the inline script in the root layout), persisted to
 * localStorage on toggle.
 */
export type Theme = "dark" | "light";

const listeners = new Set<() => void>();

const current = (): Theme =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";

export function toggleTheme() {
  const next: Theme = current() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("ws-theme", next);
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current, () => "dark");
}
