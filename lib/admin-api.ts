"use client";

import { useEffect, useState } from "react";
import { ApiError, apiFetch, isApiConfigured } from "@/lib/api-client";

/**
 * Client for the Local book's admin endpoints (services/api
 * `/v1/admin/*`). Authorization is the central Clerk role — a non-admin
 * session gets 403 FORBIDDEN from every call here, which the desk
 * renders as a "not an admin" state rather than an error.
 */

export interface FxQuote {
  mid: number;
  usdToNgn: number;
  ngnToUsd: number;
  spreadBps: number;
  asOf: string;
}

export type Attention =
  | "cancelled"
  | "resolved_unsettled"
  | "unmatched_outcome"
  | "overdue"
  | "bayse_unreachable"
  | null;

export interface QueueOutcome {
  id: string;
  label: string;
  price: number;
}

export interface QueueMarket {
  marketId: string;
  marketTitle: string;
  openPositions: number;
  openStakeKobo: number;
  maxPayoutKobo: number;
  bayseStatus: string | null;
  bayseResolvedOutcome: string | null;
  bayseWinnerOutcomeId: string | null;
  outcomes: QueueOutcome[];
}

export interface QueueEvent {
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  bayseStatus: string | null;
  resolutionDate: string;
  openPositions: number;
  openStakeKobo: number;
  maxPayoutKobo: number;
  attention: Attention;
  markets: QueueMarket[];
}

export interface SettlementQueue {
  events: QueueEvent[];
  truncated: boolean;
  overdueHours: number;
}

export interface SettlementRecord {
  id: string;
  eventId: string;
  marketId: string;
  winningOutcomeId: string | null;
  voided: boolean;
  source: string;
  actor: string;
  positionsSettled: number;
  payoutTotalKobo: number;
  createdAt: string | null;
}

/** Publish a new USD/NGN mid rate; returns the quote it produces. */
export async function setFxRate(usdToNgn: number): Promise<FxQuote> {
  const res = await apiFetch<{ data: { fx: FxQuote } }>("/v1/admin/fx-rate", {
    method: "POST",
    body: JSON.stringify({ usdToNgn }),
  });
  return res.data.fx;
}

export async function fetchSettlementQueue(): Promise<SettlementQueue> {
  const res = await apiFetch<{ data: SettlementQueue }>("/v1/admin/exposure");
  return res.data;
}

export interface AlertTestResult {
  throttled: boolean;
  email: "sent" | "failed" | "not_configured";
  emailError?: string;
  webhook: "sent" | "failed" | "not_configured";
  recipients: number;
  from: string | null;
}

/** Fire one alert through the real path to prove the config works. */
export async function sendTestAlert(): Promise<AlertTestResult> {
  const res = await apiFetch<{ data: AlertTestResult }>("/v1/admin/test-alert", {
    method: "POST",
  });
  return res.data;
}

export async function fetchSettlements(): Promise<SettlementRecord[]> {
  const res = await apiFetch<{ data: { settlements: SettlementRecord[] } }>(
    "/v1/admin/settlements",
  );
  return res.data.settlements;
}

export interface SettleResult {
  outcome: string;
  positionsSettled?: number;
  payoutTotalKobo?: number;
}

/** Declare a winner and pay out. One shot per market. */
export async function settleMarket(params: {
  eventId: string;
  marketId: string;
  winningOutcomeId: string;
}): Promise<SettleResult> {
  const res = await apiFetch<{ data: SettleResult }>("/v1/admin/settle", {
    method: "POST",
    body: JSON.stringify(params),
  });
  return res.data;
}

/** Void a market — every open stake is refunded. */
export async function voidMarket(params: {
  eventId: string;
  marketId: string;
  reason: string;
}): Promise<SettleResult> {
  const res = await apiFetch<{ data: SettleResult }>("/v1/admin/void", {
    method: "POST",
    body: JSON.stringify(params),
  });
  return res.data;
}

/**
 * Load-once-with-refresh for the desk's two read endpoints. Returns
 * `null` data until the first load lands so callers can tell "empty
 * queue" from "not loaded yet".
 */
export interface AdminResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** API error code, e.g. "FORBIDDEN" — the desk branches on this. */
  errorCode: string | null;
  refresh: () => void;
}

export function useAdminResource<T>(
  /** Must be a stable reference — pass a module-level fetcher, not an inline arrow. */
  load: () => Promise<T>,
  enabled: boolean,
): AdminResource<T> {
  // One state object: the effect body itself never calls setState, only
  // its async callbacks do, so a load can't cascade renders.
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: string | null;
    errorCode: string | null;
  }>({ data: null, loading: true, error: null, errorCode: null });
  const [reloads, setReloads] = useState(0);

  const active = enabled && isApiConfigured();

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    void load()
      .then((data) => {
        if (!cancelled) {
          setState({ data, loading: false, error: null, errorCode: null });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : "Request failed",
          errorCode: err instanceof ApiError ? err.code : null,
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [active, load, reloads]);

  return {
    ...state,
    // nothing is in flight when the resource is switched off
    loading: active && state.loading,
    refresh: () => {
      setState((s) => ({ ...s, loading: true }));
      setReloads((n) => n + 1);
    },
  };
}
