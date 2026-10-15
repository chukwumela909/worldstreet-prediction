import {
  SPORT_TYPES,
  isBinary,
  type GameTeam,
  type Market,
  type MarketEvent,
  type SportType,
} from "@/types/market";
import { NO_TONE, YES_TONE, outcomeTone } from "@/components/market/outcome-quote";

/**
 * Pure helpers behind the sports page (components/sports/): which two
 * outcomes a sports card quotes, which pill an event sits under, and how
 * the rail orders games. No hooks, so the card, the rail and the ticket
 * all read the same rows.
 */

export type Side = "yes" | "no";

/**
 * The live frame for a card or rail game: a purple edge fading into the
 * card border, over a faint purple wash on the card surface — the
 * reference's `[data-live]` rule, in semantic tokens.
 */
export const LIVE_FRAME =
  "border-transparent [background:linear-gradient(120deg,color-mix(in_srgb,var(--live)_7%,var(--bg-surface)),var(--bg-surface)_55%)_padding-box,linear-gradient(130deg,var(--live),var(--border-default)_35%)_border-box]";

/** The sports pills: All, then the reference's market types. */
export type SportFilter = "All" | SportType;
export const SPORT_FILTERS: readonly SportFilter[] = ["All", ...SPORT_TYPES];

/** An event with no type sits under Futures, as in the reference. */
export function sportTypeOf(event: MarketEvent): SportType {
  return event.sportType ?? "Futures";
}

export function matchesSport(event: MarketEvent, filter: SportFilter): boolean {
  return filter === "All" || sportTypeOf(event) === filter;
}

/** One buyable outcome on a sports card: a market and the side it buys. */
export interface QuoteRow {
  key: string;
  /** What the position is called: the market's outcome label or its group title. */
  label: string;
  market: Market;
  side: Side;
  /** Source price of that side, as a decimal string — quote it through useQuote(). */
  price: string;
  /** Bar colour — see components/market/outcome-quote.tsx. */
  tone: string;
  /** Present when the row is one of the game's two sides. */
  team?: GameTeam;
  /** This side's score, when the game's score is plainly two numbers. */
  score?: string;
}

/**
 * The game's score as two numbers, first team first, when it is written
 * that plainly ("0-3"). Anything richer — "2-9|1-1|Bo3", "6-4, 1-4" — is
 * left whole for display; it is never parsed beyond this.
 */
export function splitScore(score: string | undefined): [string, string] | null {
  const m = score?.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
  return m ? [m[1], m[2]] : null;
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Does a market's label name this team? Exact first, then whole-word
 * containment either way ("Seahawks" ↔ "Seattle Seahawks"), then the
 * abbreviation. A draw line ("Draw (A vs. B)") names both teams and is
 * never a team.
 */
function namesTeam(label: string, team: GameTeam): boolean {
  const l = normalize(label);
  if (!l || l.startsWith("draw")) return false;
  const n = normalize(team.name);
  if (l === n) return true;
  if (` ${n} `.includes(` ${l} `) || ` ${l} `.includes(` ${n} `)) return true;
  return team.abbreviation !== undefined && l === normalize(team.abbreviation);
}

/** Who-wins markets: tagged moneyline, or untagged (older events carry no type). */
function isWinnerMarket(m: Market): boolean {
  return m.sportsMarketType === "moneyline" || m.sportsMarketType === undefined;
}

/**
 * The two team rows of a game, in the game's team order (the order its
 * score is written in), or null when no who-wins market covers both.
 *
 *  (a) one market whose two outcomes are the teams (NFL, NBA, esports,
 *      tennis) — team rows are its Yes and No sides;
 *  (b) one Yes/No market per team, titled with the team (soccer, which
 *      adds a Draw market) — each team row buys its own market's Yes.
 *
 * Spreads and other markets also name the teams as outcomes, so only
 * moneyline (or untyped) markets count.
 */
function teamRows(event: MarketEvent): QuoteRow[] | null {
  const game = event.game;
  if (!game || game.teams.length < 2) return null;
  const teams = game.teams.slice(0, 2);
  const scores = game.live || game.ended ? splitScore(game.score) : null;
  const candidates = event.markets.filter(isWinnerMarket);
  const preferred = [
    ...candidates.filter((m) => m.sportsMarketType === "moneyline"),
    ...candidates.filter((m) => m.sportsMarketType !== "moneyline"),
  ];

  const row = (i: number, market: Market, side: Side, label: string): QuoteRow => ({
    key: `${market.id}:${side}`,
    label,
    market,
    side,
    price: market.outcomePrices[side === "yes" ? 0 : 1],
    tone: outcomeTone(i),
    team: teams[i],
    score: scores?.[i],
  });

  // (a) one market, the two teams as its outcomes. Matched by name when
  // both teams find distinct outcomes; a tagged moneyline whose labels
  // don't match (college football names schools, its teams are mascots)
  // falls back to the feed's own order, which lists outcomes in team order.
  const byName = (labels: [string, string]) => {
    const at = teams.map((t) => labels.findIndex((l) => namesTeam(l, t)));
    return at[0] >= 0 && at[1] >= 0 && at[0] !== at[1] ? at : null;
  };
  for (const market of preferred) {
    const labels = market.outcomeLabels;
    if (!labels) continue;
    const order =
      byName(labels) ?? (market.sportsMarketType === "moneyline" ? [0, 1] : null);
    if (order) return order.map((o, i) => row(i, market, o === 0 ? "yes" : "no", labels[o]));
  }

  // (b) a Yes/No market per team
  const own = teams.map((t) =>
    preferred.find((m) => !m.outcomeLabels && m.groupItemTitle && namesTeam(m.groupItemTitle, t)),
  );
  if (own[0] && own[1] && own[0] !== own[1]) {
    return own.map((m, i) => row(i, m!, "yes", m!.groupItemTitle!));
  }
  return null;
}

/**
 * The two rows a sports card quotes. A game's two teams when a who-wins
 * market covers them; otherwise what MarketCard shows — both sides of a
 * single market, or the first two markets' Yes.
 */
export function quoteRows(event: MarketEvent): QuoteRow[] {
  const teams = teamRows(event);
  if (teams) return teams;

  if (isBinary(event)) {
    const market = event.markets[0];
    const [yes, no] = market.outcomeLabels ?? ["Yes", "No"];
    return [
      { key: `${market.id}:yes`, label: yes, market, side: "yes", price: market.outcomePrices[0], tone: YES_TONE },
      { key: `${market.id}:no`, label: no, market, side: "no", price: market.outcomePrices[1], tone: NO_TONE },
    ];
  }
  return event.markets.slice(0, 2).map((market, i) => ({
    key: `${market.id}:yes`,
    label: market.groupItemTitle ?? market.question,
    market,
    side: "yes" as const,
    price: market.outcomePrices[0],
    tone: outcomeTone(i),
  }));
}

/** True when the card's rows are the game's two teams. */
export function hasTeamRows(rows: QuoteRow[]): boolean {
  return rows.length === 2 && rows.every((r) => r.team);
}

/** The market and side a fresh pick on this event starts on: its first row. */
export function firstPick(event: MarketEvent): { marketId: string; side: Side } {
  const [row] = quoteRows(event);
  return row
    ? { marketId: row.market.id, side: row.side }
    : { marketId: event.markets[0].id, side: "yes" };
}

/** "LIVE" caption detail: the period and clock, as the feed writes them ("2H 49'"). */
export function gameClock(event: MarketEvent): string {
  const game = event.game;
  if (!game) return "";
  return [game.period, game.elapsed && `${game.elapsed}'`].filter(Boolean).join(" ");
}

/** Kickoff as epoch ms; unknown kickoffs sort last. */
function kickoff(event: MarketEvent): number {
  const at = Date.parse(event.game?.startTime ?? "");
  return Number.isNaN(at) ? Number.MAX_SAFE_INTEGER : at;
}

/**
 * Games for the rail: not finished, live first, then by kickoff. Polymarket
 * splits one game into several events ("… - More Markets", "… - Exact
 * Score"); the rail shows each game once, preferring the event whose
 * rows are the teams.
 */
export function railGames(events: MarketEvent[]): MarketEvent[] {
  const games = events
    .filter((e) => e.game && !e.game.ended && e.game.teams.length >= 2)
    .sort((a, b) => Number(b.game!.live) - Number(a.game!.live) || kickoff(a) - kickoff(b));

  const byGame = new Map<string, MarketEvent>();
  for (const e of games) {
    const key = `${e.game!.teams.map((t) => normalize(t.name)).join("|")}@${e.game!.startTime ?? e.id}`;
    const seen = byGame.get(key);
    if (!seen || (!hasTeamRows(quoteRows(seen)) && hasTeamRows(quoteRows(e)))) {
      byGame.set(key, e);
    }
  }
  // Map keeps first-insertion order, so a replaced entry keeps its slot
  return [...byGame.values()];
}

/** Rail groups: one per league, in the order their first game appears. */
export function groupByLeague(games: MarketEvent[]): [string, MarketEvent[]][] {
  const groups = new Map<string, MarketEvent[]>();
  for (const e of games) {
    const league = e.game?.league ?? e.subcategory ?? "Other";
    groups.set(league, [...(groups.get(league) ?? []), e]);
  }
  return [...groups];
}

/** The card's identity strip: league, else the event's first tag, else its category. */
export function leagueLabel(event: MarketEvent): string {
  return event.game?.league ?? event.subcategory ?? event.tags?.[0] ?? event.category;
}
