"use client";

import { useAuth } from "@/components/auth/auth-context";
import { PILL_TONE, ProbabilityBar, QuotePill } from "./outcome-quote";

/**
 * One outcome on a board surface (grid card, featured market): its name
 * over a chance bar in the outcome's tone, what a winning unit returns,
 * and an outlined price pill.
 *
 * The pill is the buy affordance. Trading happens on the event page, so
 * for a signed-in user the pill opens it; signed out, it asks them to
 * sign in first, the same gate the event page's trade panel applies.
 */
export function OutcomeRow({
  label,
  tone,
  pct,
  multiplier,
  href,
  size = "sm",
}: {
  label: string;
  /** Outcome colour — see outcomeTone / YES_TONE / NO_TONE. */
  tone: string;
  pct: number;
  multiplier: string;
  /** The event page, where this outcome is actually bought. */
  href: string;
  size?: "sm" | "md";
}) {
  const { user, openAuth } = useAuth();
  const pill = {
    // the bar identifies the outcome; the pill is the buy action, in gold
    tone: PILL_TONE,
    size,
    label: `Buy ${label} at ${pct}¢`,
    children: `${pct}%`,
  };

  return (
    <div className="flex min-h-10 items-center gap-3">
      <div className="min-w-0 flex-1">
        <p
          className={`truncate font-medium text-primary ${
            size === "md" ? "text-[15px]" : "text-sm"
          }`}
        >
          {label}
        </p>
        <ProbabilityBar pct={pct} tone={tone} className="mt-1.5" />
      </div>
      <abbr
        title="Gross payout per dollar at this price, before fees"
        className="shrink-0 text-xs tabular-nums text-secondary no-underline"
      >
        {multiplier}
      </abbr>
      {user ? (
        <QuotePill {...pill} href={href} />
      ) : (
        <QuotePill {...pill} onClick={openAuth} />
      )}
    </div>
  );
}
