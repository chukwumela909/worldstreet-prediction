/**
 * The category pages' sidebar — the reference app's `categoryGroups`,
 * each entry pointed at the Polymarket (Gamma) tag that serves it. A
 * group is fetched by its own tag rather than filtered out of the
 * category's first page, so "NFL" lists NFL markets, not the two that
 * happened to be in the top 36 by volume.
 *
 * Only entries whose tag had open markets when this list was made are
 * kept (probed against gamma-api `/events?tag_slug=…&closed=false`);
 * the reference's other labels ("Local", "Collectibles", "Econ daily",
 * …) have no Polymarket tag behind them and would only ever be empty.
 * A parent without a tag of its own ("Football", "Indices") is just a
 * heading over its children.
 */

export interface GroupLink {
  label: string;
  /** Gamma tag slug, e.g. "nfl". */
  slug: string;
}

export interface SidebarGroup {
  label: string;
  /** Absent when the parent is only a heading over its children. */
  slug?: string;
  children?: GroupLink[];
}

/** Keyed by category tab param (lib/categories.ts). */
export const CATEGORY_GROUPS: Record<string, SidebarGroup[]> = {
  politics: [
    { label: "Congress", slug: "congress" },
    {
      label: "International",
      slug: "world",
      children: [
        { label: "Nigeria", slug: "nigeria" },
        { label: "United States", slug: "united-states" },
        { label: "Europe", slug: "europe" },
      ],
    },
    { label: "Recurring", slug: "recurring" },
    { label: "Courts", slug: "courts" },
    { label: "Elections", slug: "elections" },
  ],
  culture: [
    {
      label: "Movies",
      slug: "movies",
      children: [
        { label: "Box office", slug: "box-office" },
        { label: "Rotten Tomatoes", slug: "rotten-tomatoes" },
      ],
    },
    { label: "Music", slug: "music" },
    {
      label: "Awards",
      slug: "awards",
      children: [
        { label: "Oscars", slug: "oscars" },
        { label: "Grammys", slug: "grammys" },
      ],
    },
    { label: "People", slug: "celebrities" },
    {
      label: "Television",
      slug: "tv",
      children: [{ label: "Reality TV", slug: "reality-tv" }],
    },
    { label: "Video games", slug: "video-games" },
  ],
  crypto: [
    { label: "15 min", slug: "15m" },
    { label: "Hourly", slug: "1h" },
    { label: "Daily", slug: "daily" },
    { label: "Weekly", slug: "weekly" },
    { label: "Monthly", slug: "monthly" },
    { label: "Annual", slug: "yearly" },
    { label: "BTC", slug: "bitcoin" },
    { label: "ETH", slug: "ethereum" },
    { label: "SOL", slug: "solana" },
  ],
  finance: [
    { label: "Public companies", slug: "stocks" },
    {
      label: "Indices",
      children: [
        { label: "S&P 500", slug: "sp-500" },
        { label: "Nasdaq", slug: "nasdaq" },
      ],
    },
    { label: "Foreign exchange", slug: "forex" },
    { label: "Interest rates", slug: "interest-rates" },
    { label: "Company news", children: [{ label: "Earnings", slug: "earnings" }] },
    {
      label: "Metals",
      children: [
        { label: "Gold", slug: "gold" },
        { label: "Silver", slug: "silver" },
      ],
    },
  ],
  economy: [
    { label: "Fed", slug: "fed" },
    { label: "GDP", slug: "gdp" },
    { label: "Housing", slug: "housing" },
    { label: "Inflation", slug: "inflation" },
    { label: "Jobs & economy", slug: "jobs" },
    { label: "Oil and energy", slug: "oil" },
  ],
  sports: [
    {
      label: "Football",
      children: [
        { label: "NFL", slug: "nfl" },
        { label: "NCAA Football", slug: "cfb" },
      ],
    },
    {
      label: "Tennis",
      slug: "tennis",
      children: [
        { label: "ATP", slug: "atp" },
        { label: "WTA", slug: "wta" },
      ],
    },
    { label: "Baseball", slug: "baseball" },
    {
      label: "Soccer",
      slug: "soccer",
      children: [
        { label: "Premier League", slug: "epl" },
        { label: "Champions League", slug: "ucl" },
      ],
    },
    {
      label: "Basketball",
      slug: "basketball",
      children: [
        { label: "NBA", slug: "nba" },
        { label: "WNBA", slug: "wnba" },
      ],
    },
    { label: "Golf", slug: "golf" },
    { label: "MMA", slug: "mma" },
    { label: "Cricket", slug: "cricket" },
    { label: "Motorsport", slug: "f1" },
    { label: "Hockey", slug: "hockey" },
  ],
  esports: [
    { label: "Counter-Strike", slug: "counter-strike-2" },
    { label: "Dota 2", slug: "dota-2" },
    { label: "League of Legends", slug: "league-of-legends" },
    { label: "Valorant", slug: "valorant" },
  ],
  tech: [
    { label: "Artificial intelligence", slug: "ai" },
    { label: "Space", slug: "space" },
    { label: "Companies", slug: "big-tech" },
    { label: "Science", slug: "science" },
  ],
  weather: [
    {
      label: "Daily temperature",
      slug: "daily-temperature",
      children: [{ label: "New York", slug: "new-york" }],
    },
    { label: "Climate", slug: "climate" },
    { label: "Hurricanes", slug: "hurricane" },
    { label: "Rainfall", slug: "precipitation" },
  ],
  "social-media": [
    { label: "YouTube", slug: "youtube" },
    { label: "TikTok", slug: "tiktok" },
  ],
};

/** Every linkable entry of a category, parents with a tag and children alike. */
function links(param: string): GroupLink[] {
  return (CATEGORY_GROUPS[param] ?? []).flatMap((g) => [
    ...(g.slug ? [{ label: g.label, slug: g.slug }] : []),
    ...(g.children ?? []),
  ]);
}

/** The sidebar entry a `?group=` label names, or null when it names none. */
export function findGroup(param: string, label: string): GroupLink | null {
  if (!label) return null;
  return links(param).find((l) => l.label === label) ?? null;
}

/** Tags a group page may fetch — the /api/markets allow-list. */
export const GROUP_TAG_SLUGS: ReadonlySet<string> = new Set(
  Object.keys(CATEGORY_GROUPS).flatMap((param) => links(param).map((l) => l.slug)),
);
