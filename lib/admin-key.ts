import { useSyncExternalStore } from "react";

/**
 * The admin desk's access key, for this browser tab only.
 *
 * An admin unlocks the desk with a key the API knows (ADMIN_ACCESS_KEYS,
 * see services/api/src/admin-auth.ts); lib/api-client.ts sends it as
 * `X-Admin-Key` on every /v1/admin request. It lives in sessionStorage,
 * so closing the tab locks the desk again, and it is dropped the moment
 * the API refuses it (a revoked or rotated key). This is the interim way
 * in alongside the Clerk admin role — remove the keys on the API and the
 * desk falls back to that role alone.
 */

export interface AdminKey {
  key: string;
  /** The key's name on the API, e.g. "josh" — shown in the desk's chrome. */
  label: string;
}

const STORAGE_KEY = "ws-admin-key";
export const ADMIN_KEY_HEADER = "X-Admin-Key";

let current: AdminKey | null | undefined; // undefined: not read yet
const listeners = new Set<() => void>();

function read(): AdminKey | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AdminKey>;
    return typeof parsed.key === "string" && typeof parsed.label === "string"
      ? { key: parsed.key, label: parsed.label }
      : null;
  } catch {
    return null; // storage blocked, or a mangled value
  }
}

export function getAdminKey(): AdminKey | null {
  if (typeof window === "undefined") return null;
  if (current === undefined) current = read();
  return current;
}

/** Keep (or, with null, forget) the key for this tab, and tell every reader. */
export function setAdminKey(next: AdminKey | null): void {
  current = next;
  try {
    if (next) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked: the key still works until the page reloads
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The tab's admin key, re-rendering when it's set or dropped.
 * `undefined` until the browser has been read (the server render and
 * hydration can't see sessionStorage), so the desk can wait a frame
 * instead of flashing its unlock form at someone who already unlocked.
 */
export function useAdminKey(): AdminKey | null | undefined {
  return useSyncExternalStore(subscribe, getAdminKey, () => undefined);
}
