"use client";

import { useEffect, useSyncExternalStore } from "react";
import { apiFetch, isApiConfigured } from "@/lib/api-client";

/**
 * Whether the signed-in account is suspended (Admin → Traders), read from
 * GET /v1/user/me — one module-level store, so the notice under the
 * header and anything else that asks share a single request. Re-read on
 * focus, so lifting a suspension shows without a reload.
 *
 * The API refuses bets and conversions for a suspended account on its own
 * (ACCOUNT_SUSPENDED); this only lets the site say so up front.
 */

export interface Suspension {
  at: string;
  /** The desk's reason, written for the customer. */
  reason: string;
}

interface State {
  /** Whose status this is — a different signed-in email reads afresh. */
  email: string | null;
  suspension: Suspension | null;
}

const EMPTY: State = { email: null, suspension: null };
let state: State = EMPTY;
let inflight: { email: string; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();

function commit(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

function refresh(email: string): Promise<void> {
  if (inflight?.email === email) return inflight.promise;
  const promise = apiFetch<{ data: { user: { suspension?: Suspension | null } } }>("/v1/user/me")
    .then((res) => commit({ email, suspension: res.data.user.suspension ?? null }))
    // a failed read leaves whatever we knew; the API still guards every move
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  inflight = { email, promise };
  return promise;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The account's suspension, or null; pass the signed-in email (null when signed out). */
export function useSuspension(email: string | null): Suspension | null {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  const active = Boolean(email) && isApiConfigured();

  useEffect(() => {
    if (!active || !email) return;
    void refresh(email);
    const onFocus = () => void refresh(email);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [active, email]);

  return active && snapshot.email === email ? snapshot.suspension : null;
}
