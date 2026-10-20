"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  ExclamationTriangleIcon as AlertTriangle,
  SignalSlashIcon as CloudOff,
  InformationCircleIcon as Info,
  ArrowPathIcon as Loader2,
  MinusIcon as Minus,
  PlusIcon as Plus,
  ArrowPathIcon as RefreshCw,
} from "@heroicons/react/24/outline";
import { CREDIT, formatNaira } from "@/lib/format";
import { isApiConfigured } from "@/lib/api-client";
import { showToast } from "@/lib/toast-store";
import { PausedMarketsCard } from "@/components/admin/paused-markets";
import {
  fetchBookSettings,
  updateBookSettings,
  useAdminResource,
  type BookSettingChange,
  type BookSettingKey,
  type BookSettings,
  type BookSettingsState,
  type NumericBookSettingKey,
  type SettingLimit,
} from "@/lib/admin-api";
import {
  FLAG_LEVEL,
  FLAG_TONE,
  FlagChip,
  settingRisks,
  worstLevel,
  type SettingRisk,
} from "@/components/admin/risk-flags";

/**
 * The book's dials: spreads (international, Local, conversion and the
 * auto-adjusting one), stake limits, the per-market loss cap and the
 * international on/off switch.
 *
 * Written for whoever runs the business, not whoever wrote the API: the
 * API stores basis points, kobo and seconds, and this page only ever
 * shows points, % and credit. Every row carries an (i) that says in
 * plain words what the dial does, and the values are checked as they're
 * typed — against the API's own limits, and against the risk rules in
 * risk-flags.tsx.
 *
 * Nothing is sent until Save, and Save asks first, listing each change
 * in the same friendly units. Only the changed keys go to the API.
 */

/* ---------- what each setting is, in friendly units ---------- */

type Unit = "points" | "percent" | "credit" | "seconds";

/** API units per unit on screen, and the decimals that leaves room for. */
const UNIT: Record<Unit, { scale: number; decimals: number }> = {
  points: { scale: 100, decimals: 2 },
  percent: { scale: 100, decimals: 2 },
  credit: { scale: 100, decimals: 2 },
  seconds: { scale: 1, decimals: 0 },
};

interface NumberField {
  key: NumericBookSettingKey;
  label: string;
  unit: Unit;
  /** One press of − / + (or an arrow key), in friendly units. */
  step: number;
  info: string;
}

const INTL_LABEL = "International trading";
const INTL_INFO =
  "Turns betting on international (Polymarket) markets on or off. When it's off, those markets can still be viewed but not bet on. Only switch it on once the new API is deployed and tested. Takes about a minute to show on the site.";

const FIELDS: Record<NumericBookSettingKey, NumberField> = {
  polymarketSpreadBps: {
    key: "polymarketSpreadBps",
    label: "International spread",
    unit: "points",
    step: 0.5,
    info: "What we add to Polymarket's price on every international bet — the house's margin. At 3 points, an outcome Polymarket rates 60% costs ₦63 instead of ₦60, and a winning share still pays ₦100. Higher means more profit per bet but worse prices for users.",
  },
  localSpreadBps: {
    key: "localSpreadBps",
    label: "Local spread",
    unit: "points",
    step: 0.5,
    info: "What we add to Bayse's price on every Local bet — the house's margin. At 2 points, an outcome Bayse rates 60% costs ₦62 instead of ₦60, and a winning share still pays ₦100. Our own markets aren't affected — their prices are set at the desk.",
  },
  autoSpreadStepKobo: {
    key: "autoSpreadStepKobo",
    label: "Auto-adjust: +1 point for every",
    unit: "credit",
    step: 5_000,
    info: "When most of a market's money is on one side — so we'd lose if that side wins — that side's price goes up 1 point for every this much we'd lose. At ₦40,000: ₦200,000 at risk is +5 points, ₦1,000,000 is +25. There's no top limit — the price keeps rising with the bets, up to ₦99 — and Maximum loss per market still stops new bets. The other side stays at the normal price. A smaller amount makes prices rise faster. Set to 0 to switch auto-adjusting off.",
  },
  fxSpreadBps: {
    key: "fxSpreadBps",
    label: "Conversion spread",
    unit: "percent",
    step: 0.1,
    info: "Our margin when users convert dollars to naira credit, and back. At 1%, a $10 deposit at ₦1,500/$ gives ₦14,850 instead of ₦15,000. It applies both ways, so converting and converting back costs about 2%.",
  },
  minStakeKobo: {
    key: "minStakeKobo",
    label: "Minimum stake",
    unit: "credit",
    step: 100,
    info: "The smallest bet anyone can place. It can't go below ₦100.",
  },
  maxStakeKobo: {
    key: "maxStakeKobo",
    label: "Maximum stake per bet",
    unit: "credit",
    step: 10_000,
    info: "The largest single bet allowed. Someone can still place several bets in a row — use Maximum loss per market to cap the total.",
  },
  maxMarketExposureKobo: {
    key: "maxMarketExposureKobo",
    label: "Maximum loss per market",
    unit: "credit",
    step: 100_000,
    info: 'The most WorldStreet can lose on one market. We add up what every open bet on that market could win beyond its stake; if a new bet would push that past this amount, it\'s refused with "This market has reached its trading limit for now".',
  },
  priceToleranceKobo: {
    key: "priceToleranceKobo",
    label: "Price-move tolerance",
    unit: "credit",
    step: 0.5,
    info: "How far a price may move between a user seeing it and placing the bet before we ask them to confirm the new price. At ₦2, a ₦63 price that becomes ₦64 goes through; if it becomes ₦66 the user is asked to confirm.",
  },
  countdownCutoffSeconds: {
    key: "countdownCutoffSeconds",
    label: "Closing cut-off",
    unit: "seconds",
    step: 5,
    info: "For short countdown markets (like 15-minute crypto), betting stops this many seconds before the close, so nobody can bet when the result is almost certain.",
  },
  lossAlertKobo: {
    key: "lossAlertKobo",
    label: "Book loss alert",
    unit: "credit",
    step: 100_000,
    info: "Admins get an alert email when the most we could lose across all open bets reaches this amount. Separately, they're always alerted when any one market reaches 70% and 90% of its Maximum loss per market. Set it to 0 to switch this alert off. Alerts only ever go to admins, never to users.",
  },
};

/** Page order — the groups below, flattened. */
/** The settings this form edits — all but the paused topics, which have their own card. */
type FormKey = Exclude<BookSettingKey, "pausedTopics">;

const ORDER: FormKey[] = [
  "internationalTrading",
  "polymarketSpreadBps",
  "localSpreadBps",
  "fxSpreadBps",
  "autoSpreadStepKobo",
  "minStakeKobo",
  "maxStakeKobo",
  "maxMarketExposureKobo",
  "priceToleranceKobo",
  "countdownCutoffSeconds",
  "lossAlertKobo",
];

const NUMERIC_KEYS = ORDER.filter(isNumericKey);

const GROUPS: { title: string; note: string; rows: FormKey[] }[] = [
  {
    title: "International markets",
    note: "Polymarket markets, priced off Polymarket plus our margin.",
    rows: ["internationalTrading", "polymarketSpreadBps"],
  },
  {
    title: "Pricing",
    note: "Our margins on Local bets and on converting dollars to credit.",
    rows: ["localSpreadBps", "fxSpreadBps"],
  },
  {
    title: "Auto-adjusting spread",
    note: "Raises the price on whichever side of a market most money is on — more as the bets grow — so new bets are pushed to the other side.",
    rows: ["autoSpreadStepKobo"],
  },
  {
    title: "Limits",
    note: "How much one bet, and one market, can put at stake.",
    rows: ["minStakeKobo", "maxStakeKobo", "maxMarketExposureKobo"],
  },
  {
    title: "Safety",
    note: "Guards against stale prices and last-second bets.",
    rows: ["priceToleranceKobo", "countdownCutoffSeconds"],
  },
  {
    title: "Alerts",
    note: "When admins are emailed about the risk of a loss — never users.",
    rows: ["lossAlertKobo"],
  },
];

function isNumericKey(key: string): key is NumericBookSettingKey {
  return key in FIELDS;
}

function labelOf(key: string): string {
  if (key === "internationalTrading") return INTL_LABEL;
  if (key === "pausedTopics") return "Paused topics";
  return isNumericKey(key) ? FIELDS[key].label : key;
}

/**
 * The explainers were written in naira; every amount the app renders
 * goes through the one credit mark (lib/format.ts), so these do too.
 */
function withCredit(text: string): string {
  return text.split("₦").join(CREDIT);
}

/* ---------- unit conversion and formatting ---------- */

function fmtNumber(n: number, decimals: number, grouped: boolean): string {
  return n.toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    useGrouping: grouped,
  });
}

/** API value → the friendly number, e.g. 350 bps → "3.5". */
function friendly(key: NumericBookSettingKey, value: number, grouped = true): string {
  const { scale, decimals } = UNIT[FIELDS[key].unit];
  return fmtNumber(value / scale, decimals, grouped);
}

function unitWord(key: NumericBookSettingKey, value: number): string {
  const unit = FIELDS[key].unit;
  const one = value / UNIT[unit].scale === 1;
  if (unit === "points") return one ? "point" : "points";
  if (unit === "seconds") return one ? "second" : "seconds";
  return "";
}

function onOff(v: number | boolean | string[]): string {
  if (Array.isArray(v)) return v.length > 0 ? v.join(", ") : "None";
  return typeof v === "boolean" ? (v ? "On" : "Off") : String(v);
}

/** One value in friendly units: "3 points", "1%", "₩100", "60 seconds", "On". */
function formatValue(key: string, value: number | boolean | string[]): string {
  if (typeof value !== "number" || !isNumericKey(key)) return onOff(value);
  switch (FIELDS[key].unit) {
    case "credit":
      return formatNaira(value);
    case "percent":
      return `${friendly(key, value)}%`;
    default:
      return `${friendly(key, value)} ${unitWord(key, value)}`;
  }
}

/**
 * Two values with the unit said once where that reads naturally:
 * "3 → 4 points", "1% → 1.5%", "₩100 → ₩200", "Off → On".
 */
function formatPair(
  key: string,
  a: number | boolean | string[],
  b: number | boolean | string[],
  sep: string,
): string {
  if (typeof a !== "number" || typeof b !== "number" || !isNumericKey(key)) {
    return `${onOff(a)}${sep}${onOff(b)}`;
  }
  switch (FIELDS[key].unit) {
    case "credit":
      return `${formatNaira(a)}${sep}${formatNaira(b)}`;
    case "percent":
      return `${friendly(key, a)}%${sep}${friendly(key, b)}%`;
    default:
      return `${friendly(key, a)}${sep}${friendly(key, b)} ${unitWord(key, b)}`;
  }
}

/** API value → the input's text (no thousands separators). */
function toInput(key: NumericBookSettingKey, value: number): string {
  return friendly(key, value, false);
}

type Parsed = { ok: true; value: number } | { ok: false; message: string };

function parseField(
  key: NumericBookSettingKey,
  text: string,
  limit: SettingLimit | undefined,
): Parsed {
  const { scale, decimals } = UNIT[FIELDS[key].unit];
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, message: "Enter a value." };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, message: "Enter a number." };
  // the API stores whole basis points / kobo / seconds
  const raw = n * scale;
  const value = Math.round(raw);
  if (Math.abs(raw - value) > 1e-6) {
    return {
      ok: false,
      message:
        decimals === 0
          ? "Use a whole number of seconds."
          : `Use at most ${decimals} decimal places.`,
    };
  }
  if (limit && (value < limit.min || value > limit.max)) {
    return {
      ok: false,
      message: `Must be between ${formatPair(key, limit.min, limit.max, " and ")}.`,
    };
  }
  return { ok: true, value };
}

function fmtWhen(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/* ---------- the form, derived from saved values + local edits ---------- */

type Edits = { [K in NumericBookSettingKey]?: string } & {
  internationalTrading?: boolean;
};

interface Change {
  key: FormKey;
  from: number | boolean;
  to: number | boolean;
}

interface Form {
  texts: Record<NumericBookSettingKey, string>;
  /** Every field that parses — what the risk rules judge. */
  values: Partial<BookSettings>;
  errors: Partial<Record<NumericBookSettingKey, string>>;
  /** Valid fields that differ from what's saved, in page order. */
  changes: Change[];
  /** Anything differs from what's saved, valid or not. */
  dirty: boolean;
}

function buildForm(state: BookSettingsState, edits: Edits): Form {
  const { settings, limits } = state;
  const texts = {} as Record<NumericBookSettingKey, string>;
  const values: Partial<BookSettings> = {
    internationalTrading: edits.internationalTrading ?? settings.internationalTrading,
  };
  const errors: Form["errors"] = {};

  for (const key of NUMERIC_KEYS) {
    // an API older than this page doesn't send every setting — leave the
    // missing ones out rather than marking them invalid
    if (settings[key] === undefined) continue;
    const text = edits[key] ?? toInput(key, settings[key]);
    texts[key] = text;
    const parsed = parseField(key, text, limits[key]);
    if (parsed.ok) values[key] = parsed.value;
    else errors[key] = parsed.message;
  }

  // The API refuses a minimum above the maximum; say so on whichever
  // of the two the admin is editing.
  const { minStakeKobo: min, maxStakeKobo: max } = values;
  if (min !== undefined && max !== undefined && min > max) {
    if (edits.maxStakeKobo !== undefined && edits.minStakeKobo === undefined) {
      errors.maxStakeKobo = `Can't be less than the minimum stake (${formatNaira(min)}).`;
    } else {
      errors.minStakeKobo = `Can't be more than the maximum stake per bet (${formatNaira(max)}).`;
    }
  }

  const changes: Change[] = [];
  let dirty = false;
  for (const key of ORDER) {
    const to = values[key];
    const from = settings[key];
    if (from === undefined) continue; // not on this API (see above)
    if (to === undefined) {
      dirty = true;
      continue;
    }
    if (to !== from) {
      dirty = true;
      if (!(isNumericKey(key) && errors[key])) changes.push({ key, from, to });
    }
  }

  return { texts, values, errors, changes, dirty };
}

function risksFor(risks: SettingRisk[], key: BookSettingKey): SettingRisk[] {
  return risks.filter((r) => r.field === key);
}

/** Flagged fields in page order. */
function flaggedKeys(risks: SettingRisk[]): BookSettingKey[] {
  return ORDER.filter((key) => risks.some((r) => r.field === key));
}

function focusSetting(key: BookSettingKey) {
  const el = document.getElementById(`setting-${key}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.focus({ preventScroll: true });
}

/* ---------- the desk ---------- */

export function SettingsDesk() {
  const resource = useAdminResource(fetchBookSettings, true);
  // A save answers with the new state; it stands until the resource
  // itself re-reads (Refresh), which hands back a new object.
  const [saved, setSaved] = useState<{
    state: BookSettingsState;
    over: BookSettingsState | null;
  } | null>(null);
  const state =
    saved && saved.over === resource.data ? saved.state : resource.data;

  if (!isApiConfigured()) {
    return (
      <Notice>
        This desk needs the prediction API. Set{" "}
        <code className="font-mono text-[13px]">NEXT_PUBLIC_API_URL</code> and
        rebuild.
      </Notice>
    );
  }

  // 403 means a signed-in non-admin, not a broken page.
  if (resource.errorCode === "FORBIDDEN") {
    return (
      <Notice>
        Your account isn&rsquo;t an admin of the Local book. Ask for the{" "}
        <code className="font-mono text-[13px]">admin</code> role on your
        central WorldStreet account.
      </Notice>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-secondary">
            How the book prices and limits bets. Changes apply within about a
            minute.
          </p>
          {state && (
            <p className="mt-1 break-words text-[13px] font-medium text-tertiary">
              {state.updatedAt
                ? `Last changed ${fmtWhen(state.updatedAt)}${
                    state.updatedBy ? ` by ${state.updatedBy}` : ""
                  }`
                : "Never changed — every value is the default."}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={resource.refresh}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
        >
          <RefreshCw
            className={`size-3.5 ${resource.loading ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {state ? (
        <>
          {resource.error && (
            <p className="mt-3 text-sm font-semibold text-no">
              Couldn&rsquo;t refresh: {resource.error}
            </p>
          )}
          {/* an older API publishes no topics: nothing to show */}
          {Array.isArray(state.settings.pausedTopics) && (
            <PausedMarketsCard
              state={state}
              onSaved={(next) => setSaved({ state: next, over: resource.data })}
            />
          )}
          <SettingsForm
            state={state}
            onSaved={(next) => setSaved({ state: next, over: resource.data })}
          />
          <History history={state.history} />
        </>
      ) : resource.error ? (
        <LoadError
          code={resource.errorCode}
          message={resource.error}
          onRetry={resource.refresh}
        />
      ) : (
        <SettingsSkeleton />
      )}
    </div>
  );
}

function SettingsForm({
  state,
  onSaved,
}: {
  state: BookSettingsState;
  onSaved: (next: BookSettingsState) => void;
}) {
  const [edits, setEdits] = useState<Edits>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const form = buildForm(state, edits);
  const risks = settingRisks(form.values);
  const invalidCount = Object.keys(form.errors).length;
  const canSave = form.changes.length > 0 && invalidCount === 0;

  const setText = (key: NumericBookSettingKey, text: string) =>
    setEdits((e) => ({ ...e, [key]: text }));

  const step = (key: NumericBookSettingKey, dir: 1 | -1) => {
    const field = FIELDS[key];
    const unitStep = Math.round(field.step * UNIT[field.unit].scale);
    const current = form.values[key] ?? state.settings[key];
    // snap to the step grid first, so 3.3 + 0.5 is 3.5, not 3.8
    let next =
      dir > 0
        ? Math.floor(current / unitStep) * unitStep + unitStep
        : Math.ceil(current / unitStep) * unitStep - unitStep;
    const limit = state.limits[key];
    next = Math.max(next, limit?.min ?? 0);
    if (limit) next = Math.min(next, limit.max);
    setText(key, toInput(key, next));
  };

  const reset = (key: FormKey) => {
    if (key === "internationalTrading") {
      setEdits((e) => ({
        ...e,
        internationalTrading: state.defaults.internationalTrading,
      }));
    } else {
      setText(key, toInput(key, state.defaults[key]));
    }
  };

  const save = async () => {
    if (pending || !canSave) return;
    const patch: Partial<BookSettings> = {};
    for (const c of form.changes) {
      Object.assign(patch, { [c.key]: c.to });
    }
    setPending(true);
    setSaveError(null);
    try {
      const next = await updateBookSettings(patch);
      onSaved(next);
      setEdits({});
      setConfirming(false);
      showToast("Settings saved — live within about a minute", "success");
    } catch (err) {
      setSaveError(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't save the settings. Try again.",
      );
    } finally {
      setPending(false);
    }
  };

  const rowProps = (key: FormKey) => ({
    risks: risksFor(risks, key),
    atDefault: form.values[key] === state.defaults[key],
    defaultText: formatValue(key, state.defaults[key]),
    savedText: formatValue(key, state.settings[key]),
    changed:
      form.values[key] === undefined || form.values[key] !== state.settings[key],
    onReset: () => reset(key),
  });

  return (
    <>
      {risks.length > 0 && <RiskBanner risks={risks} dirty={form.dirty} />}

      <div className="mt-6 flex flex-col gap-4">
        {GROUPS.map((group) => ({
          ...group,
          rows: group.rows.filter((key) => state.settings[key] !== undefined),
        }))
          .filter((group) => group.rows.length > 0)
          .map((group) => (
          <section
            key={group.title}
            className="rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5"
          >
            <h2 className="text-lg font-semibold">{group.title}</h2>
            <p className="mt-0.5 text-sm text-secondary">{group.note}</p>
            <div className="mt-2 divide-y divide-border">
              {group.rows.map((key) =>
                key === "internationalTrading" ? (
                  <SwitchRow
                    key={key}
                    on={form.values.internationalTrading ?? false}
                    onToggle={() =>
                      setEdits((e) => ({
                        ...e,
                        internationalTrading: !(
                          form.values.internationalTrading ?? false
                        ),
                      }))
                    }
                    {...rowProps(key)}
                  />
                ) : (
                  <NumberRow
                    key={key}
                    field={FIELDS[key]}
                    text={form.texts[key]}
                    error={form.errors[key] ?? null}
                    onText={(text) => setText(key, text)}
                    onStep={(dir) => step(key, dir)}
                    {...rowProps(key)}
                  />
                ),
              )}
            </div>
          </section>
        ))}

        {/* clears the mobile dock below md, as the market page's trade bar does */}
        <div className="sticky bottom-24 z-30 md:bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3 shadow-popover">
          <p className="min-w-0 text-sm font-medium text-secondary">
            {invalidCount > 0 ? (
              <span className="font-semibold text-no">
                Fix {invalidCount === 1 ? "the field" : `${invalidCount} fields`}{" "}
                marked below before saving.
              </span>
            ) : form.changes.length > 0 ? (
              `${form.changes.length} unsaved change${form.changes.length === 1 ? "" : "s"}`
            ) : (
              "No unsaved changes"
            )}
          </p>
          <div className="flex gap-2">
            {form.dirty && (
              <button
                type="button"
                onClick={() => setEdits({})}
                className="h-10 rounded-sm border border-border px-4 text-sm font-semibold text-secondary transition-colors hover:border-border-hover hover:text-primary"
              >
                Discard
              </button>
            )}
            <button
              type="button"
              disabled={!canSave}
              onClick={() => {
                setSaveError(null);
                setConfirming(true);
              }}
              className="pressable flex h-10 items-center rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
            >
              Save changes
            </button>
          </div>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          changes={form.changes}
          risks={risks}
          risksBefore={settingRisks(state.settings)}
          pending={pending}
          error={saveError}
          onCancel={() => {
            if (!pending) setConfirming(false);
          }}
          onConfirm={() => void save()}
        />
      )}
    </>
  );
}

/* ---------- rows ---------- */

interface RowCommon {
  risks: SettingRisk[];
  atDefault: boolean;
  defaultText: string;
  savedText: string;
  changed: boolean;
  onReset: () => void;
}

/** Two columns on a wide screen — what it is | the control — stacked on a phone. */
const ROW =
  "grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 py-4 last:pb-0 sm:grid-cols-[minmax(0,1fr)_17rem]";

function RowMeta({
  risks,
  atDefault,
  defaultText,
  onReset,
}: Pick<RowCommon, "risks" | "atDefault" | "defaultText" | "onReset">) {
  return (
    <>
      <p className="mt-1 text-xs text-tertiary">
        Default: {defaultText}
        {!atDefault && (
          <>
            {" · "}
            <button
              type="button"
              onClick={onReset}
              className="font-semibold text-secondary underline-offset-2 hover:text-primary hover:underline"
            >
              Reset
            </button>
          </>
        )}
      </p>
      {risks.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {risks.map((r) => (
            <li
              key={r.reason}
              className={`flex items-start gap-1.5 text-xs font-medium ${
                FLAG_TONE[FLAG_LEVEL[r.level].tone].text
              }`}
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {r.reason}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function NumberRow({
  field,
  text,
  error,
  onText,
  onStep,
  risks,
  atDefault,
  defaultText,
  savedText,
  changed,
  onReset,
}: RowCommon & {
  field: NumberField;
  text: string;
  error: string | null;
  onText: (text: string) => void;
  onStep: (dir: 1 | -1) => void;
}) {
  const id = `setting-${field.key}`;
  const whole = UNIT[field.unit].decimals === 0;

  return (
    <div className={ROW}>
      <div className="min-w-0">
        <SettingLabel
          htmlFor={id}
          label={field.label}
          info={withCredit(field.info)}
          risks={risks}
        />
        <RowMeta
          risks={risks}
          atDefault={atDefault}
          defaultText={defaultText}
          onReset={onReset}
        />
      </div>

      <div className="min-w-0">
        <div
          className={`flex h-10 min-w-0 items-center gap-1 rounded-md border bg-page pl-3 pr-1 transition-colors focus-within:border-accent ${
            error
              ? "border-no"
              : changed
                ? "border-border-active"
                : "border-border hover:border-border-hover"
          }`}
        >
          {field.unit === "credit" && (
            <span className="text-sm font-semibold text-tertiary">{CREDIT}</span>
          )}
          <input
            id={id}
            inputMode={whole ? "numeric" : "decimal"}
            autoComplete="off"
            value={text}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-note` : undefined}
            onChange={(e) =>
              onText(e.target.value.replace(whole ? /[^0-9]/g : /[^0-9.]/g, "").slice(0, 14))
            }
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                onStep(e.key === "ArrowUp" ? 1 : -1);
              }
            }}
            className="w-full min-w-0 bg-transparent text-sm font-semibold tabular-nums outline-none"
          />
          {field.unit !== "credit" && (
            <span className="shrink-0 text-sm font-medium text-tertiary">
              {field.unit === "percent" ? "%" : field.unit}
            </span>
          )}
          <span className="ml-1 flex shrink-0 items-center">
            <StepButton label={`Decrease ${field.label}`} onClick={() => onStep(-1)}>
              <Minus className="size-3.5" />
            </StepButton>
            <StepButton label={`Increase ${field.label}`} onClick={() => onStep(1)}>
              <Plus className="size-3.5" />
            </StepButton>
          </span>
        </div>
        {error ? (
          <p id={`${id}-note`} className="mt-1.5 text-xs font-semibold text-no">
            {error}
          </p>
        ) : (
          changed && (
            <p className="mt-1.5 text-xs text-tertiary">
              Unsaved · was {savedText}
            </p>
          )
        )}
      </div>
    </div>
  );
}

function StepButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-sm text-secondary transition-colors hover:bg-element-2 hover:text-primary"
    >
      {children}
    </button>
  );
}

function SwitchRow({
  on,
  onToggle,
  risks,
  atDefault,
  defaultText,
  savedText,
  changed,
  onReset,
}: RowCommon & { on: boolean; onToggle: () => void }) {
  const id = "setting-internationalTrading";
  return (
    <div className={ROW}>
      <div className="min-w-0">
        <SettingLabel
          htmlFor={id}
          label={INTL_LABEL}
          info={withCredit(INTL_INFO)}
          risks={risks}
        />
        <RowMeta
          risks={risks}
          atDefault={atDefault}
          defaultText={defaultText}
          onReset={onReset}
        />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:h-10">
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={on}
          onClick={onToggle}
          className={`flex h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${
            on ? "bg-accent" : "bg-element-3"
          }`}
        >
          <span
            className={`size-5 rounded-full transition-transform ${
              on ? "translate-x-5 bg-on-accent" : "bg-primary"
            }`}
          />
        </button>
        <span className="text-sm font-semibold">{on ? "On" : "Off"}</span>
        {changed && (
          <span className="text-xs text-tertiary">Unsaved · was {savedText}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Label, its (i) and its risk chip. The (i) opens on click or tap —
 * never hover-only — and closes on Escape or a press anywhere else.
 * The explainer hangs off the whole label line rather than the icon, so
 * on a phone it spans the row instead of running off the screen.
 */
function SettingLabel({
  htmlFor,
  label,
  info,
  risks,
}: {
  htmlFor: string;
  label: string;
  info: string;
  risks: SettingRisk[];
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popId = useId();
  const level = worstLevel(risks);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !popRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </label>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`grid size-6 shrink-0 place-items-center rounded-full transition-colors hover:bg-element-2 hover:text-primary ${
          open ? "bg-element-2 text-primary" : "text-tertiary"
        }`}
      >
        <Info className="size-4" />
      </button>
      {level && <FlagChip level={level} />}
      {open && (
        <div
          ref={popRef}
          id={popId}
          role="dialog"
          aria-label={`About ${label}`}
          className="absolute left-0 top-full z-40 mt-1.5 w-full max-w-sm rounded-xl border border-border bg-surface p-4 shadow-popover"
        >
          <p className="text-sm font-semibold">{label}</p>
          <p className="mt-1 text-sm leading-5 text-secondary">{info}</p>
        </div>
      )}
    </div>
  );
}

/* ---------- flags ---------- */

function RiskBanner({ risks, dirty }: { risks: SettingRisk[]; dirty: boolean }) {
  const keys = flaggedKeys(risks);
  const danger = risks.some((r) => FLAG_LEVEL[r.level].tone === "danger");
  const tone = FLAG_TONE[danger ? "danger" : "caution"];

  return (
    <section className={`mt-6 rounded-xl border p-4 ${tone.banner}`}>
      <p className={`flex items-center gap-2 text-sm font-semibold ${tone.text}`}>
        <AlertTriangle className="size-4 shrink-0" />
        {keys.length} setting{keys.length === 1 ? "" : "s"} flagged
        {dirty && " — review before saving"}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {keys.map((key) => {
          const own = risksFor(risks, key);
          const level = worstLevel(own);
          return (
            <li key={key} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              {level && <FlagChip level={level} />}
              <button
                type="button"
                onClick={() => focusSetting(key)}
                className="font-semibold text-primary hover:underline"
              >
                {labelOf(key)}
              </button>
              <span className="min-w-0 text-secondary">
                {own.map((r) => r.reason).join(" ")}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------- confirm ---------- */

function ConfirmDialog({
  changes,
  risks,
  risksBefore,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  changes: Change[];
  risks: SettingRisk[];
  risksBefore: SettingRisk[];
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const changed = new Set<BookSettingKey>(changes.map((c) => c.key));
  const enablingIntl = changes.some(
    (c) => c.key === "internationalTrading" && c.to === true,
  );
  // A change can flag a setting it didn't touch — lowering the loss cap
  // below the maximum stake flags the stake. Say so here too.
  const knock = risks.filter(
    (r) =>
      !changed.has(r.field) &&
      !risksBefore.some((b) => b.field === r.field && b.reason === r.reason),
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-[460px] overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-popover"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Save {changes.length} change{changes.length === 1 ? "" : "s"}?
        </h2>
        <p className="mt-0.5 text-sm text-secondary">
          They apply across the site within about a minute.
        </p>

        <ul className="mt-4 divide-y divide-border rounded-md border border-border bg-page">
          {changes.map((c) => {
            const own = risksFor(risks, c.key);
            const level = worstLevel(own);
            return (
              <li key={c.key} className="px-3 py-2.5">
                <p className="text-sm">
                  <span className="font-semibold">{labelOf(c.key)}:</span>{" "}
                  {formatPair(c.key, c.from, c.to, " → ")}
                </p>
                {level && (
                  <div className="mt-1.5 flex flex-wrap items-start gap-x-2 gap-y-1">
                    <FlagChip level={level} />
                    <span
                      className={`min-w-0 flex-1 text-xs font-medium ${
                        FLAG_TONE[FLAG_LEVEL[level].tone].text
                      }`}
                    >
                      {own.map((r) => r.reason).join(" ")}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {knock.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-secondary">
              This also flags:
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {flaggedKeys(knock).map((key) => {
                const own = risksFor(knock, key);
                const level = worstLevel(own);
                return (
                  <li key={key} className="flex flex-wrap items-start gap-x-2 gap-y-1 text-xs">
                    {level && <FlagChip level={level} />}
                    <span className="font-semibold">{labelOf(key)}</span>
                    <span className="min-w-0 text-secondary">
                      {own.map((r) => r.reason).join(" ")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {enablingIntl && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-no-tint px-3 py-2.5 text-sm font-semibold text-no">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Only switch this on after the new API is deployed and tested — real
            money will be staked on international markets.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-no">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-10 rounded-sm border border-border px-4 text-sm font-semibold text-secondary transition-colors hover:border-border-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="pressable flex h-10 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- history ---------- */

function History({ history }: { history: BookSettingChange[] }) {
  return (
    <section className="mt-8 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <h2 className="text-lg font-semibold">Change history</h2>
      {history.length === 0 ? (
        <p className="py-6 text-center text-sm text-secondary">
          No changes yet — every value is at its default.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {history.map((h, i) => (
            <li
              key={`${h.at}-${h.field}-${i}`}
              className="min-w-0 py-2.5 text-sm leading-5 last:pb-0"
            >
              <span className="tabular-nums text-tertiary">{fmtWhen(h.at)}</span>
              <span className="text-tertiary"> · </span>
              <span className="break-all text-secondary">{h.by}</span>
              <span className="text-tertiary"> · </span>
              <span className="font-semibold">
                {labelOf(h.field)} {formatPair(h.field, h.from, h.to, " → ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- states ---------- */

function LoadError({
  code,
  message,
  onRetry,
}: {
  code: string | null;
  message: string;
  onRetry: () => void;
}) {
  // 404: the API answering is older than this page
  const outdated = code === "NOT_FOUND";
  return (
    <div className="mt-6 rounded-xl border border-border bg-surface p-6 text-sm leading-6 text-secondary shadow-card">
      <p className="flex items-start gap-2 font-semibold text-primary">
        <CloudOff className="mt-1 size-4 shrink-0 text-tertiary" />
        {outdated
          ? "Settings aren't available on this API yet — deploy the latest API to manage them here."
          : "Couldn't load the settings."}
      </p>
      {!outdated && <p className="mt-1 pl-6">{message}</p>}
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 h-9 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
      >
        Try again
      </button>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div role="status" className="mt-6 flex flex-col gap-4">
      <span className="sr-only">Loading settings…</span>
      {[2, 2, 2, 3, 2, 1].map((rows, i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border border-border bg-surface p-4 sm:p-5"
        >
          <div className="h-5 w-44 max-w-full rounded-md bg-element-2" />
          <div className="mt-2 h-4 w-72 max-w-full rounded-md bg-element-2" />
          {Array.from({ length: rows }, (_, j) => (
            <div
              key={j}
              className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="h-4 w-48 max-w-full rounded-md bg-element-2" />
              <div className="h-10 w-full rounded-md bg-element-2 sm:w-[17rem]" />
            </div>
          ))}
        </div>
      ))}
      <div className="h-40 animate-pulse rounded-xl border border-border bg-surface" />
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-card">
      <h1 className="text-lg font-semibold">Settings</h1>
      <p className="mt-2 text-sm text-secondary">{children}</p>
    </div>
  );
}
