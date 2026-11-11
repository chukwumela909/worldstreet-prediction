"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { XMarkIcon as X } from "@heroicons/react/24/outline";

/**
 * The admin desk's building blocks — one look for every page, in the
 * WorldStreet design system on this app's tokens (app/globals.css):
 * page header, stat tiles, filter tabs, a list table that turns into
 * cards on a phone, a detail panel that slides in from the right, a
 * bulk-action bar, and the reply-by chip.
 *
 * Shape rules, as everywhere here: buttons `rounded-sm`, inputs and chips
 * `rounded-md`, cards `rounded-xl`; one gold (solid) button per view,
 * everything else outlined or plain; shadows only on what floats.
 */

/* ---------------- buttons ---------------- */

/** The one solid action of a view: gold, near-black text. */
export const BTN_PRIMARY =
  "pressable inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40";
/** Everything else: outlined. */
export const BTN_GHOST =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-border px-3 text-sm font-semibold text-secondary transition-colors hover:border-border-hover hover:text-primary disabled:opacity-40";
/** Quiet: text only, for the least important action. */
export const BTN_QUIET =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-sm px-3 text-sm font-semibold text-secondary transition-colors hover:bg-element-2 hover:text-primary disabled:opacity-40";

/* ---------------- page header ---------------- */

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  /** The section, in small gold capitals ("Inbox"). */
  eyebrow?: string;
  title: string;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-accent-ink">{eyebrow}</p>
        )}
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
        {lede && <p className="mt-1.5 max-w-2xl text-sm text-secondary">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ---------------- stat tiles ---------------- */

export type Tone = "neutral" | "warning" | "danger" | "good";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-primary",
  warning: "text-warning",
  danger: "text-no",
  good: "text-yes",
};

export function StatTiles({ children }: { children: React.ReactNode }) {
  return <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</dl>;
}

/**
 * A headline figure. Given `onClick` it's also a filter: pressing
 * "Overdue" shows the overdue ones, and `active` marks it while it does.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  onClick,
  active = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <dt className="text-sm text-secondary">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${TONE_TEXT[tone]}`}>{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-tertiary">{sub}</dd>}
    </>
  );
  const frame = `rounded-xl border bg-surface p-4 text-left shadow-card ${
    active ? "border-accent" : "border-border"
  }`;
  if (!onClick) return <div className={frame}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${frame} transition-colors hover:border-border-hover`}
    >
      {body}
    </button>
  );
}

/* ---------------- filter tabs ---------------- */

export interface TabItem<K extends string> {
  key: K;
  label: string;
  /** Shown beside the label; `alert` paints it as needing attention. */
  count?: number | undefined;
  alert?: boolean;
}

/** A segmented row of filters, each with its count. */
export function FilterTabs<K extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-md bg-element-2 p-1">
      {items.map((t) => {
        const on = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(t.key)}
            className={`flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-3 text-sm font-semibold transition-colors ${
              on ? "bg-surface text-primary shadow-card" : "text-secondary hover:text-primary"
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                  t.alert && t.count > 0 ? "bg-warning-tint text-warning" : "bg-element text-tertiary"
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- search ---------------- */

export function SearchField({
  value,
  onChange,
  placeholder,
  icon,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  icon: React.ReactNode;
}) {
  return (
    <label className="flex h-10 min-w-0 flex-1 basis-56 items-center gap-2 rounded-md border border-border bg-surface px-3 focus-within:border-accent">
      <span className="sr-only">{placeholder}</span>
      <span className="shrink-0 text-tertiary">{icon}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full min-w-0 bg-transparent text-sm font-medium outline-none placeholder:text-tertiary"
      />
    </label>
  );
}

/* ---------------- list table ---------------- */

/**
 * A table that is a list: on a desktop a grid of columns under a header
 * row, on a phone each row a card with its fields labelled (`Cell`'s
 * label). `columns` is a CSS grid template, e.g. "28px 2fr 1fr 120px".
 */
export function ListTable({
  label,
  columns,
  head,
  children,
}: {
  label: string;
  columns: string;
  head: React.ReactNode[];
  children: React.ReactNode;
}) {
  return (
    <div
      role="table"
      aria-label={label}
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-card"
      style={{ "--cols": columns } as React.CSSProperties}
    >
      <div
        role="row"
        className="hidden gap-3 border-b border-border px-4 py-2 text-xs font-semibold text-tertiary md:grid md:[grid-template-columns:var(--cols)]"
      >
        {head.map((h, i) => (
          <span role="columnheader" key={i} className="min-w-0 truncate">
            {h}
          </span>
        ))}
      </div>
      <div role="rowgroup" className="divide-y divide-border">
        {children}
      </div>
    </div>
  );
}

/**
 * One row. The whole row opens it (`onOpen`), through one real button
 * stretched over it — the checkbox and any other control sit above.
 */
export function ListRow({
  selected = false,
  ring = "",
  onOpen,
  openLabel,
  children,
  ...rest
}: {
  selected?: boolean;
  /** From useLinkedItem: the ring on the row an email linked to. */
  ring?: string;
  onOpen: () => void;
  openLabel: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      role="row"
      {...rest}
      className={`relative grid gap-x-3 gap-y-1 px-4 py-3 text-sm transition-colors md:items-center md:[grid-template-columns:var(--cols)] ${
        selected ? "bg-element-2" : "hover:bg-element"
      } ${ring}`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={openLabel}
        className="absolute inset-0 z-0 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      />
      {children}
    </div>
  );
}

/** A field in a row: labelled on a phone, a plain column on a desktop. */
export function Cell({
  label,
  children,
  className = "",
  interactive = false,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
  /** Sits above the row's stretched button (a checkbox, a link). */
  interactive?: boolean;
}) {
  return (
    <div
      role="cell"
      className={`pointer-events-none min-w-0 ${interactive ? "pointer-events-auto relative z-10" : ""} ${className}`}
    >
      {label && <span className="mr-1.5 text-xs text-tertiary md:hidden">{label}</span>}
      {children}
    </div>
  );
}

/* ---------------- bulk bar ---------------- */

/** "3 selected · Take them · Close them · ✕" — floats at the bottom while rows are ticked. */
export function BulkBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="pointer-events-none sticky bottom-4 z-20 mt-4 flex justify-center">
      <div
        role="toolbar"
        aria-label="Selected rows"
        className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-accent bg-surface px-3 py-2 shadow-popover"
      >
        <span className="px-1 text-sm font-semibold tabular-nums">{count} selected</span>
        <span className="h-5 w-px bg-border" aria-hidden />
        {children}
        <button type="button" onClick={onClear} aria-label="Clear the selection" className={BTN_QUIET}>
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

/* ---------------- detail panel ---------------- */

/**
 * The detail of one thing, sliding in from the right over a dimmed page
 * (a full-screen sheet on a phone). Escape or the scrim closes it; focus
 * moves in when it opens and back when it closes.
 */
export function DetailPanel({
  open,
  onClose,
  title,
  eyebrow,
  actions,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  /** The panel's own buttons, under the title. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-alpha-black-600" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        // focused only to move readers into it — no ring round the whole
        // panel (the global :focus-visible rule outranks a utility class)
        style={{ outline: "none" }}
        className={`relative flex h-full w-full flex-col border-l border-border bg-surface shadow-popover sm:rounded-l-2xl ${
          wide ? "sm:max-w-3xl" : "sm:max-w-xl"
        }`}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            {eyebrow && <div className="mb-1 text-xs font-medium text-tertiary">{eyebrow}</div>}
            <h2 id={titleId} className="text-xl font-semibold leading-tight tracking-tight">
              {title}
            </h2>
            {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={`${BTN_QUIET} -mr-2 -mt-1 w-9 px-0`}>
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** "Label  value" pairs, as in the panel's info block. */
export function InfoList({ items }: { items: [label: string, value: React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-tertiary">{label}</dt>
          <dd className="min-w-0 break-words">{value === "" || value === null ? "—" : value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A small section heading inside a panel. */
export function PanelSection({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b border-border py-4 first:pt-0 last:border-b-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ---------------- chips ---------------- */

const CHIP_TONE: Record<Tone, string> = {
  neutral: "bg-element-2 text-secondary",
  warning: "bg-warning-tint text-warning",
  danger: "bg-no-tint text-no",
  good: "bg-yes-tint text-yes",
};

export function Chip({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHIP_TONE[tone]}`}>
      {children}
    </span>
  );
}

/* ---------------- time ---------------- */

const MIN = 60_000;

/*
 * One clock for every "5 min ago" and "Due in 40 min" on the desk,
 * ticking every 30 seconds while anything shows one — so the times stay
 * true without each row keeping its own timer. 0 on the server.
 */
let nowMs = 0;
let ticker: ReturnType<typeof setInterval> | null = null;
const nowListeners = new Set<() => void>();

function subscribeNow(listener: () => void) {
  nowListeners.add(listener);
  ticker ??= setInterval(() => {
    nowMs = Date.now();
    for (const l of nowListeners) l();
  }, MIN / 2);
  return () => {
    nowListeners.delete(listener);
    if (nowListeners.size === 0 && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}

function readNow() {
  if (nowMs === 0) nowMs = Date.now();
  return nowMs;
}

/** The desk's shared clock (ms); 0 until the page is in the browser. */
export function useNow(): number {
  return useSyncExternalStore(subscribeNow, readNow, () => 0);
}

function span(ms: number): string {
  const m = Math.max(1, Math.round(ms / MIN));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** "just now" / "5 min ago" / "3h ago" / "2d ago", against `now` from useNow(). */
export function ago(iso: string, now: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || now === 0) return "—";
  return now - ms < MIN ? "just now" : `${span(now - ms)} ago`;
}

/**
 * The reply-by time as a chip: late is red ("Late 2h"), the last hour is
 * caution ("Due in 40 min"), the rest is plain ("Due in 5h").
 */
export function DueChip({ dueAt }: { dueAt: string | null | undefined }) {
  const now = useNow();
  if (!dueAt || now === 0) return null;
  const ms = Date.parse(dueAt);
  if (Number.isNaN(ms)) return null;
  const left = ms - now;
  if (left <= 0) return <Chip tone="danger">Late {span(-left)}</Chip>;
  return <Chip tone={left <= 60 * MIN ? "warning" : "neutral"}>Due in {span(left)}</Chip>;
}

/** Initials in a circle — who someone is at a glance. */
export function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  const letters =
    name
      .replace(/^key:/, "")
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-element-3 font-semibold text-secondary ${
        size === "md" ? "size-8 text-xs" : "size-6 text-[10px]"
      }`}
    >
      {letters}
    </span>
  );
}

/** An admin's label as a person: "key:josh" → "josh", "ada@x.com" → "ada". */
export function adminName(label: string): string {
  return label.replace(/^key:/, "").replace(/@.*$/, "");
}
