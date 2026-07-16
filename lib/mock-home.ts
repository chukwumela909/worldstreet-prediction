/** Fixtures for the homepage hero + promo rail. */

export interface HotTopic {
  rank: number;
  name: string;
  volumeToday: string; // preformatted, e.g. "$51M"
}

export const HOT_TOPICS: HotTopic[] = [
  { rank: 1, name: "Argentina", volumeToday: "$51M" },
  { rank: 2, name: "England", volumeToday: "$51M" },
  { rank: 3, name: "Ballon", volumeToday: "$970K" },
  { rank: 4, name: "Messi", volumeToday: "$13M" },
  { rank: 5, name: "Orban", volumeToday: "$324K" },
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

export const HERO_PAGERS = {
  prev: "BTC 5min Up or Down",
  next: "Spain vs. Argentina",
};

/** carousel: index of the active dot out of 10 */
export const HERO_DOT_COUNT = 10;
