import { ExclamationTriangleIcon as AlertTriangle } from "@heroicons/react/20/solid";
import { CREDIT, formatNairaCompact } from "@/lib/format";
import type { BookSettingKey, BookSettings } from "@/lib/admin-api";

/**
 * Risk flags for the admin desks — the settings page (a value that
 * leaves the house exposed) and the risk strip (a market closing in on
 * its loss limit) share one vocabulary and one pair of colours.
 *
 * Caution reads in the `--warning` yellow, danger in the `--no` red —
 * never the gold accent, which is the brand and the buy action. This map
 * is the only place to repoint them.
 */
export type FlagTone = "caution" | "danger";

export const FLAG_TONE: Record<
  FlagTone,
  { chip: string; text: string; bar: string; banner: string }
> = {
  caution: {
    chip: "bg-warning-tint text-warning",
    text: "text-warning",
    bar: "bg-warning",
    banner: "border-warning/40 bg-warning-tint",
  },
  danger: {
    chip: "bg-no-tint text-no",
    text: "text-no",
    bar: "bg-no",
    banner: "border-no/40 bg-no-tint",
  },
};

export type FlagLevel = "caution" | "risky" | "high" | "watch" | "critical";

export const FLAG_LEVEL: Record<
  FlagLevel,
  { label: string; tone: FlagTone; rank: number }
> = {
  caution: { label: "Caution", tone: "caution", rank: 1 },
  watch: { label: "Watch", tone: "caution", rank: 2 },
  risky: { label: "Risky", tone: "caution", rank: 2 },
  critical: { label: "Critical", tone: "danger", rank: 3 },
  high: { label: "High risk", tone: "danger", rank: 3 },
};

export function FlagChip({ level }: { level: FlagLevel }) {
  const { label, tone } = FLAG_LEVEL[level];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${FLAG_TONE[tone].chip}`}
    >
      <AlertTriangle className="size-3" aria-hidden />
      {label}
    </span>
  );
}

/* ---------- settings rules ---------- */

export interface SettingRisk {
  field: BookSettingKey;
  level: "caution" | "risky" | "high";
  reason: string;
}

/**
 * Which settings leave the house exposed, judged on the values as typed
 * (a field that doesn't parse is simply left out of `values`). Every
 * threshold lives here, in the API's own units — tune them in place.
 */
export function settingRisks(values: Partial<BookSettings>): SettingRisk[] {
  const THIN_SPREAD_BPS = 100; // under 1 point
  const LOW_SPREAD_BPS = 200; // under 2 points
  const LOW_FX_SPREAD_BPS = 50; // under 0.5%
  const THIN_LOCAL_SPREAD_BPS = 100; // under 1 point
  const LOW_LOCAL_SPREAD_BPS = 150; // under 1.5 points
  const STEEP_AUTO_STEP_KOBO = 1_000_000; // +1 point per under 10,000 credit
  const BIG_STAKE_KOBO = 100_000_000; // over 1,000,000 credit
  const BIG_EXPOSURE_KOBO = 1_000_000_000; // over 10,000,000 credit
  const LOOSE_TOLERANCE_KOBO = 500; // over 5 credit
  const SHORT_CUTOFF_SECONDS = 30;
  const HIGH_CEILING_KOBO = 9_500; // selling sides above ₦95

  const {
    internationalTrading,
    polymarketSpreadBps: spread,
    localSpreadBps: localSpread,
    fxSpreadBps: fxSpread,
    autoSpreadStepKobo: autoStep,
    maxStakeKobo: maxStake,
    maxMarketExposureKobo: exposure,
    priceToleranceKobo: tolerance,
    countdownCutoffSeconds: cutoff,
    lossAlertKobo: lossAlert,
    maxQuoteKobo: ceiling,
    maxStakePerMarketKobo: perMarket,
    earlyCloseHours: earlyClose,
    withdrawalReviewKobo: withdrawalReview,
    maxBookLossKobo: bookCap,
  } = values;
  const risks: SettingRisk[] = [];

  if (internationalTrading === true) {
    risks.push({
      field: "internationalTrading",
      level: "caution",
      reason: "Real-money betting on Polymarket markets is live.",
    });
  }
  if (spread !== undefined && spread < THIN_SPREAD_BPS) {
    risks.push({
      field: "polymarketSpreadBps",
      level: "high",
      reason:
        "Thin margin — fast traders can bet against our stale copy of Polymarket's price.",
    });
  } else if (spread !== undefined && spread < LOW_SPREAD_BPS) {
    risks.push({
      field: "polymarketSpreadBps",
      level: "risky",
      reason: "Low margin for a copied price.",
    });
  }
  if (localSpread !== undefined && localSpread < THIN_LOCAL_SPREAD_BPS) {
    risks.push({
      field: "localSpreadBps",
      level: "high",
      reason:
        "Local markets are sold at almost Bayse's own price — this is how the book lost money.",
    });
  } else if (localSpread !== undefined && localSpread < LOW_LOCAL_SPREAD_BPS) {
    risks.push({
      field: "localSpreadBps",
      level: "risky",
      reason: "Thin margin on Local markets.",
    });
  }
  if (fxSpread !== undefined && fxSpread < LOW_FX_SPREAD_BPS) {
    risks.push({
      field: "fxSpreadBps",
      level: "risky",
      reason: "Currency moves between rate updates can cost the house.",
    });
  }
  if (autoStep === 0) {
    risks.push({
      field: "autoSpreadStepKobo",
      level: "caution",
      reason: "Auto-adjusting is off — one-sided markets won't rebalance.",
    });
  } else if (autoStep !== undefined && autoStep < STEEP_AUTO_STEP_KOBO) {
    risks.push({
      field: "autoSpreadStepKobo",
      level: "risky",
      reason: `Very steep — a handful of bets can push a side's price to nearly ${CREDIT}99.`,
    });
  }
  if (maxStake !== undefined && exposure !== undefined && maxStake > exposure) {
    risks.push({
      field: "maxStakeKobo",
      level: "high",
      reason: "One bet could use up a whole market's loss limit.",
    });
  }
  if (maxStake !== undefined && maxStake > BIG_STAKE_KOBO) {
    risks.push({
      field: "maxStakeKobo",
      level: "risky",
      reason: "Very large single bets.",
    });
  }
  if (exposure !== undefined && exposure > BIG_EXPOSURE_KOBO) {
    risks.push({
      field: "maxMarketExposureKobo",
      level: "risky",
      reason: `A single market could lose more than ${formatNairaCompact(BIG_EXPOSURE_KOBO / 100)}.`,
    });
  }
  if (tolerance !== undefined && tolerance > LOOSE_TOLERANCE_KOBO) {
    risks.push({
      field: "priceToleranceKobo",
      level: "risky",
      reason: "Users can bet at noticeably stale prices.",
    });
  }
  if (cutoff !== undefined && cutoff < SHORT_CUTOFF_SECONDS) {
    risks.push({
      field: "countdownCutoffSeconds",
      level: "risky",
      reason: "Late bets when the result is nearly known.",
    });
  }
  if (ceiling === 0) {
    risks.push({
      field: "maxQuoteKobo",
      level: "high",
      reason: "No ceiling — customers can buy sides that are already almost decided.",
    });
  } else if (ceiling !== undefined && ceiling > HIGH_CEILING_KOBO) {
    risks.push({
      field: "maxQuoteKobo",
      level: "risky",
      reason: "Near-certain sides are still on sale.",
    });
  }
  if (bookCap === 0) {
    risks.push({
      field: "maxBookLossKobo",
      level: "risky",
      reason: "No limit on the whole book — risk can keep piling up across markets.",
    });
  } else if (bookCap !== undefined && lossAlert !== undefined && lossAlert > 0 && bookCap <= lossAlert) {
    risks.push({
      field: "maxBookLossKobo",
      level: "caution",
      reason: "At or below the Book loss alert — customers would be refused before admins are warned.",
    });
  }
  if (perMarket === 0) {
    risks.push({
      field: "maxStakePerMarketKobo",
      level: "caution",
      reason: "No cap — one customer can stack bet after bet on one market.",
    });
  }
  if (earlyClose === 0) {
    risks.push({
      field: "earlyCloseHours",
      level: "caution",
      reason: "Count markets take bets right up to the close, when the answer is often plain.",
    });
  }
  if (withdrawalReview === 0) {
    risks.push({
      field: "withdrawalReviewKobo",
      level: "caution",
      reason: "Withdrawals go straight out however large (flagged accounts still wait).",
    });
  }
  if (lossAlert === 0) {
    risks.push({
      field: "lossAlertKobo",
      level: "caution",
      reason: "Off — nobody is told when the whole book's possible loss grows.",
    });
  }
  return risks;
}

/** The worst level among a field's risks — what its chip shows. */
export function worstLevel<L extends FlagLevel>(risks: { level: L }[]): L | null {
  let worst: L | null = null;
  for (const r of risks) {
    if (!worst || FLAG_LEVEL[r.level].rank > FLAG_LEVEL[worst].rank) worst = r.level;
  }
  return worst;
}
