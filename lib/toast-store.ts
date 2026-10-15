"use client";

import { useSyncExternalStore } from "react";

/**
 * One toast at a time, app-wide — the reference app's model: a new toast
 * replaces the one on screen rather than stacking. `showToast` can be
 * called from any client code; <Toaster /> in the root layout renders it.
 */
export type ToastTone = "neutral" | "success" | "error";

export interface ToastMessage {
  /** Changes on every show, so a repeat of the same message restarts. */
  key: number;
  title: string;
  tone: ToastTone;
}

let current: ToastMessage | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(title: string, tone: ToastTone = "neutral") {
  current = { key: Date.now(), title, tone };
  emit();
}

export function dismissToast() {
  current = null;
  emit();
}

export function useToast(): ToastMessage | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}
