"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { MarketEvent } from "@/types/market";
import type { BookPricing } from "@/lib/book-pricing";
import {
  DEFAULT_MAX_STAKE_KOBO,
  DEFAULT_MIN_STAKE_KOBO,
  quoteKobo,
  quoteMultiplier,
} from "@/lib/book";

/**
 * Hands the API's pricing parameters (lib/book-pricing.ts, loaded by the
 * root layout) to every client component that quotes a price or takes
 * a stake. Null — no API configured, an API too old to publish them, or
 * one that errored — means international trading is off.
 */
const PricingContext = createContext<BookPricing | null>(null);

export function BookPricingProvider({
  pricing,
  children,
}: {
  pricing: BookPricing | null;
  children: ReactNode;
}) {
  return <PricingContext.Provider value={pricing}>{children}</PricingContext.Provider>;
}

/**
 * Book quotes bound to the API's current pricing — see lib/book.ts. The
 * one price path: every buy button, payout multiple and stake form
 * reads its numbers from here.
 *
 * `international` is true only while the API's admin switch is on; the
 * spread reaches the quote functions only then, so with it off an
 * international outcome has no quote (0) and its multiple is
 * Polymarket's own. The stake limits are the API's, or its defaults
 * (₦100–₦50,000) when it published none.
 */
export function useQuote() {
  const pricing = useContext(PricingContext);
  const international = pricing?.internationalTrading === true;
  const spread = pricing && international ? pricing.polymarketSpreadBps : null;
  const minStakeKobo = pricing?.minStakeKobo ?? DEFAULT_MIN_STAKE_KOBO;
  const maxStakeKobo = pricing?.maxStakeKobo ?? DEFAULT_MAX_STAKE_KOBO;
  return useMemo(
    () => ({
      quoteKobo: (event: Pick<MarketEvent, "source">, price: string) =>
        quoteKobo(event, price, spread),
      quoteMultiplier: (event: Pick<MarketEvent, "source">, price: string) =>
        quoteMultiplier(event, price, spread),
      international,
      minStakeKobo,
      maxStakeKobo,
    }),
    [spread, international, minStakeKobo, maxStakeKobo],
  );
}
