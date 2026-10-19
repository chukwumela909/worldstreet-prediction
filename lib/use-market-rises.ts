"use client";

import { useCallback, useSyncExternalStore } from "react";
import { API_BASE } from "@/lib/auth-config";

/**
 * The auto-adjusting spread's live rises — how much the API is adding,
 * right now, to the side of a market where the house stands to lose
 * (lib/book.ts). The API works them out per outcome and publishes them
 * at GET /v1/markets/rises?marketIds=… (public); this reads them for
 * the bet slip and the market page's outcome rows, so the price they
 * show is the price an order is charged. Never from cards or lists:
 * too many markets, and those show the base price.
 *
 * One poller for the whole page: every mounted hook adds its market ids
 * to a shared set, which is fetched in batches of 50 (the API's cap)
 * every 15 seconds and on refocus — so the slip and the outcome rows
 * always agree. A new id is fetched at once.
 *
 * A non-2xx answer — an API that predates rises answers 404 — means no
 * rises; a network failure or timeout keeps the last ones read until
 * the next tick. Either way the API re-prices every order, and a quote
 * that drifted comes back as PRICE_MOVED for the visitor to confirm.
 */

/** bps by outcome id, by market id — only outcomes with a rise appear. */
type Rises = Readonly<Record<string, Readonly<Record<string, number>>>>;

const REFRESH_MS = 15_000;
/** The API refuses a request for more markets than this. */
const MAX_IDS_PER_CALL = 50;
const FETCH_TIMEOUT_MS = 5_000;
/** A refocus right after a fetch doesn't fetch again. */
const MIN_GAP_MS = 2_000;

const EMPTY: Rises = Object.freeze({});

/** Market id → how many mounted hooks want it. */
const wanted = new Map<string, number>();
const listeners = new Set<() => void>();
let current: Rises = EMPTY;
/** Ids the last good fetch covered — anything else is fetched at once. */
let covered = new Set<string>();
let timer: ReturnType<typeof setInterval> | null = null;
let soon: ReturnType<typeof setTimeout> | null = null;
/** Bumped by every fetch (and by stopping): a stale answer is dropped. */
let generation = 0;
let lastFetchAt = 0;

function publish(next: Rises) {
  current = next;
  for (const listener of listeners) listener();
}

/** The `rises` the API sent for these ids, keeping only positive bps. */
function parseRises(body: unknown, ids: string[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const rises = (body as { data?: { rises?: unknown } } | null)?.data?.rises;
  if (typeof rises !== "object" || rises === null) return out;
  for (const id of ids) {
    const sides = (rises as Record<string, unknown>)[id];
    if (typeof sides !== "object" || sides === null) continue;
    for (const [outcomeId, bps] of Object.entries(sides)) {
      if (typeof bps !== "number" || !Number.isFinite(bps)) continue;
      const rounded = Math.round(bps);
      if (rounded > 0) (out[id] ??= {})[outcomeId] = rounded;
    }
  }
  return out;
}

/** One batch. Throws on a network failure; an answer that isn't rises is none. */
async function fetchBatch(ids: string[]): Promise<Record<string, Record<string, number>>> {
  const query = ids.map(encodeURIComponent).join(",");
  const res = await fetch(`${API_BASE}/v1/markets/rises?marketIds=${query}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return {};
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return {};
  }
  return parseRises(body, ids);
}

async function refresh() {
  const ids = [...wanted.keys()];
  if (ids.length === 0) return;
  const mine = ++generation;
  lastFetchAt = Date.now();
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_CALL) {
    batches.push(ids.slice(i, i + MAX_IDS_PER_CALL));
  }
  try {
    const parts = await Promise.all(batches.map(fetchBatch));
    if (mine !== generation) return; // a newer fetch (or an unmount) won
    covered = new Set(ids);
    publish(Object.assign({}, ...parts) as Rises);
  } catch {
    // network trouble or a timeout: keep the last rises until the next tick
  }
}

/** Coalesces every hook that mounts in one commit into a single fetch. */
function refreshSoon() {
  if (soon !== null) return;
  soon = setTimeout(() => {
    soon = null;
    void refresh();
  }, 0);
}

/** Embedded webviews can report "hidden" while visible — refocus refreshes too. */
function onVisible() {
  if (document.visibilityState !== "visible") return;
  if (Date.now() - lastFetchAt < MIN_GAP_MS) return;
  void refresh();
}

function start() {
  if (timer !== null) return;
  timer = setInterval(() => void refresh(), REFRESH_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
}

function stop() {
  if (timer !== null) clearInterval(timer);
  if (soon !== null) clearTimeout(soon);
  timer = null;
  soon = null;
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("focus", onVisible);
  generation++;
  covered = new Set();
  current = EMPTY;
}

function subscribe(ids: string[], onChange: () => void): () => void {
  listeners.add(onChange);
  for (const id of ids) wanted.set(id, (wanted.get(id) ?? 0) + 1);
  start();
  if (ids.some((id) => !covered.has(id))) refreshSoon();
  return () => {
    listeners.delete(onChange);
    for (const id of ids) {
      const n = (wanted.get(id) ?? 1) - 1;
      if (n > 0) wanted.set(id, n);
      else wanted.delete(id);
    }
    if (wanted.size === 0) stop();
  };
}

const noop = () => {};
const emptySnapshot = () => EMPTY;

/**
 * The live rise on each outcome of these markets, as
 * `rise(marketId, outcomeId) → bps` (0 where there's none, or none read
 * yet). Outcome ids are the market's `outcomeIds`. Pass `enabled` false
 * — no API, auto-adjusting off, a market not on our book — and nothing
 * is fetched: every rise is 0.
 */
export function useMarketRises(
  marketIds: readonly string[],
  enabled = true,
): (marketId: string, outcomeId: string | undefined) => number {
  // a stable key, so a fresh array each render doesn't resubscribe
  const key =
    enabled && API_BASE ? [...new Set(marketIds)].filter(Boolean).sort().join("\n") : "";
  const subscribeKey = useCallback(
    (onChange: () => void) => (key ? subscribe(key.split("\n"), onChange) : noop),
    [key],
  );
  const getSnapshot = useCallback(() => (key ? current : EMPTY), [key]);
  const rises = useSyncExternalStore(subscribeKey, getSnapshot, emptySnapshot);
  return useCallback(
    (marketId: string, outcomeId: string | undefined) =>
      outcomeId ? (rises[marketId]?.[outcomeId] ?? 0) : 0,
    [rises],
  );
}
