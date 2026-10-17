import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { BookSettingsDoc, SettingsChange } from "./models.js";

/**
 * The book's pricing and limits, set from the admin desk at runtime.
 *
 * Each value starts at its env default (config.ts) and an admin can
 * override it; the override lives in one BookSettings row and every
 * change is logged field by field in SettingsChange. Everything that
 * prices or limits a trade reads from here — the trade route, FX, the
 * international pricing, the public /markets/pricing feed — so a change
 * reaches all of them together.
 *
 * Reads are cached briefly per process (CACHE_MS) so the trade route
 * doesn't add a query per order; a write clears this process's cache at
 * once and every other instance picks it up within CACHE_MS.
 *
 * International trading ships OFF: it turns on only when an admin
 * switches it on, after the API is deployed and its Polymarket smoke
 * test has passed. With it off, the trade route refuses Polymarket
 * markets and the web app keeps them display-only.
 */

export interface BookSettings {
  /** Betting on international (Polymarket) markets is open. */
  internationalTrading: boolean;
  /** Basis points of a ₦100 share added to Polymarket's price, each side. */
  polymarketSpreadBps: number;
  /** Basis points taken on USD ⇄ NGN conversion, each direction. */
  fxSpreadBps: number;
  minStakeKobo: number;
  maxStakeKobo: number;
  /** House exposure (payouts beyond stakes) allowed per market. */
  maxMarketExposureKobo: number;
  /** How far a price may move before the order needs re-confirming. */
  priceToleranceKobo: number;
  /** No new trades this close to a countdown market's close. */
  countdownCutoffSeconds: number;
}

export type SettingKey = keyof BookSettings;
type NumericKey = Exclude<SettingKey, "internationalTrading">;

/** Inclusive bounds the desk may set — the API refuses anything outside. */
export const SETTING_LIMITS: Record<NumericKey, { min: number; max: number }> = {
  polymarketSpreadBps: { min: 0, max: 2_000 },
  fxSpreadBps: { min: 0, max: 2_000 },
  minStakeKobo: { min: 10_000, max: 100_000_000 }, // ₦100 – ₦1M
  maxStakeKobo: { min: 10_000, max: 1_000_000_000 }, // ₦100 – ₦10M
  maxMarketExposureKobo: { min: 100_000, max: 100_000_000_000 }, // ₦1,000 – ₦1B
  priceToleranceKobo: { min: 0, max: 2_000 }, // ₦0 – ₦20
  countdownCutoffSeconds: { min: 0, max: 3_600 },
};

export const SETTING_KEYS: readonly SettingKey[] = [
  "internationalTrading",
  "polymarketSpreadBps",
  "fxSpreadBps",
  "minStakeKobo",
  "maxStakeKobo",
  "maxMarketExposureKobo",
  "priceToleranceKobo",
  "countdownCutoffSeconds",
];

/** ₦100 floor: Bayse's own minimum, and the trade schema's. */
const MIN_STAKE_FLOOR_KOBO = 10_000;

/** What a fresh database runs on: the env, international trading off. */
export function defaultSettings(): BookSettings {
  return {
    internationalTrading: false,
    polymarketSpreadBps: config.POLYMARKET_SPREAD_BPS,
    fxSpreadBps: config.FX_SPREAD_BPS,
    minStakeKobo: MIN_STAKE_FLOOR_KOBO,
    maxStakeKobo: config.TRADE_MAX_STAKE_KOBO,
    maxMarketExposureKobo: config.TRADE_MAX_MARKET_EXPOSURE_KOBO,
    priceToleranceKobo: 200, // ₦2 per ₦100 share
    countdownCutoffSeconds: config.TRADE_COUNTDOWN_CUTOFF_SECONDS,
  };
}

const ROW_KEY = "book";
const CACHE_MS = 10_000;
let cache: { value: BookSettings; at: number } | null = null;

function merge(row: Partial<Record<SettingKey, unknown>> | null): BookSettings {
  const out = defaultSettings();
  if (!row) return out;
  for (const key of SETTING_KEYS) {
    const v = row[key];
    if (key === "internationalTrading") {
      if (typeof v === "boolean") out.internationalTrading = v;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      out[key] = v;
    }
  }
  return out;
}

/** The settings every trade and price reads — cached for CACHE_MS. */
export async function getBookSettings(): Promise<BookSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const row = await BookSettingsDoc.findOne({ key: ROW_KEY }).lean();
  const value = merge(row as Partial<Record<SettingKey, unknown>> | null);
  cache = { value, at: Date.now() };
  return value;
}

/** Drop this process's cached copy (tests, and right after a write). */
export function clearSettingsCache(): void {
  cache = null;
}

export interface SettingsChangeRecord {
  field: SettingKey;
  from: number | boolean;
  to: number | boolean;
  by: string;
  at: string;
}

export interface SettingsView {
  settings: BookSettings;
  defaults: BookSettings;
  limits: typeof SETTING_LIMITS;
  updatedAt: string | null;
  updatedBy: string | null;
  history: SettingsChangeRecord[];
}

const HISTORY_LIMIT = 30;

/** Everything the desk's Settings page shows. */
export async function getSettingsView(): Promise<SettingsView> {
  clearSettingsCache(); // the desk always sees what's stored right now
  const [settings, row, changes] = await Promise.all([
    getBookSettings(),
    BookSettingsDoc.findOne({ key: ROW_KEY }).lean(),
    SettingsChange.find().sort({ createdAt: -1 }).limit(HISTORY_LIMIT).lean(),
  ]);
  return {
    settings,
    defaults: defaultSettings(),
    limits: SETTING_LIMITS,
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    updatedBy: row?.updatedBy ?? null,
    history: changes.map((c) => ({
      field: c.field as SettingKey,
      from: c.from as number | boolean,
      to: c.to as number | boolean,
      by: c.by,
      at: new Date(c.createdAt).toISOString(),
    })),
  };
}

function invalid(message: string): never {
  throw new ApiError(400, message, "INVALID_SETTINGS");
}

/**
 * Apply an admin's edit. Only the keys present change; each is checked
 * against SETTING_LIMITS and the result against the cross-field rule
 * (min stake ≤ max stake) before anything is written. Unchanged values
 * are skipped, so the log only records real moves.
 */
export async function updateBookSettings(
  patch: { [K in SettingKey]?: BookSettings[K] | undefined },
  by: string,
): Promise<SettingsView> {
  clearSettingsCache(); // validate against what's stored, not a cached copy
  const current = await getBookSettings();
  const next: BookSettings = { ...current };

  for (const key of SETTING_KEYS) {
    const v = patch[key];
    if (v === undefined) continue;
    if (key === "internationalTrading") {
      if (typeof v !== "boolean") invalid("International trading must be on or off");
      next.internationalTrading = v;
      continue;
    }
    const { min, max } = SETTING_LIMITS[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
      invalid(`${key} must be a whole number from ${min} to ${max}`);
    }
    next[key] = v;
  }

  if (next.minStakeKobo > next.maxStakeKobo) {
    invalid("The minimum stake can't be above the maximum stake");
  }

  const changed = SETTING_KEYS.filter((k) => next[k] !== current[k]);
  if (changed.length > 0) {
    const set: Record<string, unknown> = { updatedBy: by };
    for (const k of changed) set[k] = next[k];
    await BookSettingsDoc.updateOne({ key: ROW_KEY }, { $set: set }, { upsert: true });
    await SettingsChange.insertMany(
      changed.map((field) => ({ field, from: current[field], to: next[field], by })),
    );
  }

  clearSettingsCache();
  return getSettingsView();
}
