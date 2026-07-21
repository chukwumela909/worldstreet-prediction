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
}

export const CATEGORY_TABS: CategoryTab[] = [
  { param: "trending", label: "Trending" },
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

const DEFAULT_TAB = CATEGORY_TABS[0];

/** Resolve a `?category=` value; unknown/absent → Trending. */
export function categoryTab(param: string | undefined): CategoryTab {
  return CATEGORY_TABS.find((t) => t.param === param) ?? DEFAULT_TAB;
}
