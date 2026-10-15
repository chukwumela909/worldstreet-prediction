import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/**
 * Shared pieces of an outcome quote — the row every board surface (cards,
 * the featured market, the event page's outcome list) uses to show one
 * buyable outcome: a colour that identifies it, a bar for its chance, and
 * an outlined pill carrying the price.
 *
 * Colour identifies the outcome, not the side of a trade, so the BAR takes
 * the same series palette the price charts draw with: the third line on a
 * chart and the third row under it are the same colour. Binary markets are
 * the exception — Yes and No keep their semantic green and red. The PILL
 * is the buy action, and every buy action on a board is the brand gold
 * (PILL_TONE), whatever the outcome.
 */

/** Board price pills: always the gold primary, whichever outcome they buy. */
export const PILL_TONE = "var(--accent)";

const SERIES_TONES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
];

export const YES_TONE = "var(--yes)";
export const NO_TONE = "var(--no)";

/** Tone for the nth outcome of a multi-outcome event, matching its chart line. */
export function outcomeTone(index: number): string {
  return SERIES_TONES[index % SERIES_TONES.length];
}

/**
 * Chance as a thin bar under the outcome's name. No track: the bar is read
 * against the label's width, and a filled track would turn every row into
 * a progress meter competing with the price pill.
 */
export function ProbabilityBar({
  pct,
  tone,
  className = "",
}: {
  pct: number;
  tone: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`block h-0.5 rounded-full ${className}`}
      // a floor keeps a 0–1% outcome visible as a sliver rather than nothing
      style={{ width: `${Math.min(100, Math.max(pct, 2))}%`, background: tone }}
    />
  );
}

const PILL_BASE =
  "inline-flex shrink-0 items-center justify-center rounded-full border font-semibold tabular-nums transition-colors hover:bg-[color-mix(in_oklab,var(--tone)_16%,transparent)] aria-pressed:bg-[color-mix(in_oklab,var(--tone)_16%,transparent)] disabled:pointer-events-none disabled:opacity-40";

const PILL_VARIANTS = {
  /** Board price pill: outline in the tone, neutral text. */
  price:
    "border-(--tone) text-primary aria-pressed:ring-1 aria-pressed:ring-(--tone) aria-pressed:ring-inset",
  /** Yes/No side on the market page: neutral outline, toned text; the
   *  border takes the tone on hover and when picked. */
  side:
    "border-border text-(--tone) hover:border-(--tone) aria-pressed:border-(--tone) aria-pressed:ring-2 aria-pressed:ring-[color-mix(in_oklab,var(--tone)_20%,transparent)] aria-pressed:ring-offset-1 aria-pressed:ring-offset-surface",
};

const PILL_SIZES = {
  sm: "h-8 min-w-14 px-3 text-[13px]",
  md: "h-10 min-w-16 px-3.5 text-sm",
  /** The sports list's big round pill: 48px square on phones, 76×64 from sm. */
  lg: "h-12 w-12 px-1 text-xs sm:h-16 sm:w-[76px] sm:px-3 sm:text-sm",
};

/**
 * Outlined price pill. Outline at rest so a board of them reads as prices,
 * not a wall of buttons; tinted in the outcome's tone on hover or when
 * pressed. Renders a link when given `href`, otherwise a button.
 */
export function QuotePill({
  tone,
  children,
  href,
  onClick,
  pressed,
  disabled,
  size = "sm",
  variant = "price",
  label,
  className = "",
}: {
  tone: string;
  variant?: keyof typeof PILL_VARIANTS;
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
  size?: keyof typeof PILL_SIZES;
  /** Accessible name, e.g. "Buy Arsenal at 34¢". */
  label?: string;
  className?: string;
}) {
  const style = { "--tone": tone } as CSSProperties;
  const classes = `${PILL_BASE} ${PILL_VARIANTS[variant]} ${PILL_SIZES[size]} ${className}`;

  if (href) {
    return (
      <Link href={href} aria-label={label} className={classes} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      className={classes}
      style={style}
    >
      {children}
    </button>
  );
}
