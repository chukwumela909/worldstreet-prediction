/**
 * Paused markets — the desk's emergency stop for a whole topic.
 *
 * The desk lists topics in Settings (`pausedTopics`, e.g. "bitcoin",
 * "btc"). A market is paused when its event's title or slug, or its own
 * title, contains one as a whole word: "Bitcoin Up or Down" and
 * "btc-up-or-down-15m-…" for "bitcoin" / "btc". Then:
 *  - the order route refuses it (409 MARKET_PAUSED);
 *  - the web hides it (lib/paused.ts reads the topics from
 *    GET /v1/markets/pricing — the same rule, kept in step);
 *  - POST /admin/void-paused refunds every open bet on it.
 */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The topics as one whole-word, case-blind pattern; null when nothing is paused. */
export function pausedPattern(topics: readonly string[]): RegExp | null {
  const words = topics.map((t) => t.trim()).filter(Boolean);
  if (words.length === 0) return null;
  // a slug's dashes count as spaces: "up or down" also pauses "up-or-down"
  const alts = words.map((w) => escape(w).replace(/ /g, "[\\s-]+"));
  return new RegExp(`(^|[^a-z0-9])(${alts.join("|")})($|[^a-z0-9])`, "i");
}

/** Whether any of these names belongs to a paused market. */
export function isPausedMarket(
  topics: readonly string[],
  ...names: (string | null | undefined)[]
): boolean {
  const pattern = pausedPattern(topics);
  return pattern !== null && names.some((name) => Boolean(name) && pattern.test(name!));
}
