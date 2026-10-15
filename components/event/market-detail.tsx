"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronDownIcon as ChevronDown,
  XMarkIcon as X,
} from "@heroicons/react/24/outline";

/**
 * Page frame shared by the two market pages (/event and /local): a
 * breadcrumb row across the top, the event's blocks in a main column, and
 * the trade panel in a sticky "Trade outcome" card on the right.
 *
 * Below 1024px the right column folds away and a sticky bar at the foot
 * of the page opens the same panel as a sheet. There is exactly one panel
 * instance — the sheet is the aside restyled, not a second copy — so a
 * half-typed stake survives opening and closing it, and the Local panel's
 * wallet poll isn't doubled.
 */

const LG_QUERY = "(min-width: 1024px)";

/** Opens the trade sheet on narrow screens; a no-op beside the aside. */
const RevealTicketContext = createContext<() => void>(() => {});

export function useRevealTicket(): () => void {
  return useContext(RevealTicketContext);
}

export function MarketDetail({
  breadcrumb,
  ticket,
  children,
}: {
  breadcrumb: ReactNode;
  /** The trade panel's body; the card and its title come from here. */
  ticket: ReactNode;
  /** Main-column blocks, top to bottom. */
  children: ReactNode;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  const reveal = useCallback(() => {
    if (!window.matchMedia(LG_QUERY).matches) setSheetOpen(true);
  }, []);

  useEffect(() => {
    if (!sheetOpen) return;
    closeRef.current?.focus();
    const wide = window.matchMedia(LG_QUERY);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetOpen(false);
    };
    // growing past the breakpoint turns the sheet back into the aside —
    // drop the open state so the scroll lock goes with it
    const onWiden = () => {
      if (wide.matches) setSheetOpen(false);
    };
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWiden);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWiden);
    };
  }, [sheetOpen]);

  return (
    <RevealTicketContext.Provider value={reveal}>
      <main className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        {breadcrumb}

        <div className="mt-5 flex items-start gap-8 xl:gap-10">
          <div className="flex min-w-0 flex-1 flex-col gap-5">{children}</div>

          {/* Backdrop on narrow screens; `contents` on wide ones, so the
              aside sits straight in the column row. */}
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) setSheetOpen(false);
            }}
            className={`${
              sheetOpen
                ? "fixed inset-0 z-[100] flex items-end justify-center bg-alpha-black-600 sm:items-center sm:p-4"
                : "hidden"
            } lg:contents`}
          >
            <aside
              aria-labelledby={titleId}
              role={sheetOpen ? "dialog" : undefined}
              aria-modal={sheetOpen ? true : undefined}
              className="max-h-[88vh] w-full overflow-y-auto rounded-t-xl border border-border bg-surface p-5 shadow-card sm:max-w-[420px] sm:rounded-xl lg:sticky lg:top-[152px] lg:max-h-none lg:w-[360px] lg:max-w-none lg:shrink-0 lg:overflow-visible"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 id={titleId} className="text-[19px] font-semibold tracking-tight">
                  Trade outcome
                </h2>
                <button
                  ref={closeRef}
                  type="button"
                  aria-label="Close"
                  onClick={() => setSheetOpen(false)}
                  className="-mr-1.5 flex size-8 items-center justify-center rounded-md text-secondary transition-colors hover:bg-element-2 hover:text-primary lg:hidden"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="mt-4">{ticket}</div>
            </aside>
          </div>
        </div>

        {/* narrow screens only: the way into the panel */}
        <div className="sticky bottom-24 z-10 mt-6 flex md:bottom-4 items-center justify-between gap-3 rounded-xl border border-border bg-surface py-3 pl-4 pr-3 shadow-card lg:hidden">
          <p className="text-sm font-semibold">Choose an outcome to trade</p>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setSheetOpen(true)}
            className="h-10 shrink-0 rounded-md bg-accent px-5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover"
          >
            Trade
          </button>
        </div>
      </main>
    </RevealTicketContext.Provider>
  );
}

/* ---------- blocks ---------- */

/** A main-column block: the board's card, with a 19px heading. */
export function DetailCard({
  title,
  icon,
  caption,
  flush = false,
  children,
}: {
  title: string;
  icon?: ReactNode;
  /** Small secondary text across from the heading. */
  caption?: ReactNode;
  /** Body runs edge to edge (row lists draw their own dividers). */
  flush?: boolean;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-xl border border-border bg-surface shadow-card ${
        flush ? "overflow-hidden" : ""
      }`}
    >
      <header className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
        <h2
          id={headingId}
          className="flex items-center gap-2 text-[19px] font-semibold tracking-tight"
        >
          {icon}
          {title}
        </h2>
        {caption && <span className="text-right text-xs text-secondary">{caption}</span>}
      </header>
      <div className={flush ? "mt-3" : "px-4 pb-4 pt-3 sm:px-5 sm:pb-5"}>{children}</div>
    </section>
  );
}

/** Collapsible block for a card that stacks several (rules, timeline). */
export function Disclosure({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group px-4 sm:px-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-[19px] font-semibold tracking-tight [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="size-5 shrink-0 text-secondary transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-3 pb-5 text-sm leading-6 text-secondary">
        {children}
      </div>
    </details>
  );
}

export type MarketStatus = "Open" | "Closed" | "Resolved";

/** Small status token beside the eyebrow. Callers pass only what the data says. */
export function StatusToken({ status }: { status: MarketStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        status === "Open" ? "bg-yes-tint text-yes" : "bg-element-2 text-secondary"
      }`}
    >
      {status}
    </span>
  );
}
