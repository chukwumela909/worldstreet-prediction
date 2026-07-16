"use client";

import { useSyncExternalStore } from "react";

/**
 * Mock session store (no backend): the signed-in user lives in
 * localStorage and is shared app-wide via useSyncExternalStore —
 * SSR always renders logged-out, the client snapshot takes over
 * after hydration.
 */
export interface SessionUser {
  email: string;
  name: string;
}

const STORAGE_KEY = "ws-user";

let user: SessionUser | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) user = JSON.parse(raw) as SessionUser;
  } catch {
    /* corrupt or unavailable storage — stay logged out */
  }
}

const emit = () => listeners.forEach((l) => l());

export function signInAs(email: string) {
  loaded = true;
  user = { email, name: email.split("@")[0] || "trader" };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {
    /* storage unavailable */
  }
  emit();
}

export function signOutUser() {
  loaded = true;
  user = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSessionUser(): SessionUser | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return user;
    },
    () => null,
  );
}
