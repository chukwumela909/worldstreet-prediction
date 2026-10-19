"use client";

import { useEffect, useState } from "react";
import { ApiError, apiFetch, isApiConfigured } from "@/lib/api-client";
import { ADMIN_KEY_HEADER } from "@/lib/admin-key";

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

export type MarketOrigin = "bayse" | "worldstreet";

export interface QueueMarket {
  marketId: string;
  marketTitle: string;
  openPositions: number;
  openStakeKobo: number;
  maxPayoutKobo: number;
  upstreamStatus: string | null;
  resolvedOutcomeLabel: string | null;
  winnerOutcomeId: string | null;
  outcomes: QueueOutcome[];
}

export interface QueueEvent {
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  origin: MarketOrigin | null;
  upstreamStatus: string | null;
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

/**
 * What the whole open book could cost the house. `worstCaseKobo`
 * assumes every open market resolves against us at once, net of the
 * stakes already collected — negative is a loss.
 */
export interface BookRisk {
  openPositions: number;
  openMarkets: number;
  openStakeKobo: number;
  worstCaseKobo: number;
  worstMarket: {
    marketId: string;
    marketTitle: string;
    eventTitle: string;
    eventSlug: string;
    lossKobo: number;
  } | null;
  /**
   * The "Maximum loss per market" setting the flags below are measured
   * against. Absent on an API older than the settings page.
   */
  maxMarketExposureKobo?: number;
  /** Markets at 70%+ of that limit, worst first. Absent on an older API. */
  limitFlags?: MarketLimitFlag[];
}

/**
 * One market closing in on the per-market loss limit: `usedKobo` is what
 * its open bets could win beyond their stakes, `share` that over the
 * limit (can pass 1). "watch" from 70%, "critical" from 90%.
 */
export interface MarketLimitFlag {
  marketId: string;
  marketTitle: string;
  eventTitle: string;
  eventSlug: string;
  usedKobo: number;
  limitKobo: number;
  share: number;
  level: "watch" | "critical";
}

/** Settled-market figures for one window (or one book within it). */
export interface PnlFigures {
  /** Stakes on settled won + lost bets — what came in. */
  stakesKobo: number;
  /** Paid out to winners. */
  payoutsKobo: number;
  /** Handed back on voided bets — no effect on profit. */
  refundsKobo: number;
  /** stakes − payouts; negative means the house lost money. */
  profitKobo: number;
  positions: number;
  markets: number;
}

export interface PnlWindow extends PnlFigures {
  local: PnlFigures;
  international: PnlFigures;
}

/** What the book has actually made or lost on finished markets. */
export interface ProfitAndLoss {
  allTime: PnlWindow;
  last30Days: PnlWindow;
  last7Days: PnlWindow;
}

export async function fetchProfitAndLoss(): Promise<ProfitAndLoss> {
  const res = await apiFetch<{ data: ProfitAndLoss }>("/v1/admin/pnl");
  return res.data;
}

export async function fetchBookRisk(): Promise<BookRisk> {
  const res = await apiFetch<{ data: BookRisk }>("/v1/admin/risk");
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

/* ------------------------------------------------------------------ */
/* Worldstreet's own markets                                           */
/* ------------------------------------------------------------------ */

export type WsEventStatus =
  | "draft"
  | "open"
  | "closed"
  | "resolved"
  | "cancelled";
export type WsMarketStatus = "open" | "closed" | "resolved" | "cancelled";

export interface WsOutcome {
  id: string;
  label: string;
  /** Kobo per ₩100 share — what the buyer pays. */
  priceKobo: number;
}

/**
 * One side of an open market. `profitIfWinsKobo` is the number that
 * decides whether a price should move: everything staked across the
 * market, less what this side would pay out. Negative means the house
 * is short it.
 */
export interface OutcomeRisk {
  outcomeId: string;
  outcomeLabel: string;
  positions: number;
  stakeKobo: number;
  payoutKobo: number;
  profitIfWinsKobo: number;
}

export interface WsMarketExposure {
  openPositions: number;
  openStakeKobo: number;
  maxPayoutKobo: number;
  /** Settled ones included — any at all blocks deletion. */
  totalPositions: number;
  /** Empty until someone has traded it. Worst side first. */
  outcomes: OutcomeRisk[];
  worstCaseKobo: number;
  worstOutcomeId: string | null;
}

export interface WsMarket {
  id: string;
  title: string;
  rules: string;
  status: WsMarketStatus;
  outcomes: WsOutcome[];
  /** House edge in the two prices, basis points over ₩100. */
  marginBps: number;
  resolvedOutcomeId: string | null;
  exposure: WsMarketExposure;
}

export interface WsEvent {
  id: string;
  slug: string;
  title: string;
  category: string;
  description: string;
  imageUrl: string;
  resolutionSource: string;
  status: WsEventStatus;
  closesAt: string | null;
  resolutionDate: string | null;
  trades: number;
  stakedKobo: number;
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
  markets: WsMarket[];
}

export interface WsOutcomeInput {
  label: string;
  priceKobo: number;
}

export interface WsMarketInput {
  title: string;
  rules?: string;
  outcomes: WsOutcomeInput[];
}

export interface WsEventInput {
  title: string;
  category: string;
  description?: string;
  imageUrl?: string;
  resolutionSource?: string;
  closesAt?: string | null;
  resolutionDate?: string | null;
  status?: "draft" | "open";
  markets: WsMarketInput[];
}

export interface WsEventPatch {
  title?: string;
  category?: string;
  description?: string;
  imageUrl?: string;
  resolutionSource?: string;
  closesAt?: string | null;
  resolutionDate?: string | null;
  status?: "draft" | "open" | "closed" | "cancelled";
}

export interface WsMarketPatch {
  title?: string;
  rules?: string;
  status?: "open" | "closed";
  outcomes?: WsOutcomeInput[];
}

const WS_BASE = "/v1/admin/worldstreet/events";

export async function fetchWsEvents(): Promise<WsEvent[]> {
  const res = await apiFetch<{ data: { events: WsEvent[] } }>(WS_BASE);
  return res.data.events;
}

/** Every write returns the event as it now stands, so the desk re-renders from truth. */
async function writeWsEvent(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<WsEvent> {
  const res = await apiFetch<{ data: { event: WsEvent } }>(url, {
    method,
    body: JSON.stringify(body),
  });
  return res.data.event;
}

export function createWsEvent(input: WsEventInput): Promise<WsEvent> {
  return writeWsEvent(WS_BASE, "POST", input);
}

export function updateWsEvent(
  eventId: string,
  patch: WsEventPatch,
): Promise<WsEvent> {
  return writeWsEvent(`${WS_BASE}/${eventId}`, "PATCH", patch);
}

export function addWsMarket(
  eventId: string,
  input: WsMarketInput,
): Promise<WsEvent> {
  return writeWsEvent(`${WS_BASE}/${eventId}/markets`, "POST", input);
}

export function updateWsMarket(
  eventId: string,
  marketId: string,
  patch: WsMarketPatch,
): Promise<WsEvent> {
  return writeWsEvent(`${WS_BASE}/${eventId}/markets/${marketId}`, "PATCH", patch);
}

export async function deleteWsMarket(
  eventId: string,
  marketId: string,
): Promise<WsEvent> {
  const res = await apiFetch<{ data: { event: WsEvent } }>(
    `${WS_BASE}/${eventId}/markets/${marketId}`,
    { method: "DELETE" },
  );
  return res.data.event;
}

export async function deleteWsEvent(eventId: string): Promise<void> {
  await apiFetch(`${WS_BASE}/${eventId}`, { method: "DELETE" });
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
  /**
   * Bump to re-read from outside — for a resource whose data something
   * else on the page changes, so the owner of that action can say so.
   * The current figures stay on screen while the new ones land.
   */
  version = 0,
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
  }, [active, load, reloads, version]);

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

/* ------------------------------------------------------------------ */
/* Book settings — how the book prices and limits bets                 */
/* ------------------------------------------------------------------ */

/**
 * Everything is stored in the API's own units — basis points, kobo,
 * seconds — and converted to points / % / credit only on screen.
 */
export interface BookSettings {
  /** Real-money betting on international (Polymarket) markets. */
  internationalTrading: boolean;
  /** Basis points of a 100-credit share added to Polymarket's price; 100 = 1 point. */
  polymarketSpreadBps: number;
  /** Dollar↔credit conversion margin each way; 100 = 1%. */
  fxSpreadBps: number;
  minStakeKobo: number;
  maxStakeKobo: number;
  /** The most the house may lose on one market. */
  maxMarketExposureKobo: number;
  /** How far a price may move before the user must re-confirm it. */
  priceToleranceKobo: number;
  /** Betting stops this long before a countdown market closes. */
  countdownCutoffSeconds: number;
  /** Alert the admins when the book's worst case reaches this loss; 0 = off. */
  lossAlertKobo: number;
}

export type BookSettingKey = keyof BookSettings;

/** The settings that are numbers — every one but the on/off switch. */
export type NumericBookSettingKey = {
  [K in BookSettingKey]: BookSettings[K] extends number ? K : never;
}[BookSettingKey];

export interface SettingLimit {
  min: number;
  max: number;
}

/** One saved edit, from the audit trail. */
export interface BookSettingChange {
  field: BookSettingKey;
  from: number | boolean;
  to: number | boolean;
  by: string;
  at: string;
}

export interface BookSettingsState {
  settings: BookSettings;
  defaults: BookSettings;
  /** Allowed range per numeric setting, in the API's units. */
  limits: Partial<Record<NumericBookSettingKey, SettingLimit>>;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Newest first, up to 30. */
  history: BookSettingChange[];
}

/**
 * The API's envelope is `{ success, message, code }`, but the settings
 * routes may answer `{ success, error: { code, message } }`. Re-raise
 * the nested form as an ordinary ApiError so callers read `.message`
 * and `.code` the same way either way.
 */
function unwrapNestedError(err: unknown): unknown {
  if (!(err instanceof ApiError)) return err;
  const data = err.data;
  if (!data || typeof data !== "object" || !("error" in data)) return err;
  const nested = (data as { error?: unknown }).error;
  if (!nested || typeof nested !== "object") return err;
  const { message, code } = nested as { message?: unknown; code?: unknown };
  if (typeof message !== "string" || !message) return err;
  return new ApiError(message, err.status, {
    code: typeof code === "string" ? code : undefined,
    message,
  });
}

/**
 * Check an access key with the API before the desk keeps it — the
 * unlock form's one call. Resolves to the key's name ("josh"); throws
 * the API's refusal (401 INVALID_ADMIN_KEY) for a wrong one.
 */
export async function verifyAdminKey(key: string): Promise<{ label: string }> {
  const res = await apiFetch<{ data: { label: string; via: "key" | "clerk" } }>(
    "/v1/admin/whoami",
    { headers: { [ADMIN_KEY_HEADER]: key } },
  );
  // the API answers "key:<name>"; the desk shows the name
  return { label: res.data.label.replace(/^key:/, "") };
}

export async function fetchBookSettings(): Promise<BookSettingsState> {
  try {
    const res = await apiFetch<{ data: BookSettingsState }>("/v1/admin/settings");
    return res.data;
  } catch (err) {
    throw unwrapNestedError(err);
  }
}

/**
 * Send only the settings that changed. Returns the whole state as it
 * now stands (history included), so the page re-renders from truth.
 * A rejected combination — say a minimum above the maximum — comes back
 * as 400 INVALID_SETTINGS with a message written for the admin.
 */
export async function updateBookSettings(
  patch: Partial<BookSettings>,
): Promise<BookSettingsState> {
  try {
    const res = await apiFetch<{ data: BookSettingsState }>("/v1/admin/settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    return res.data;
  } catch (err) {
    throw unwrapNestedError(err);
  }
}

/* ------------------------------------------------------------------ */
/* Traders — who is playing the book                                   */
/* ------------------------------------------------------------------ */

export const TRADER_SORTS = [
  "recent",
  "staked",
  "pnl",
  "balance",
  "trades",
  "joined",
] as const;
export type TraderSort = (typeof TRADER_SORTS)[number];

export interface TraderRow {
  authUserId: string;
  username: string;
  displayName: string;
  email: string;
  avatar: string;
  joinedAt: string | null;
  balanceKobo: number;
  trades: number;
  openPositions: number;
  wonPositions: number;
  lostPositions: number;
  voidedPositions: number;
  stakedKobo: number;
  openStakeKobo: number;
  openPayoutKobo: number;
  /** Realized profit for the trader; the house's side of it is the inverse. */
  realizedPnlKobo: number;
  lastTradeAt: string | null;
}

export interface TraderSummary {
  users: number;
  traders: number;
  stakedKobo: number;
  openStakeKobo: number;
  realizedPnlKobo: number;
  balanceKobo: number;
}

export interface TraderList {
  traders: TraderRow[];
  total: number;
  summary: TraderSummary;
  truncated: boolean;
}

export interface TraderPosition {
  id: string;
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  marketTitle: string;
  outcomeLabel: string;
  stakeKobo: number;
  priceKobo: number;
  potentialPayoutKobo: number;
  status: "open" | "won" | "lost" | "voided";
  createdAt: string | null;
  settledAt: string | null;
}

export interface TraderLedgerEntry {
  id: string;
  type: string;
  amountKobo: number;
  balanceAfterKobo: number;
  description: string;
  createdAt: string | null;
}

export interface TraderDetail {
  trader: TraderRow;
  positions: TraderPosition[];
  ledger: TraderLedgerEntry[];
}

/** The people list. Searches username, display name and email. */
export async function fetchTraders(params: {
  search?: string;
  sort?: TraderSort;
  limit?: number;
  offset?: number;
  activeOnly?: boolean;
}): Promise<TraderList> {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.sort) qs.set("sort", params.sort);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  if (params.activeOnly) qs.set("activeOnly", "true");
  const res = await apiFetch<{ data: TraderList }>(
    `/v1/admin/traders?${qs.toString()}`,
  );
  return res.data;
}

/** One person's play: their positions and money movements, newest first. */
export async function fetchTrader(authUserId: string): Promise<TraderDetail> {
  const res = await apiFetch<{ data: TraderDetail }>(
    `/v1/admin/traders/${encodeURIComponent(authUserId)}`,
  );
  return res.data;
}
