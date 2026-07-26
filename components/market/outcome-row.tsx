"use client";

import { useAuth } from "@/components/auth/auth-context";

/**
 * One buyable outcome on a grid card: a colour bar, the outcome's name,
 * what a winning unit returns, and its probability.
 *
 * The whole row is the buy control — the grid used to carry separate Buy
 * Yes/No buttons, which is a second target to aim at inside an already
 * dense card. Rest state keeps the row quiet so a card reads as
 * information; the probability pill goes solid on hover, the same
 * tint→solid model the event page's outcome list uses.
 *
 * Only the Yes pill is tinted at rest. On a binary market the two rows are
 * complements, so tinting both would present a derived number as a second
 * independent signal.
 */
export function OutcomeRow({
  side,
  label,
  multiplier,
  pct,
  tinted = false,
}: {
  side: "yes" | "no";
  label: string;
  multiplier: string;
  pct: number;
  /** Tint the pill at rest — the Yes row of a binary market. */
  tinted?: boolean;
}) {
  const { user, openAuth } = useAuth();

  const rest = tinted
    ? "bg-yes-tint text-yes"
    : "bg-element-2 text-primary";
  const hover =
    side === "yes"
      ? "group-hover:bg-yes-solid group-hover:text-white"
      : "group-hover:bg-no-solid group-hover:text-white";

  return (
    <button
      onClick={() => {
        if (!user) openAuth();
      }}
      aria-label={`Buy ${label}`}
      className="group -mx-1.5 flex items-center gap-2.5 rounded-sm px-1.5 py-1.5 transition-colors hover:bg-element-2"
    >
      <span
        aria-hidden="true"
        className={`h-4 w-[3px] shrink-0 rounded-full ${
          side === "yes" ? "bg-yes" : "bg-no"
        }`}
      />
      <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-primary">
        {label}
      </span>
      <span className="shrink-0 text-[13px] font-medium tabular-nums text-tertiary">
        {multiplier}
      </span>
      <span
        className={`w-[52px] shrink-0 rounded-md py-1 text-center text-[13px] font-semibold tabular-nums transition-colors ${rest} ${hover}`}
      >
        {pct}%
      </span>
    </button>
  );
}
