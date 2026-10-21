"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { MarketEvent } from "@/types/market";
import type { BookPricing } from "@/lib/book-pricing";
import {
  DEFAULT_MAX_STAKE_KOBO,
  DEFAULT_MIN_STAKE_KOBO,
  isNearCertain,
  quoteKobo,
  quoteMultiplier,
} from "@/lib/book";

/**
 * Hands the API's pricing parameters (lib/book-pricing.ts, loaded by the
 * root layout) to every client component that quotes a price or takes
 * a stake. Null — no API configured, an API too old to publish them, or
 * one that errored — means international trading is off and Local
 * markets quote at their raw price.
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
 * `quoteKobo` / `quoteMultiplier` take the outcome's auto-rise as an
 * optional third argument: the bet slip and the market page's outcome
 * rows read it from useMarketRises (lib/use-market-rises.ts) and pass
 * it; cards and lists leave it out and show the base price.
 *
 * `international` is true only while the API's admin switch is on; with
 * it off an international outcome has no quote (0) and its multiple is
 * Polymarket's own. `autoAdjusting` is true while the API publishes an
 * auto-adjusting spread — the only time rises are worth fetching. The
 * stake limits are the API's, or its defaults (₦100–₦50,000) when it
 * published none.
 */
export function useQuote() {
  const pricing = useContext(PricingContext);
  return useMemo(
    () => ({
      quoteKobo: (event: Pick<MarketEvent, "source">, price: string, riseBps = 0) =>
        quoteKobo(event, price, pricing, riseBps),
      quoteMultiplier: (event: Pick<MarketEvent, "source">, price: string, riseBps = 0) =>
        quoteMultiplier(event, price, pricing, riseBps),
      /** Off sale: priced above the desk's ceiling, almost decided. */
      nearCertain: (event: Pick<MarketEvent, "source">, price: string, riseBps = 0) =>
        isNearCertain(event, price, pricing, riseBps),
      international: pricing?.internationalTrading === true,
      autoAdjusting: (pricing?.autoSpreadStepKobo ?? 0) > 0,
      minStakeKobo: pricing?.minStakeKobo ?? DEFAULT_MIN_STAKE_KOBO,
      maxStakeKobo: pricing?.maxStakeKobo ?? DEFAULT_MAX_STAKE_KOBO,
    }),
    [pricing],
  );
}
