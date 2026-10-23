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
  /**
   * Basis points added to Bayse's price on Local markets — the house's
   * margin. Our own markets are desk-priced (their margin is in the
   * prices) and get none.
   */
  localSpreadBps: number;
  /**
   * The auto-adjusting spread (trading/margin.ts): the side of a market
   * the house stands to lose on rises 1 point for every this much at
   * risk, with no cap. 0 turns it off.
   */
  autoSpreadStepKobo: number;
  /**
   * The highest price we sell a share at, kobo per ₦100 share; 0 = no
   * limit. A side quoted above it is almost decided — bought late by
   * people who already know the answer (the 15-minute crypto rounds, the
   * "number of X posts today" counts) — so it isn't on sale.
   */
  maxQuoteKobo: number;
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
  /**
   * Email the admins when the whole book's worst case reaches this loss
   * (trading/risk-alerts.ts). 0 turns that alert off; the per-market
   * near-limit alerts run regardless.
   */
  lossAlertKobo: number;
  /**
   * Paused topics ("bitcoin", "btc"): a market whose event title or slug
   * or market title contains one as a whole word takes no bets and is
   * hidden on the site, and the desk can void its open bets in one go
   * (trading/paused.ts). Lowercase, deduplicated; empty = nothing paused.
   */
  pausedTopics: string[];
  /**
   * The most one customer can stake on one market, all their bets on it
   * together; 0 = no cap. Stops stacking bet after bet on one result —
   * 41 bets of ₦50,000 on one count market was how that money went.
   */
  maxStakePerMarketKobo: number;
  /**
   * Markets whose result shows itself before they close — a count of
   * posts or likes anyone can watch — stop taking bets this many hours
   * before their closing time; 0 = off. Which markets: earlyCloseTopics,
   * matched like paused topics.
   */
  earlyCloseHours: number;
  earlyCloseTopics: string[];
  /**
   * The most the house may stand to lose if every open market went
   * against it at once — the risk desk's worst case. A bet that would push
   * it past this is refused; one that doesn't add to it (the other side)
   * always goes through (trading/book-limit.ts). 0 = no limit.
   */
  maxBookLossKobo: number;
  /**
   * A customer's withdrawals to dollars over the last 24 hours reaching
   * this much wait for an admin's approval (trading/withdrawals.ts);
   * 0 = off. So does any withdrawal by an account Abuse watch has
   * flagged, whatever its size.
   */
  withdrawalReviewKobo: number;
}

export type SettingKey = keyof BookSettings;
/** The settings that are lists of topics, edited on their own cards. */
type TopicKey = "pausedTopics" | "earlyCloseTopics";
const isTopicKey = (key: SettingKey): key is TopicKey =>
  key === "pausedTopics" || key === "earlyCloseTopics";
type NumericKey = Exclude<SettingKey, "internationalTrading" | TopicKey>;

/** At most this many paused topics, each 2–40 characters. */
const MAX_PAUSED_TOPICS = 20;
const TOPIC = /^[a-z0-9][a-z0-9 .-]{1,39}$/;

/** A usable topic, once normalized: 2–40 letters, numbers, spaces, dots or dashes. */
export const isUsableTopic = (topic: string): boolean => TOPIC.test(topic);

/** Trimmed, lowercased, deduplicated, empties dropped. */
export function normalizeTopics(topics: readonly string[]): string[] {
  return [...new Set(topics.map((t) => t.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean))];
}

/** Inclusive bounds the desk may set — the API refuses anything outside. */
export const SETTING_LIMITS: Record<NumericKey, { min: number; max: number }> = {
  polymarketSpreadBps: { min: 0, max: 2_000 },
  localSpreadBps: { min: 0, max: 2_000 },
  autoSpreadStepKobo: { min: 0, max: 100_000_000_000 }, // 0 (off), else ₦1,000 – ₦1B
  maxQuoteKobo: { min: 0, max: 9_900 }, // 0 (off), else ₦50 – ₦99
  fxSpreadBps: { min: 0, max: 2_000 },
  minStakeKobo: { min: 10_000, max: 100_000_000 }, // ₦100 – ₦1M
  maxStakeKobo: { min: 10_000, max: 1_000_000_000 }, // ₦100 – ₦10M
  maxMarketExposureKobo: { min: 100_000, max: 100_000_000_000 }, // ₦1,000 – ₦1B
  priceToleranceKobo: { min: 0, max: 2_000 }, // ₦0 – ₦20
  countdownCutoffSeconds: { min: 0, max: 3_600 },
  lossAlertKobo: { min: 0, max: 100_000_000_000 }, // ₦0 (off) – ₦1B
  maxStakePerMarketKobo: { min: 0, max: 10_000_000_000 }, // ₦0 (off) – ₦100M
  earlyCloseHours: { min: 0, max: 72 },
  withdrawalReviewKobo: { min: 0, max: 10_000_000_000 }, // ₦0 (off) – ₦100M
  maxBookLossKobo: { min: 0, max: 100_000_000_000 }, // ₦0 (off) – ₦1B
};

export const SETTING_KEYS: readonly SettingKey[] = [
  "internationalTrading",
  "polymarketSpreadBps",
  "localSpreadBps",
  "autoSpreadStepKobo",
  "maxQuoteKobo",
  "fxSpreadBps",
  "minStakeKobo",
  "maxStakeKobo",
  "maxMarketExposureKobo",
  "priceToleranceKobo",
  "countdownCutoffSeconds",
  "lossAlertKobo",
  "pausedTopics",
  "maxStakePerMarketKobo",
  "earlyCloseHours",
  "earlyCloseTopics",
  "withdrawalReviewKobo",
  "maxBookLossKobo",
];

/**
 * Smallest auto-adjust step that isn't 0 (off): below ₦1,000 a point, a
 * couple of bets would put a side at the ceiling.
 */
const MIN_AUTO_SPREAD_STEP_KOBO = 100_000;

/** ₦100 floor: Bayse's own minimum, and the trade schema's. */
const MIN_STAKE_FLOOR_KOBO = 10_000;

/** What a fresh database runs on: the env, international trading off. */
export function defaultSettings(): BookSettings {
  return {
    internationalTrading: false,
    polymarketSpreadBps: config.POLYMARKET_SPREAD_BPS,
    localSpreadBps: 200, // 2 points on Bayse's price
    autoSpreadStepKobo: 4_000_000, // +1 point per ₦40,000 at risk on the exposed side
    maxQuoteKobo: 9_000, // nothing sold above ₦90 a share
    fxSpreadBps: config.FX_SPREAD_BPS,
    minStakeKobo: MIN_STAKE_FLOOR_KOBO,
    maxStakeKobo: config.TRADE_MAX_STAKE_KOBO,
    maxMarketExposureKobo: config.TRADE_MAX_MARKET_EXPOSURE_KOBO,
    priceToleranceKobo: 200, // ₦2 per ₦100 share
    countdownCutoffSeconds: config.TRADE_COUNTDOWN_CUTOFF_SECONDS,
    lossAlertKobo: 100_000_000, // ₦1,000,000
    // the October 2026 Bitcoin pause, in force from the first deploy;
    // the desk lifts it by clearing the topics in Settings
    pausedTopics: ["bitcoin", "btc"],
    maxStakePerMarketKobo: 20_000_000, // ₦200,000: four full bets on one market
    earlyCloseHours: 3,
    // "Pop Base's Number of X Posts by 1PM Today?", "How many likes for…"
    earlyCloseTopics: ["x posts", "likes"],
    withdrawalReviewKobo: 10_000_000, // ₦100,000 a day
    maxBookLossKobo: 200_000_000, // ₦2,000,000 — twice the loss alert line
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
    } else if (key === "pausedTopics" || key === "earlyCloseTopics") {
      if (Array.isArray(v) && v.every((t) => typeof t === "string")) {
        out[key] = normalizeTopics(v);
      }
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
  from: number | boolean | string[];
  to: number | boolean | string[];
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
      from: c.from as number | boolean | string[],
      to: c.to as number | boolean | string[],
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
 * (min stake ≤ max stake; an auto-adjust step of 0 or ≥ ₦1,000) before anything is written. Unchanged values
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
    if (isTopicKey(key)) {
      if (!Array.isArray(v) || !v.every((t) => typeof t === "string")) {
        invalid("Topics must be a list of words");
      }
      const topics = normalizeTopics(v);
      if (topics.length > MAX_PAUSED_TOPICS) invalid(`At most ${MAX_PAUSED_TOPICS} topics`);
      const bad = topics.find((t) => !TOPIC.test(t));
      if (bad !== undefined) {
        invalid(`"${bad}" isn't a usable topic — 2 to 40 letters, numbers, spaces, dots or dashes`);
      }
      next[key] = topics;
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
  if (next.maxQuoteKobo > 0 && next.maxQuoteKobo < 5_000) {
    invalid("The highest price we sell must be 0 (no limit) or at least ₦50");
  }
  if (next.autoSpreadStepKobo > 0 && next.autoSpreadStepKobo < MIN_AUTO_SPREAD_STEP_KOBO) {
    invalid("The auto-adjust amount must be 0 (off) or at least ₦1,000");
  }
  if (next.maxBookLossKobo > 0 && next.maxBookLossKobo < 1_000_000) {
    invalid("The maximum total loss must be 0 (no limit) or at least ₦10,000");
  }
  if (next.maxStakePerMarketKobo > 0 && next.maxStakePerMarketKobo < next.minStakeKobo) {
    invalid("The most per customer per market must be 0 (no cap) or at least the minimum stake");
  }

  const changed = SETTING_KEYS.filter(
    (k) => JSON.stringify(next[k]) !== JSON.stringify(current[k]),
  );
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
