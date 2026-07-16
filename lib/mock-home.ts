/** Fixtures for the homepage hero + promo rail. */

export interface HotTopic {
  rank: number;
  name: string;
  volumeToday: string; // preformatted, e.g. "$51M"
}

export const HOT_TOPICS: HotTopic[] = [
  { rank: 1, name: "Argentina", volumeToday: "$51M" },
  { rank: 2, name: "England", volumeToday: "$47M" },
  { rank: 3, name: "Ballon d'Or", volumeToday: "$970K" },
  { rank: 4, name: "Messi", volumeToday: "$13M" },
  { rank: 5, name: "Orbán", volumeToday: "$324K" },
];

export interface HeroComment {
  user: string;
  text: string;
  /** avatar hue for the gradient placeholder */
  hue: number;
}

export const HERO_COMMENTS: HeroComment[] = [
  { user: "junipero", text: "Portugal is definitely quite undervalued here actually. Real strong team + magic on the wings. 🤔", hue: 210 },
  { user: "nikitakud77", text: "you think portugal will win this world cup? Spain is actually pretty strong with their young core", hue: 280 },
  { user: "casda858", text: "A last World Cup run for the veterans; hoping the underdogs make it interesting.", hue: 30 },
];

/** Sports game hero slide (Spain vs. Argentina final). */
export const HERO_GAME = {
  breadcrumb: "Sports · Soccer · World Cup",
  title: "Spain vs. Argentina",
  kickoff: "8:00 PM",
  date: "July 19",
  home: { name: "Spain", flag: "🇪🇸", pct: 48 },
  drawPct: 22,
  away: { name: "Argentina", flag: "🇦🇷", pct: 30 },
  spread: { lines: ["1.5", "2.5"], active: "1.5", options: ["ESP -1.5", "ARG +1.5"] },
  total: { lines: ["1.5", "2.5", "3.5"], active: "2.5", options: ["O 2.5", "U 2.5"] },
  volume: "$5M Vol",
} as const;
