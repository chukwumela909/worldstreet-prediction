import { getBookPricing } from "@/lib/book-pricing";

/**
 * Paused markets — the desk's emergency stop for a whole topic (Admin →
 * Settings → Paused markets). A market is paused when its event's title
 * or slug, or one of its markets' titles, contains a paused topic as a
 * whole word: "Bitcoin Up or Down" and "btc-up-or-down-15m-…" for
 * "bitcoin" / "btc". Paused markets drop off every list and their pages
 * 404; the API refuses bets on them regardless (MARKET_PAUSED).
 *
 * Keep the rule in step with services/api/src/trading/paused.ts.
 */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pausedPattern(topics: readonly string[]): RegExp | null {
  const words = topics.map((t) => t.trim()).filter(Boolean);
  if (words.length === 0) return null;
  // a slug's dashes count as spaces: "up or down" also pauses "up-or-down"
  const alts = words.map((w) => escape(w).replace(/ /g, "[\\s-]+"));
  return new RegExp(`(^|[^a-z0-9])(${alts.join("|")})($|[^a-z0-9])`, "i");
}

/** Whether any of these names belongs to a paused market. */
export function isPaused(
  topics: readonly string[],
  ...names: (string | null | undefined)[]
): boolean {
  const pattern = pausedPattern(topics);
  return pattern !== null && names.some((name) => Boolean(name) && pattern.test(name!));
}

/** The desk's paused topics, from the API's pricing feed (cached ~60s); [] without one. */
export async function getPausedTopics(): Promise<string[]> {
  return (await getBookPricing())?.pausedTopics ?? [];
}
