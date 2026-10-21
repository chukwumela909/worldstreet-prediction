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
  /** Names from the positions it paid; absent on an older API. */
  eventTitle?: string | null;
  marketTitle?: string | null;
  eventSlug?: string | null;
  /** The winning side's label, when anyone had backed it. */
  winningOutcomeLabel?: string | null;
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

/* ------------------------------------------------------------------ */
/* Overview — the owner's headline numbers                             */
/* ------------------------------------------------------------------ */

/**
 * One window of the book. Two clocks run here: the "placed" figures
 * (`stakedKobo`, `bets`, `traders`, `averageStakeKobo`) count bets when
 * they are placed, whatever became of them; the "finished" figures
 * (`settledStakesKobo`, `payoutsKobo`, `profitKobo`, `marginPct`) count
 * bets whose market finished (won or lost) in the window.
 */
export interface PeriodStats {
  /** Money staked on bets PLACED in the period (all bets, any status). */
  stakedKobo: number;
  /** Bets placed in the period. */
  bets: number;
  /** Distinct people who placed a bet in the period. */
  traders: number;
  /** stakedKobo / bets (0 when no bets). */
  averageStakeKobo: number;
  /** Stakes on bets that FINISHED (won/lost) in the period. */
  settledStakesKobo: number;
  /** Paid to winners on bets that finished in the period. */
  payoutsKobo: number;
  /** settledStakesKobo − payoutsKobo — the house's profit (negative = loss). */
  profitKobo: number;
  /** profitKobo / settledStakesKobo × 100, null when nothing finished. */
  marginPct: number | null;
  /** Earned by the conversion spread on dollar⇄credit conversions (absent on an older API). */
  conversionEarningsKobo?: number;
  /** Conversions made in the period. */
  conversions?: number;
  /** profitKobo + conversionEarningsKobo — everything the book made. */
  totalEarnedKobo?: number;
  /** Stakes kept from bets that lost — the platform's betting income. */
  lostStakesKobo?: number;
  /** What winners won on top of their own stake back — the platform's betting cost. */
  winningsPaidKobo?: number;
  /** lostStakesKobo + conversionEarningsKobo; net = this − winningsPaidKobo. */
  platformMadeKobo?: number;
}

export interface AdminOverview {
  periods: {
    last24h: PeriodStats;
    last7Days: PeriodStats;
    last30Days: PeriodStats;
    allTime: PeriodStats;
  };
  /** Money in play right now. */
  open: {
    bets: number;
    markets: number;
    stakeKobo: number;
    potentialPayoutKobo: number;
  };
  /** Everyone who has ever staked. */
  tradersWithStakes: number;
  /** Every account, staked or not. */
  accounts: number;
  /** Users' unspent credit balances. */
  creditHeldKobo: number;
  /** Naira per $1 mid rate; null if never set. */
  fx: { usdToNgnMid: number; asOf: string } | null;
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  const res = await apiFetch<{ success: boolean; data: AdminOverview }>(
    "/v1/admin/overview",
  );
  return res.data;
}

/**
 * The current conversion rate, read as an admin — the desk's own way to
 * it, so a desk unlocked with an access key (no user session) can read
 * it too. `null` until a rate has ever been set.
 */
export async function fetchAdminFx(): Promise<FxQuote | null> {
  const res = await apiFetch<{ success: boolean; data: { fx: FxQuote | null } }>(
    "/v1/admin/fx",
  );
  return res.data.fx ?? null;
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

export interface PausedVoidResult {
  /** Markets with open bets that the paused topics cover. */
  markets: number;
  /** Open bets on them. */
  positions: number;
  /** Stakes refunded, or that would be on a preview, kobo. */
  refundKobo: number;
  /** Markets settled by someone else first, left alone. */
  alreadySettled: number;
  /** Customers told by email that their bet was refunded (0 on a preview). */
  emailed: number;
  dryRun: boolean;
  topics: string[];
}

/**
 * Void every market the paused topics cover that still has open bets,
 * refunding each stake. `dryRun` only counts — the desk previews first.
 */
export async function voidPausedMarkets(params: {
  reason: string;
  dryRun: boolean;
}): Promise<PausedVoidResult> {
  try {
    const res = await apiFetch<{ data: PausedVoidResult }>("/v1/admin/void-paused", {
      method: "POST",
      body: JSON.stringify(params),
    });
    return res.data;
  } catch (err) {
    throw unwrapNestedError(err);
  }
}

export interface PausedRefundMarket {
  marketId: string;
  eventTitle: string;
  marketTitle: string;
  bets: number;
  refundKobo: number;
  voidedAt: string | null;
  /** "auto" (the minute-by-minute pause) or the admin who voided it. */
  voidedBy: string;
  reason: string;
}

export interface PausedRefundCustomer {
  authUserId: string;
  username: string;
  email: string;
  bets: number;
  refundKobo: number;
  events: string[];
  refundedAt: string | null;
  /** When the apology email went; null = not told yet. */
  emailedAt: string | null;
}

/** What the paused topics refunded, over the last `hours`. */
export interface PausedRefundReport {
  topics: string[];
  hours: number;
  /** Whether the API can send customer email at all (Resend set up). */
  mailConfigured: boolean;
  totals: {
    customers: number;
    bets: number;
    refundKobo: number;
    emailed: number;
    notEmailed: number;
  };
  markets: PausedRefundMarket[];
  customers: PausedRefundCustomer[];
}

/** Refunds from paused topics in the last 3 days — module-level, for useAdminResource. */
export async function fetchPausedRefunds(): Promise<PausedRefundReport> {
  try {
    const res = await apiFetch<{ data: PausedRefundReport }>("/v1/admin/paused-refunds?hours=72");
    return res.data;
  } catch (err) {
    throw unwrapNestedError(err);
  }
}

export type SettledStatus = "won" | "lost" | "voided";

export interface TopicBet {
  id: string;
  marketId: string;
  authUserId: string;
  username: string;
  eventTitle: string;
  marketTitle: string;
  outcomeLabel: string;
  stakeKobo: number;
  priceKobo: number;
  /** What a win paid (stake included); paid only when won. */
  payoutKobo: number;
  status: SettledStatus;
  /** Set when the desk reversed it after it settled (Recovery). */
  reversedFrom?: "won" | "lost" | "open" | null;
  placedAt: string | null;
  settledAt: string | null;
}

export interface TopicCustomer {
  authUserId: string;
  username: string;
  email: string;
  bets: number;
  won: number;
  lost: number;
  refunded: number;
  stakedKobo: number;
  paidKobo: number;
  refundedKobo: number;
  /** Paid + refunded − staked: what they're up (+) or down (−). */
  resultKobo: number;
  /** Stake-weighted average price paid per ₦100 share. */
  avgPriceKobo: number;
  lastSettledAt: string | null;
}

/** One market's bets — for a 15-minute series, one window. */
export interface TopicRound {
  marketId: string;
  eventTitle: string;
  marketTitle: string;
  settledAt: string | null;
  bets: number;
  customers: number;
  stakedKobo: number;
  paidKobo: number;
  refundedKobo: number;
  houseResultKobo: number;
  /** The side(s) that paid out. */
  winning: string[];
  avgPriceKobo: number;
}

/** Every bet on a topic's markets that finished in the window, and who placed it. */
export interface TopicBetsReport {
  topics: string[];
  hours: number;
  totals: {
    customers: number;
    bets: number;
    won: number;
    lost: number;
    refunded: number;
    stakedKobo: number;
    paidKobo: number;
    refundedKobo: number;
    /** Staked − paid − refunded: what the house kept (+) or lost (−). */
    houseResultKobo: number;
    /** Stake-weighted average price paid per ₦100 share. */
    avgPriceKobo: number;
    rounds: number;
  };
  open: { bets: number; stakeKobo: number };
  customers: TopicCustomer[];
  rounds: TopicRound[];
  bets: TopicBet[];
  truncated: boolean;
}

/** Settled bets on these topics (the paused ones when none are given). */
export async function fetchTopicBets(params: {
  topics?: string[];
  hours: number;
}): Promise<TopicBetsReport> {
  const qs = new URLSearchParams({ hours: String(params.hours) });
  if (params.topics && params.topics.length > 0) qs.set("topics", params.topics.join(","));
  try {
    const res = await apiFetch<{ data: TopicBetsReport }>(`/v1/admin/topic-bets?${qs}`);
    return res.data;
  } catch (err) {
    throw unwrapNestedError(err);
  }
}

/* ---------- Recovery: reversing settled bets ---------- */

export type Shortfall = "negative" | "cap";

export interface RecoveryCustomer {
  authUserId: string;
  username: string;
  email: string;
  bets: number;
  takenBackKobo: number;
  returnedKobo: number;
  writtenOffKobo: number;
  balanceKobo: number;
  emailedAt: string | null;
  reversedAt: string | null;
}

/** Every bet reversed for the same reason — one incident. */
export interface RecoveryIncident {
  /** As the desk wrote it; "" for the first reversals, before reasons were kept. */
  reason: string;
  bets: number;
  customers: number;
  takenBackKobo: number;
  returnedKobo: number;
  netKobo: number;
  firstAt: string | null;
  lastAt: string | null;
  untoldBets: number;
}

/** What reversing has recovered so far. */
export interface RecoveryReport {
  totals: {
    bets: number;
    customers: number;
    takenBackKobo: number;
    returnedKobo: number;
    netKobo: number;
    owedKobo: number;
    owingCustomers: number;
    writtenOffKobo: number;
    emailed: number;
    notEmailed: number;
  };
  mailConfigured: boolean;
  /** Newest first; absent on an API older than reasons. */
  incidents?: RecoveryIncident[];
  /** Customers wrongly emailed that their reversed bets were refunded. */
  refundCorrection?: { waiting: number; corrected: number };
  customers: RecoveryCustomer[];
}

/** What a reversal would do — nothing moves. */
export interface ReversalPreview {
  topics: string[];
  sinceDays: number | null;
  bets: number;
  won: number;
  lost: number;
  customers: number;
  takeBackKobo: number;
  returnKobo: number;
  netKobo: number;
  shortCustomers: number;
  shortKobo: number;
  openBets: number;
  events: { title: string; bets: number }[];
  /** Whether every topic is paused — needed only while bets are open. */
  paused: boolean;
}

export interface ReversalBatch {
  reversed: number;
  remaining: number;
  changeKobo: number;
  writtenOffKobo: number;
}

export interface ReversalNotice {
  customers: number;
  emailed: number;
  mailConfigured: boolean;
  dryRun: boolean;
}

async function adminPost<T>(path: string, body: unknown): Promise<T> {
  try {
    const res = await apiFetch<{ data: T }>(path, { method: "POST", body: JSON.stringify(body) });
    return res.data;
  } catch (err) {
    throw unwrapNestedError(err);
  }
}

/** Module-level, for useAdminResource. */
export async function fetchRecovery(): Promise<RecoveryReport> {
  try {
    const res = await apiFetch<{ data: RecoveryReport }>("/v1/admin/recovery");
    return res.data;
  } catch (err) {
    throw unwrapNestedError(err);
  }
}

export const previewReversal = (params: { topics: string[]; sinceDays: number | null }) =>
  adminPost<ReversalPreview>("/v1/admin/recovery/preview", params);

/** One batch; call again until `remaining` is 0. The reason goes in the customers' email. */
export const runReversalBatch = (params: {
  topics: string[];
  sinceDays: number | null;
  shortfall: Shortfall;
  reason: string;
}) => adminPost<ReversalBatch>("/v1/admin/recovery/run", { ...params, confirm: "REVERSE" });

export const notifyReversals = (dryRun: boolean) =>
  adminPost<ReversalNotice>("/v1/admin/recovery/notify", { dryRun });

export interface DebtClearing {
  customers: number;
  owedKobo: number;
  dryRun: boolean;
}

/** Bring every reversal customer below zero back to zero; `dryRun` only counts. */
export const clearDebts = (dryRun: boolean) =>
  adminPost<DebtClearing>("/v1/admin/recovery/clear-debts", { dryRun });

export interface RefundCorrection {
  customers: number;
  /** Still below zero — the email says it's waived, so the send waits for them. */
  owing: number;
  emailed: number;
  mailConfigured: boolean;
  dryRun: boolean;
}

/** The apology for the refund email reversed customers got by mistake; `dryRun` only counts. */
export const correctRefundEmails = (dryRun: boolean) =>
  adminPost<RefundCorrection>("/v1/admin/recovery/correct-refund-email", { dryRun });

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
  /** HTTP status of the last failure (0 for network), e.g. 404 on an older API. */
  errorStatus: number | null;
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
    errorStatus: number | null;
  }>({ data: null, loading: true, error: null, errorCode: null, errorStatus: null });
  const [reloads, setReloads] = useState(0);

  const active = enabled && isApiConfigured();

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    void load()
      .then((data) => {
        if (!cancelled) {
          setState({
            data,
            loading: false,
            error: null,
            errorCode: null,
            errorStatus: null,
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : "Request failed",
          errorCode: err instanceof ApiError ? err.code : null,
          errorStatus: err instanceof ApiError ? err.status : null,
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
  /** Basis points added to Bayse's price on every Local bet; our own markets take none. */
  localSpreadBps: number;
  /** Dollar↔credit conversion margin each way; 100 = 1%. */
  fxSpreadBps: number;
  /** Auto-adjusting spread: a market's exposed side rises 1 point per this much at risk, kobo, uncapped; 0 = off. */
  autoSpreadStepKobo: number;
  /** The highest price we sell a share at, kobo; 0 = no limit. */
  maxQuoteKobo: number;
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
  /**
   * Paused topics ("bitcoin", "btc"): matching markets take no bets and
   * leave the site; [] = nothing paused. Edited on the Paused markets card.
   */
  pausedTopics: string[];
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
  from: number | boolean | string[];
  to: number | boolean | string[];
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

/**
 * `recent` last bet, newest first · `staked` most staked · `open` most
 * money in play now · `pnl` biggest winners · `losers` biggest losers
 * (realized P&L ascending) · `balance` · `trades` · `joined` newest.
 */
export const TRADER_SORTS = [
  "recent",
  "staked",
  "open",
  "pnl",
  "losers",
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
  /** Set while the account is suspended; absent on an older API. */
  suspendedAt?: string | null;
  suspendedReason?: string;
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
  /** Set when the desk reversed it after it settled — voided, but not a refund. */
  reversedFrom?: "won" | "lost" | "open" | null;
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

export interface AccountAction {
  action: "suspend" | "reinstate";
  reason: string;
  by: string;
  at: string;
}

export interface TraderDetail {
  trader: TraderRow;
  positions: TraderPosition[];
  ledger: TraderLedgerEntry[];
  /** Suspensions and reinstatements, newest first. */
  accountActions?: AccountAction[];
}

/** The people list. Searches username, display name and email. */
export async function fetchTraders(params: {
  search?: string;
  sort?: TraderSort;
  limit?: number;
  offset?: number;
  activeOnly?: boolean;
  suspendedOnly?: boolean;
}): Promise<TraderList> {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.sort) qs.set("sort", params.sort);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  if (params.activeOnly) qs.set("activeOnly", "true");
  if (params.suspendedOnly) qs.set("suspendedOnly", "true");
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

export interface AccountActionResult {
  authUserId: string;
  suspended: boolean;
  suspendedAt: string | null;
  reason: string;
  /** Whether the customer's email went out; null when none was asked for. */
  emailed: boolean | null;
}

/**
 * Suspend an account: no new bets, no money in or out, until lifted. The
 * reason is the customer's to read; `notify` emails it to them.
 */
export const suspendAccount = (authUserId: string, params: { reason: string; notify: boolean }) =>
  adminPost<AccountActionResult>(`/v1/admin/traders/${encodeURIComponent(authUserId)}/suspend`, params);

export const reinstateAccount = (authUserId: string, params: { reason: string; notify: boolean }) =>
  adminPost<AccountActionResult>(`/v1/admin/traders/${encodeURIComponent(authUserId)}/reinstate`, params);

/* ------------------------------------------------------------------ */
/* Support desk                                                        */
/* ------------------------------------------------------------------ */

export type SupportStatus = "open" | "answered" | "closed";
export type SupportCategory = "money" | "bets" | "account" | "other";

export const SUPPORT_CATEGORY_LABEL: Record<SupportCategory, string> = {
  money: "Deposits & withdrawals",
  bets: "A bet or market",
  account: "My account",
  other: "Something else",
};

export interface SupportTicketRow {
  ref: string;
  authUserId: string;
  email: string;
  username: string;
  category: SupportCategory;
  subject: string;
  status: SupportStatus;
  createdAt: string | null;
  lastMessageAt: string;
  messageCount: number;
  /** Who wrote last — "customer" means it's waiting on us. */
  lastFrom: "customer" | "support";
  preview: string;
}

export interface SupportInbox {
  tickets: SupportTicketRow[];
  total: number;
  counts: Record<SupportStatus, number>;
  mailConfigured: boolean;
}

export interface SupportMessage {
  from: "customer" | "support";
  body: string;
  /** Who on the desk wrote it; empty for the customer's. */
  by: string;
  at: string;
}

export interface SupportTicketDetail {
  ticket: Omit<SupportTicketRow, "messageCount" | "lastFrom" | "preview"> & { messages: SupportMessage[] };
  account: {
    joinedAt: string | null;
    balanceKobo: number;
    bets: number;
    suspendedAt: string | null;
    suspendedReason: string;
  };
}

export async function fetchSupportInbox(params: {
  status: SupportStatus | "all";
  search?: string;
  offset?: number;
}): Promise<SupportInbox> {
  const qs = new URLSearchParams({ status: params.status });
  if (params.search) qs.set("search", params.search);
  if (params.offset) qs.set("offset", String(params.offset));
  try {
    const res = await apiFetch<{ data: SupportInbox }>(`/v1/admin/support?${qs.toString()}`);
    return res.data;
  } catch (err) {
    throw unwrapNestedError(err);
  }
}

export async function fetchSupportTicket(ref: string): Promise<SupportTicketDetail> {
  try {
    const res = await apiFetch<{ data: SupportTicketDetail }>(`/v1/admin/support/${encodeURIComponent(ref)}`);
    return res.data;
  } catch (err) {
    throw unwrapNestedError(err);
  }
}

/** Answer a request — added to the thread and emailed to the customer. */
export const replySupport = (ref: string, params: { message: string; close: boolean }) =>
  adminPost<{ ticket: SupportTicketDetail["ticket"]; emailed: boolean }>(
    `/v1/admin/support/${encodeURIComponent(ref)}/reply`,
    params,
  );

export const setSupportStatus = (ref: string, status: "open" | "closed") =>
  adminPost<{ ticket: SupportTicketDetail["ticket"] }>(`/v1/admin/support/${encodeURIComponent(ref)}/status`, {
    status,
  });
