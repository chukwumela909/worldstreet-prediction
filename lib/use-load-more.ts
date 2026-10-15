"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isLocalBook, type MarketEvent } from "@/types/market";
import { categoryTab } from "@/lib/categories";

/**
 * "Load more" for a server-rendered market list: keeps the first page as
 * rendered and appends the pages after it from /api/markets.
 *
 * The returned list is the one a board hands to useLivePrices, so cards
 * that arrive later poll like the first page's. It is de-duplicated by
 * event id, first sighting wins: Gamma re-sorts by live 24h volume, so an
 * event can move from one offset to the next between two requests. An
 * offset that starts a little early is harmless for the same reason,
 * which is why a feed's first offset is simply how many events the
 * server sent (never more than it asked for).
 *
 * The button goes away for good once a page comes back empty or the
 * route says it was the last one; a failed page keeps its cursor, so
 * "Try again" asks for the same page.
 */

/** Where the next page comes from — the query /api/markets takes. */
export type MarketFeed =
  | { source: "polymarket"; offset: number; limit: number; tagSlug?: string; order?: string }
  | { source: "bayse"; page: number };

export type LoadMoreStatus = "idle" | "loading" | "error" | "done";

/** Markets per click: whole rows in both the two- and three-column grids. */
const PAGE_LIMIT = 24;
/** getBayseEvents (lib/bayse.ts) already put Relay pages 1–2 on the board. */
const BAYSE_NEXT_PAGE = 3;
/**
 * What app/page.tsx asks Gamma for on the first page (BOARD_LIMIT,
 * CATEGORY_LIMIT). A first page that came back shorter was the whole
 * feed, and offering "Load more" under it would only produce an empty
 * click — the small tags (World Cup, Social media) run out inside it.
 */
const BOARD_FIRST_PAGE = 24;
const CATEGORY_FIRST_PAGE = 36;

/**
 * The home board's feed, read off its events: Trending is all Polymarket;
 * the Local tab is WorldStreet's own markets (all loaded already, so they
 * never page) plus Bayse's, which do. A Local tab whose Bayse half failed
 * to load has nothing to page.
 */
export function boardFeed(events: MarketEvent[]): MarketFeed | null {
  const polymarket = events.filter((e) => !isLocalBook(e)).length;
  if (polymarket > 0) {
    return polymarket < BOARD_FIRST_PAGE
      ? null
      : { source: "polymarket", offset: polymarket, limit: PAGE_LIMIT };
  }
  // Bayse drops events with no open market as it normalizes, so its count
  // says nothing about whether page 3 exists; the route answers that
  if (events.some((e) => e.source === "bayse")) return { source: "bayse", page: BAYSE_NEXT_PAGE };
  return null;
}

/**
 * A category page's feed: the same Gamma query its first page came from
 * — the sidebar group's tag when one is open, else the tab's own.
 */
export function categoryFeed(
  param: string,
  events: MarketEvent[],
  groupSlug?: string,
): MarketFeed | null {
  const tab = categoryTab(param);
  if (tab.param !== param || tab.source === "local") return null;
  if (events.length < CATEGORY_FIRST_PAGE) return null;
  return {
    source: "polymarket",
    offset: events.length,
    limit: PAGE_LIMIT,
    tagSlug: groupSlug ?? tab.tagSlug,
    order: tab.order,
  };
}

function feedQuery(feed: MarketFeed): string {
  const q = new URLSearchParams();
  if (feed.source === "bayse") {
    q.set("source", "bayse");
    q.set("page", String(feed.page));
  } else {
    q.set("offset", String(feed.offset));
    q.set("limit", String(feed.limit));
    if (feed.tagSlug) q.set("tagSlug", feed.tagSlug);
    if (feed.order) q.set("order", feed.order);
  }
  return q.toString();
}

function advance(feed: MarketFeed): MarketFeed {
  return feed.source === "bayse"
    ? { ...feed, page: feed.page + 1 }
    : { ...feed, offset: feed.offset + feed.limit };
}

interface State {
  next: MarketFeed | null;
  extra: MarketEvent[];
  status: LoadMoreStatus;
}

/**
 * `feed` is read once, on mount; after that the hook owns the cursor.
 * Boards are keyed by tab, so a different list is a fresh mount.
 */
export function useLoadMore(initial: MarketEvent[], feed: MarketFeed | null) {
  const [state, setState] = useState<State>(() => ({
    next: feed,
    extra: [],
    status: feed ? "idle" : "done",
  }));
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const loadMore = useCallback(() => {
    const next = state.next;
    if (!next || inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setState((s) => ({ ...s, status: "loading" }));

    fetch(`/api/markets?${feedQuery(next)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body: { events?: MarketEvent[]; hasMore?: boolean }) => {
        const page = Array.isArray(body.events) ? body.events : [];
        const more = page.length > 0 && body.hasMore !== false;
        setState((s) => ({
          next: more ? advance(next) : null,
          extra: [...s.extra, ...page],
          status: more ? "idle" : "done",
        }));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState((s) => ({ ...s, status: "error" }));
      })
      .finally(() => {
        if (inFlight.current === controller) inFlight.current = null;
      });
  }, [state.next]);

  const events = useMemo(() => {
    // same array until something is appended, so the live-price poller
    // above a board that never loads more behaves exactly as before
    if (state.extra.length === 0) return initial;
    const seen = new Set<string>();
    const out: MarketEvent[] = [];
    for (const e of [...initial, ...state.extra]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
    return out;
  }, [initial, state.extra]);

  return { events, status: state.status, loadMore };
}
