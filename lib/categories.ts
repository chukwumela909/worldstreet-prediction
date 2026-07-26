/**
 * Home category tabs → live Gamma queries.
 *
 * Each tab is a URL param (`/?category=<param>`) resolved server-side to
 * its own query, so switching tabs re-fetches from Polymarket instead of
 * filtering the trending list client-side.
 */

export interface CategoryTab {
  /** URL value, e.g. "politics" */
  param: string;
  /** Display label, e.g. "Politics" */
  label: string;
  /** Gamma tag_slug filter; absent = no tag filter */
  tagSlug?: string;
  /** Gamma sort field; defaults to volume24hr */
  order?: string;
  /** Data source for the tab; absent = Polymarket/Gamma */
  source?: "local";
}

export const CATEGORY_TABS: CategoryTab[] = [
  { param: "trending", label: "Trending" },
  // The naira book: our own fixed-odds markets plus the Bayse-fed
  // (African/Nigerian) feed, both traded against the house — see
  // lib/worldstreet-markets.ts, lib/bayse.ts and lib/local-trades.ts
  { param: "local", label: "Local", source: "local" },
  { param: "world-cup", label: "World Cup", tagSlug: "world-cup" },
  // newest listings first — where the visible day-to-day churn lives
  { param: "breaking", label: "Breaking", order: "startDate" },
  { param: "politics", label: "Politics", tagSlug: "politics" },
  { param: "sports", label: "Sports", tagSlug: "sports" },
  { param: "crypto", label: "Crypto", tagSlug: "crypto" },
  { param: "esports", label: "Esports", tagSlug: "esports" },
  { param: "finance", label: "Finance", tagSlug: "finance" },
  { param: "geopolitics", label: "Geopolitics", tagSlug: "geopolitics" },
  { param: "tech", label: "Tech", tagSlug: "tech" },
  { param: "culture", label: "Culture", tagSlug: "pop-culture" },
  { param: "economy", label: "Economy", tagSlug: "economy" },
  { param: "weather", label: "Weather", tagSlug: "weather" },
];

/**
 * The tab a bare `/` lands on. Local is the only book anyone can actually
 * trade — every other tab mirrors Polymarket for display — so it is what
 * the front door should open onto.
 *
 * Named rather than positional (it used to be CATEGORY_TABS[0]) so that
 * reordering the strip can't silently move the landing page.
 */
export const DEFAULT_CATEGORY = "local";

const DEFAULT_TAB =
  CATEGORY_TABS.find((t) => t.param === DEFAULT_CATEGORY) ?? CATEGORY_TABS[0];

/** Resolve a `?category=` value; unknown/absent → the default tab. */
export function categoryTab(param: string | undefined): CategoryTab {
  return CATEGORY_TABS.find((t) => t.param === param) ?? DEFAULT_TAB;
}
