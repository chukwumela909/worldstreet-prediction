"use client";

import { useEffect, useState } from "react";
import type { MarketEvent } from "@/types/market";

/**
 * Live events by slug for client surfaces that hold market references
 * rather than a server-fetched list: the portfolio (pricing open
 * positions) and the watchlist.
 *
 * The nav bar and the portfolio page both need this on the same render,
 * so in-flight requests are shared and results memoised briefly at module
 * scope — otherwise every mount would re-hit the route for the same slugs.
 */

const TTL_MS = 30_000;

interface CacheEntry {
  at: number;
  promise: Promise<MarketEvent[]>;
}

const cache = new Map<string, CacheEntry>();

function fetchEvents(slugs: string[]): Promise<MarketEvent[]> {
  const key = [...slugs].sort().join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;

  const promise = fetch(`/api/events?slugs=${encodeURIComponent(key)}`)
    .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
    .then((body: { events: MarketEvent[] }) => body.events ?? [])
    .catch(() => {
      // don't cache failures — the next mount should retry
      cache.delete(key);
      return [] as MarketEvent[];
    });

  cache.set(key, { at: Date.now(), promise });
  return promise;
}

export interface LiveEvents {
  bySlug: Record<string, MarketEvent>;
  loading: boolean;
}

export function useLiveEvents(slugs: string[]): LiveEvents {
  // sorted+joined so the effect keys off content, not array identity
  const key = [...new Set(slugs)].sort().join(",");

  const [loaded, setLoaded] = useState<{
    key: string;
    bySlug: Record<string, MarketEvent>;
  }>({ key: "", bySlug: {} });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    fetchEvents(key.split(",")).then((events) => {
      if (cancelled) return;
      const bySlug: Record<string, MarketEvent> = {};
      for (const e of events) bySlug[e.slug] = e;
      setLoaded({ key, bySlug });
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  const fresh = loaded.key === key;
  return {
    bySlug: fresh ? loaded.bySlug : {},
    loading: key !== "" && !fresh,
  };
}
