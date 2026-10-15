import type { ReactNode } from "react";
import type { HeroIcon } from "@/components/icons";
import { NO_TONE, YES_TONE } from "@/components/market/outcome-quote";

/**
 * Small pieces shared by the portfolio's sections, in the board's card
 * language: rounded-xl surface cards, 11px uppercase labels, 13.5px UI
 * text and xs secondary captions.
 */

export const CARD = "rounded-xl border border-border bg-surface shadow-card";

export const LABEL =
  "text-[11px] font-semibold uppercase tracking-wider text-secondary";

export const PRIMARY_BUTTON =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-accent px-4 text-[13px] font-semibold text-on-accent transition-colors hover:bg-accent-hover";

export const SECONDARY_BUTTON =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-element-2 px-4 text-[13px] font-semibold text-primary transition-colors hover:bg-element-3";

/**
 * Which side of a binary market an outcome label names, when the label
 * says so. Bayse markets are all two-outcome, but many carry their own
 * names ("Over", "Arsenal") and a position doesn't record which side it
 * was, so anything other than a literal Yes/No stays neutral rather than
 * being painted a side it may not be.
 */
function sideOf(label: string): "yes" | "no" | null {
  const l = label.trim().toLowerCase();
  if (l === "yes") return "yes";
  if (l === "no") return "no";
  return null;
}

/** Bar colour for an outcome: green/red for Yes/No, quiet otherwise. */
export function outcomeBarTone(label: string): string {
  const side = sideOf(label);
  if (side === "yes") return YES_TONE;
  if (side === "no") return NO_TONE;
  return "var(--text-secondary)";
}

/** The outcome a position backs, as a chip. */
export function OutcomeChip({ label }: { label: string }) {
  const side = sideOf(label);
  const tone =
    side === "yes"
      ? "bg-yes-tint text-yes"
      : side === "no"
        ? "bg-no-tint text-no"
        : "bg-element-2 text-primary";
  return (
    <span
      className={`inline-block max-w-full truncate rounded-md px-2 py-0.5 align-middle text-xs font-semibold ${tone}`}
    >
      {label}
    </span>
  );
}

/** "12 Oct 2026" — position timestamps only ever render client-side. */
export function formatDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * The card every empty, loading and signed-out state uses, so a section
 * with nothing in it still reads as a deliberate part of the page.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  actions,
  tone = "text-secondary",
  iconClassName = "",
  role,
}: {
  icon: HeroIcon;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  /** Icon colour — text-accent-ink for an invitation, text-no for a failure. */
  tone?: string;
  iconClassName?: string;
  role?: "status" | "alert";
}) {
  return (
    <div
      role={role}
      className={`${CARD} flex flex-col items-center px-6 py-12 text-center`}
    >
      <span
        className={`grid size-11 place-items-center rounded-md bg-element-2 ${tone}`}
      >
        <Icon className={`size-5 ${iconClassName}`} aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-[15px] font-semibold">{title}</h2>
      {children && (
        <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-secondary">
          {children}
        </p>
      )}
      {actions && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>
      )}
    </div>
  );
}
