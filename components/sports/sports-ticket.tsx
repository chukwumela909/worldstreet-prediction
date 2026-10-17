"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { XMarkIcon as X } from "@heroicons/react/24/outline";
import type { MarketEvent } from "@/types/market";
import { TradeProvider } from "@/components/event/trade-context";
import { LocalTradePanel } from "@/components/local/local-trade-panel";
import { useLivePrices } from "@/lib/use-live-prices";
import { firstPick, matchesSport, type Side, type SportFilter } from "./sports-data";

/**
 * The sports page's trade ticket — the reference's `sports-ticket`: one
 * outcome picked from a card or the event rail, in our bet slip
 * (LocalTradePanel — display-only on an international market until the
 * desk's international switch is on). From lg up it sits in a
 * sticky aside beside the list (SportsBoard renders <SportsTicket/>); below
 * lg a pick opens it in a "Trade outcome" sheet instead.
 *
 * The provider also holds the sports-type pill, so the default ticket is
 * the first market the visitor can actually see, as in the reference.
 */

/** The reference folds the ticket into a sheet below 1000px; lg is 1024. */
const WIDE_QUERY = "(min-width: 1024px)";

export interface SportsTicketPick {
  event: MarketEvent;
  marketId: string;
  side: Side;
}

interface Picked extends SportsTicketPick {
  /**
   * Whether the event was in the list when picked. A listed pick that
   * later drops out (filtered away, or gone from the feed) falls back to
   * the first event; a pick from outside the list (the rail shows every
   * game, whatever the filter) stays put.
   */
  listed: boolean;
}

export interface SportsTicketValue {
  /** What the ticket trades now: the visitor's pick, else the first event's first row. */
  ticket: (SportsTicketPick & { picked: boolean; listed: boolean }) | null;
  /** Select an outcome into the ticket; below lg this opens the sheet. */
  pick: (event: MarketEvent, marketId: string, side: Side) => void;
  /** The sports-type pill. */
  sport: SportFilter;
  setSport: (sport: SportFilter) => void;
}

const SportsTicketContext = createContext<SportsTicketValue | null>(null);

export function useSportsTicket(): SportsTicketValue {
  const ctx = useContext(SportsTicketContext);
  if (!ctx) throw new Error("useSportsTicket must be used inside SportsTicketProvider");
  return ctx;
}

/** A pick, re-pointed at the market's first row if its market has closed. */
function onMarket(event: MarketEvent, marketId: string, side: Side) {
  return event.markets.some((m) => m.id === marketId)
    ? { event, marketId, side }
    : { event, ...firstPick(event) };
}

export function SportsTicketProvider({
  events,
  children,
}: {
  /** The page's events, already filtered (group, search, saved) and live-priced. */
  events: MarketEvent[];
  children: ReactNode;
}) {
  const [sport, setSport] = useState<SportFilter>("All");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const filtered = useMemo(() => events.filter((e) => matchesSport(e, sport)), [events, sport]);

  const ticket = useMemo<SportsTicketValue["ticket"]>(() => {
    if (picked) {
      // the list's copy carries the latest prices
      const fresh = filtered.find((e) => e.id === picked.event.id);
      if (fresh) return { ...onMarket(fresh, picked.marketId, picked.side), picked: true, listed: true };
      if (!picked.listed) {
        return { ...onMarket(picked.event, picked.marketId, picked.side), picked: true, listed: false };
      }
    }
    const first = filtered[0];
    return first ? { event: first, ...firstPick(first), picked: false, listed: true } : null;
  }, [picked, filtered]);

  const pick = useCallback(
    (event: MarketEvent, marketId: string, side: Side) => {
      setPicked({ event, marketId, side, listed: filtered.some((e) => e.id === event.id) });
      if (!window.matchMedia(WIDE_QUERY).matches) setSheetOpen(true);
    },
    [filtered],
  );

  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const value = useMemo<SportsTicketValue>(
    () => ({ ticket, pick, sport, setSport }),
    [ticket, pick, sport],
  );

  return (
    <SportsTicketContext.Provider value={value}>
      {children}
      {sheetOpen && ticket && (
        <TicketSheet onClose={closeSheet}>
          <TicketPanel ticket={ticket} />
        </TicketSheet>
      )}
    </SportsTicketContext.Provider>
  );
}

/* ---------- the ticket ---------- */

const subscribeWide = (onChange: () => void) => {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

/**
 * Wide enough for the sticky aside. The server renders the desktop
 * layout (the aside is CSS-hidden below lg until this settles), so wide
 * screens don't watch the ticket pop in after hydration.
 */
export function useTicketBesideList(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

/**
 * The picked outcome in the stake form. Renders nothing until there's
 * an event to trade. SportsBoard places it in the aside; the sheet uses
 * the same body.
 */
export function SportsTicket() {
  const { ticket } = useSportsTicket();
  return ticket ? <TicketPanel ticket={ticket} /> : null;
}

const NO_EVENTS: MarketEvent[] = [];

function TicketPanel({ ticket }: { ticket: NonNullable<SportsTicketValue["ticket"]> }) {
  // A pick from outside the list (a rail game the filters hide) gets no
  // price updates from the board, so poll it the way the event page does.
  const [polled] = useLivePrices(ticket.listed ? NO_EVENTS : [ticket.event]);
  const event = polled ?? ticket.event;
  return (
    // keyed so a new pick restarts the selection (and clears the stake)
    <TradeProvider
      key={`${event.id}:${ticket.marketId}:${ticket.side}`}
      event={event}
      initialMarketId={ticket.marketId}
      initialSide={ticket.side}
    >
      <LocalTradePanel event={event} />
    </TradeProvider>
  );
}

/* ---------- narrow screens: the sheet ---------- */

/**
 * "Trade outcome" sheet below lg — MarketDetail's sheet, on its own: a
 * bottom sheet on phones, a centred dialog from sm. Escape, the backdrop
 * and the close button dismiss it; widening past lg closes it, since the
 * aside takes over there.
 */
function TicketSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const wide = window.matchMedia(WIDE_QUERY);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onWiden = () => {
      if (wide.matches) onClose();
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
  }, [onClose]);

  // portalled so the fixed layer escapes any stacking context on the page
  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[100] flex items-end justify-center bg-alpha-black-600 sm:items-center sm:p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-xl border border-border bg-surface p-5 shadow-popover sm:max-w-[420px] sm:rounded-xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-xl font-semibold tracking-tight">
            Trade outcome
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1.5 flex size-8 items-center justify-center rounded-sm text-secondary transition-colors hover:bg-element-2 hover:text-primary"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
