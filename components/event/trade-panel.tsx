"use client";

/**
 * One Yes/No answer tab on the trade ticket (components/local/
 * local-trade-panel.tsx), which sets two of them in a raised pill
 * track, the way the reference bet slip does.
 *
 * The reference slip's answer pills, not the buy-button tint/solid pair:
 * plain on the track at rest, gold (bg-accent + text-on-accent) when
 * picked, whichever side it is. The label truncates (sports moneylines
 * carry team names); the price never does.
 */
export function SideToggle({
  label,
  price,
  side,
  active,
  onClick,
}: {
  label: string;
  /** The book's quote for this side, already formatted ("₩61", "—"). */
  price?: string;
  side: "yes" | "no";
  active: boolean;
  onClick: () => void;
}) {
  const palette = active
    ? "pressable bg-accent text-on-accent"
    : "text-primary hover:bg-surface";
  return (
    <button
      type="button"
      aria-pressed={active}
      data-side={side}
      onClick={onClick}
      className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40 ${palette}`}
    >
      <span className="truncate">{label}</span>
      {price && <span className="shrink-0 tabular-nums">{price}</span>}
    </button>
  );
}
