"use client";

import { useEffect, useSyncExternalStore } from "react";
import { apiFetch, isApiConfigured } from "@/lib/api-client";

/**
 * The naira trading wallet, shared app-wide (nav, funding modal, trade
 * panel, portfolio) through one module-level store so a trade or a
 * conversion moves every balance on screen at once.
 *
 * Money is integer kobo everywhere — the API speaks kobo, and rounding
 * naira floats around would drift against the ledger. `balanceKobo` is
 * null until the first successful load (signed out, API not configured,
 * or still in flight), which callers render as "—" rather than ₦0.
 */

export interface FxQuote {
  /** Naira per dollar, mid-market. */
  mid: number;
  /** Rate applied converting dollars → naira. */
  usdToNgn: number;
  /** Rate applied converting naira → dollars. */
  ngnToUsd: number;
  spreadBps: number;
  asOf: string;
}

export interface NairaWalletState {
  balanceKobo: number | null;
  fx: FxQuote | null;
  loading: boolean;
  /** Last load failure — kept so the funding modal can explain itself. */
  error: string | null;
}

interface WalletResponse {
  success: boolean;
  data: { balanceKobo: number; currency: string; fx: FxQuote | null };
}

const EMPTY: NairaWalletState = {
  balanceKobo: null,
  fx: null,
  loading: false,
  error: null,
};

let state: NairaWalletState = EMPTY;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function commit(next: Partial<NairaWalletState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => state;
const getServerSnapshot = () => EMPTY;

/**
 * Re-read the balance and FX quote. Concurrent callers share one
 * request; failures keep the last known balance so a blip doesn't blank
 * the wallet mid-trade.
 */
export function refreshNairaWallet(): Promise<void> {
  if (!isApiConfigured()) return Promise.resolve();
  if (inflight) return inflight;

  commit({ loading: true });
  inflight = apiFetch<WalletResponse>("/v1/wallet/ngn")
    .then((res) => {
      commit({
        balanceKobo: res.data.balanceKobo,
        fx: res.data.fx,
        loading: false,
        error: null,
      });
    })
    .catch((err: unknown) => {
      commit({
        loading: false,
        error: err instanceof Error ? err.message : "Could not load your naira balance",
      });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Apply a balance the API just handed back (trade, conversion). */
export function setNairaBalance(balanceKobo: number) {
  commit({ balanceKobo, error: null });
}

/** Drop everything on sign-out so the next user never sees a stale balance. */
export function clearNairaWallet() {
  state = EMPTY;
  listeners.forEach((l) => l());
}

/**
 * Naira wallet state. Pass `enabled: false` (signed out) to read the
 * store without triggering a fetch. Refreshes on mount and on focus —
 * conversions can also complete in the central wallet's own UI.
 */
export function useNairaWallet(enabled = true): NairaWalletState {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const active = enabled && isApiConfigured();

  useEffect(() => {
    if (!active) return;
    void refreshNairaWallet();
    const onFocus = () => void refreshNairaWallet();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [active]);

  return active ? snapshot : EMPTY;
}

/* ------------------------------------------------------------------ */
/* Conversion                                                          */
/* ------------------------------------------------------------------ */

export type ConvertDirection = "usd_to_ngn" | "ngn_to_usd";

interface ConvertResponse {
  success: boolean;
  data: {
    alreadyProcessed?: boolean;
    amountKobo?: number;
    amountUsdMinor?: number;
    balanceKobo: number;
  };
}

/**
 * Move money between the central dollar wallet and the naira book. The
 * idempotency key is the caller's: a retry after a timeout must reuse
 * it, or the conversion runs twice.
 */
export async function convertCurrency(params: {
  direction: ConvertDirection;
  /** Source-currency minor units — cents for usd_to_ngn, kobo for ngn_to_usd. */
  amountMinor: number;
  idempotencyKey: string;
}): Promise<ConvertResponse["data"]> {
  const res = await apiFetch<ConvertResponse>("/v1/wallet/ngn/convert", {
    method: "POST",
    body: JSON.stringify(params),
  });
  setNairaBalance(res.data.balanceKobo);
  return res.data;
}

/** Client-generated idempotency key for a single user intent. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
