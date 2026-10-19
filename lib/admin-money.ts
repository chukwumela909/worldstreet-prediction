"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { fetchAdminFx, type FxQuote } from "@/lib/admin-api";
import { isApiConfigured } from "@/lib/api-client";
import { useAdminKey } from "@/lib/admin-key";
import { localPref, useLocalPref } from "@/lib/admin-prefs";

/**
 * Money on the admin desk, in naira or dollars.
 *
 * The API speaks kobo (100 kobo = ₦1). The desk shows naira under the
 * ₦ sign — not the ₩ credit mark the public site uses (lib/format.ts
 * `CREDIT`) — or, when the viewer picks $, dollars at the conversion
 * rate's mid: kobo / 100 / mid. Which one is a per-viewer choice kept
 * in this browser; dollars need a rate, so without one the desk stays
 * in naira whatever was picked.
 *
 * The rate is read once from `GET /v1/admin/fx` into a module-level
 * store every consumer shares, and re-read when the FX card sets a new
 * one (`publishAdminFx` + `refreshAdminFx`).
 */

export type AdminCurrency = "ngn" | "usd";

const NAIRA_SIGN = "₦";
const DOLLAR_SIGN = "$";
const MINUS = "−"; // U+2212: reads as a sign, not a hyphen

const currencyPref = localPref<AdminCurrency>("ws-admin-currency", "ngn", (v) =>
  v === "ngn" || v === "usd" ? v : null,
);

export function setAdminCurrency(next: AdminCurrency): void {
  currencyPref.set(next);
}

/* ------------------------------------------------------------------ */
/* The conversion rate, shared                                          */
/* ------------------------------------------------------------------ */

export type AdminFxStatus = "idle" | "loading" | "ready" | "failed";

export interface AdminFxState {
  /** null until loaded, or when no rate has ever been set. */
  fx: FxQuote | null;
  status: AdminFxStatus;
  error: string | null;
}

const IDLE: AdminFxState = { fx: null, status: "idle", error: null };
/** A failed read is retried by the next consumer to mount, but not more often than this. */
const RETRY_AFTER_MS = 60_000;

let fxState: AdminFxState = IDLE;
/** Who the last read was made as — a different key re-reads. */
let fxIdentity: string | null = null;
let fxAttemptAt = 0;
/** Bumped per read, so a slow answer for an old identity is dropped. */
let fxSeq = 0;
const fxListeners = new Set<() => void>();

function commitFx(next: AdminFxState) {
  fxState = next;
  for (const listener of fxListeners) listener();
}

function subscribeFx(listener: () => void) {
  fxListeners.add(listener);
  return () => fxListeners.delete(listener);
}

const getFx = () => fxState;
const getServerFx = () => IDLE;

function loadFx(identity: string): Promise<void> {
  const seq = ++fxSeq;
  fxIdentity = identity;
  fxAttemptAt = Date.now();
  commitFx({ ...fxState, status: "loading", error: null });
  return fetchAdminFx()
    .then((fx) => {
      if (seq === fxSeq) commitFx({ fx, status: "ready", error: null });
    })
    .catch((err: unknown) => {
      if (seq !== fxSeq) return;
      // keep a rate we already had; a blip shouldn't flip the desk to naira
      commitFx({
        ...fxState,
        status: fxState.fx ? "ready" : "failed",
        error: err instanceof Error ? err.message : "Could not load the rate",
      });
    });
}

function ensureFx(identity: string) {
  if (!isApiConfigured()) return;
  if (identity !== fxIdentity) {
    void loadFx(identity);
    return;
  }
  if (fxState.status === "idle") void loadFx(identity);
  else if (fxState.status === "failed" && Date.now() - fxAttemptAt > RETRY_AFTER_MS) {
    void loadFx(identity);
  }
}

/** Re-read the rate now (after "Set rate", or a manual refresh). */
export function refreshAdminFx(): Promise<void> {
  if (!isApiConfigured()) return Promise.resolve();
  return loadFx(fxIdentity ?? "session");
}

/** Show a rate the API just handed back, before the re-read lands. */
export function publishAdminFx(fx: FxQuote): void {
  commitFx({ fx, status: "ready", error: null });
}

/** The shared conversion rate; the first consumer to mount reads it. */
export function useAdminFx(): AdminFxState {
  const state = useSyncExternalStore(subscribeFx, getFx, getServerFx);
  const adminKey = useAdminKey();
  // undefined: the key hasn't been read yet — wait rather than read twice
  const identity = adminKey === undefined ? null : (adminKey?.key ?? "session");

  useEffect(() => {
    if (identity !== null) ensureFx(identity);
  }, [identity]);

  return state;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                           */
/* ------------------------------------------------------------------ */

/** kobo → whole units of the currency shown. */
function toUnits(kobo: number, currency: AdminCurrency, rate: number | null): number {
  return currency === "usd" && rate ? kobo / 100 / rate : kobo / 100;
}

function sign(currency: AdminCurrency): string {
  return currency === "usd" ? DOLLAR_SIGN : NAIRA_SIGN;
}

/**
 * "₦12,500" / "₦12,500.75" / "$8.62". Naira only shows kobo when there
 * are any; dollars always carry cents, since a conversion rarely lands
 * on a whole one. Negative amounts put the sign outside: "−₦4,200".
 */
export function formatAdminMoney(
  kobo: number,
  currency: AdminCurrency,
  rate: number | null,
): string {
  if (!Number.isFinite(kobo)) return `${sign(currency)}0`;
  const usd = currency === "usd" && rate !== null;
  const value = Math.abs(toUnits(kobo, usd ? "usd" : "ngn", rate));
  const decimals = usd ? 2 : Math.abs(kobo) % 100 === 0 ? 0 : 2;
  const text = value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  // a value that rounds to zero shouldn't wear a minus
  const negative = kobo < 0 && Number(value.toFixed(decimals)) !== 0;
  return `${negative ? MINUS : ""}${usd ? DOLLAR_SIGN : NAIRA_SIGN}${text}`;
}

/** "+₦5,800" / "−₦4,200"; zero has no sign. */
export function formatAdminMoneySigned(
  kobo: number,
  currency: AdminCurrency,
  rate: number | null,
): string {
  const text = formatAdminMoney(kobo, currency, rate);
  return kobo > 0 && !/^[₦$]0(\.00)?$/.test(text) ? `+${text}` : text;
}

const COMPACT_UNITS = [
  { at: 1e9, suffix: "B" },
  { at: 1e6, suffix: "M" },
  { at: 1e3, suffix: "K" },
] as const;

/**
 * "₦1.2M" / "$8.5K" / "−₦340K"; under a thousand it is the exact amount.
 * `from` raises the threshold where abbreviating starts (headline tiles
 * stay exact below a million).
 */
export function formatAdminMoneyCompact(
  kobo: number,
  currency: AdminCurrency,
  rate: number | null,
  from = 1e3,
): string {
  if (!Number.isFinite(kobo)) return `${sign(currency)}0`;
  const usd = currency === "usd" && rate !== null;
  const value = Math.abs(toUnits(kobo, usd ? "usd" : "ngn", rate));
  const symbol = usd ? DOLLAR_SIGN : NAIRA_SIGN;
  const minus = kobo < 0 ? MINUS : "";

  for (let i = 0; i < COMPACT_UNITS.length; i++) {
    const unit = COMPACT_UNITS[i];
    if (value < unit.at || value < from) continue;
    let scaled = value / unit.at;
    let suffix: string = unit.suffix;
    // 999,950 is "1M", not "1000K"
    if (Number(trim(scaled)) >= 1000 && i > 0) {
      scaled = value / COMPACT_UNITS[i - 1].at;
      suffix = COMPACT_UNITS[i - 1].suffix;
    }
    return `${minus}${symbol}${trim(scaled)}${suffix}`;
  }
  return formatAdminMoney(kobo, usd ? "usd" : "ngn", rate);
}

function trim(n: number): string {
  const fixed = n >= 100 ? n.toFixed(0) : n.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

/** "₦1,450" / "₦1,450.5" — naira per $1, as the rate is quoted. */
export function formatRate(mid: number): string {
  return `${NAIRA_SIGN}${mid.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** "At ₦1,450/$ (rate set Jul 25)" — the line that sits by dollar amounts. */
export function describeRate(fx: Pick<FxQuote, "mid" | "asOf">): string {
  const ms = Date.parse(fx.asOf);
  const when = Number.isNaN(ms)
    ? ""
    : ` (rate set ${new Date(ms).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })})`;
  return `At ${formatRate(fx.mid)}/$${when}`;
}

/* ------------------------------------------------------------------ */
/* The hook                                                             */
/* ------------------------------------------------------------------ */

export interface AdminMoney {
  /** What amounts are shown in — "usd" only when a rate is available. */
  currency: AdminCurrency;
  /** What the viewer picked, which may be "usd" with no rate to honour it. */
  preferred: AdminCurrency;
  setCurrency: (next: AdminCurrency) => void;
  /** Naira per $1 (mid), or null when no rate is set or it hasn't loaded. */
  rate: number | null;
  fx: FxQuote | null;
  fxStatus: AdminFxStatus;
  /** Exact: "₦12,500.75" / "$8.62". */
  format: (kobo: number) => string;
  /** Exact with a sign: "+₦5,800" / "−₦4,200". */
  formatSigned: (kobo: number) => string;
  /** Abbreviated from a thousand: "₦1.2M" / "$8.5K". */
  formatCompact: (kobo: number) => string;
  /**
   * For the big numbers on tiles: exact below a million, abbreviated
   * from there ("₦1,250,000" would overflow a phone-width tile).
   */
  formatHeadline: (kobo: number, opts?: { signed?: boolean }) => string;
}

export function useAdminMoney(): AdminMoney {
  const preferred = useLocalPref(currencyPref);
  const { fx, status } = useAdminFx();
  const rate = fx && Number.isFinite(fx.mid) && fx.mid > 0 ? fx.mid : null;
  const currency: AdminCurrency = preferred === "usd" && rate !== null ? "usd" : "ngn";

  return useMemo<AdminMoney>(() => {
    const format = (kobo: number) => formatAdminMoney(kobo, currency, rate);
    const formatSigned = (kobo: number) => formatAdminMoneySigned(kobo, currency, rate);
    return {
      currency,
      preferred,
      setCurrency: setAdminCurrency,
      rate,
      fx,
      fxStatus: status,
      format,
      formatSigned,
      formatCompact: (kobo) => formatAdminMoneyCompact(kobo, currency, rate),
      formatHeadline: (kobo, opts) => {
        const big = Math.abs(toUnits(kobo, currency, rate)) >= 1e6;
        if (!big) return opts?.signed ? formatSigned(kobo) : format(kobo);
        const compact = formatAdminMoneyCompact(kobo, currency, rate, 1e6);
        return opts?.signed && kobo > 0 ? `+${compact}` : compact;
      },
    };
  }, [currency, preferred, rate, fx, status]);
}
