import { formatUsdCompact } from "@/lib/format";

/**
 * Deriving the "Hot topics" rail from real 24h volume.
 *
 * Gamma has no per-topic volume endpoint and no "is this a topic" flag,
 * so ranking is aggregated from event `volume24hr` grouped by tag. The
 * filtering below is the awkward part: tags mix subjects ("Iran") with
 * navigation ("Sports") and market mechanics ("Recurring", "Up or Down"),
 * and only some of that is machine-distinguishable.
 */

export interface HotTopic {
  rank: number;
  name: string;
  /** Gamma tag slug; absent on the mock fixtures. */
  slug?: string;
  /** Preformatted, e.g. "$11M". */
  volumeToday: string;
}

/** Minimal shape needed from a raw Gamma event. */
export interface TopicSource {
  id: string;
  volume24hr?: number;
  tags?: { slug: string; label: string; forceHide?: boolean }[];
}

/**
 * Tags that duplicate the top-nav categories. They're real subjects, but
 * surfacing them here just mirrors navigation the user already has.
 */
const CATEGORY_SLUGS = new Set([
  "trending",
  "politics",
  "sports",
  "crypto",
  "esports",
  "finance",
  "geopolitics",
  "tech",
  "culture",
  "economy",
  "weather",
]);

/**
 * Tags describing market *mechanics* rather than subjects. Gamma exposes
 * no flag for these, so this list is hand-maintained and will drift as
 * Polymarket adds market types — it's the fragile part of this module.
 */
const STRUCTURAL_SLUGS = new Set([
  "recurring",
  "games",
  "hide-from-new",
  "up-or-down",
  "hit-price",
  "daily",
  "weekly",
  "monthly",
  "tournament-futures",
  "main-election",
]);

/** Above this overlap a tag is treated as a restatement of a higher one. */
const OVERLAP_LIMIT = 0.7;

/**
 * Rank tags by summed 24h volume across the events carrying them.
 *
 * Beyond the filters above, near-duplicate tags are collapsed: Polymarket
 * labels the same events "Elections", "Global Elections" and "Main
 * Election", which would otherwise fill the rail with one story. A tag
 * whose events are mostly covered by an already-ranked tag is dropped.
 */
export function deriveHotTopics(
  events: TopicSource[],
  limit = 5,
): HotTopic[] {
  // forceHide is Polymarket's own signal that a tag shouldn't be
  // surfaced; it flags most of the broad container tags for us
  const hidden = new Set<string>();
  for (const event of events) {
    for (const tag of event.tags ?? []) {
      if (tag.forceHide) hidden.add(tag.slug);
    }
  }

  const volume = new Map<string, number>();
  const eventIds = new Map<string, Set<string>>();
  const labels = new Map<string, string>();

  for (const event of events) {
    const v = event.volume24hr ?? 0;
    if (v <= 0) continue;
    for (const tag of event.tags ?? []) {
      const { slug } = tag;
      if (
        CATEGORY_SLUGS.has(slug) ||
        STRUCTURAL_SLUGS.has(slug) ||
        hidden.has(slug)
      ) {
        continue;
      }
      volume.set(slug, (volume.get(slug) ?? 0) + v);
      if (!eventIds.has(slug)) eventIds.set(slug, new Set());
      eventIds.get(slug)!.add(event.id);
      labels.set(slug, tag.label);
    }
  }

  // volume desc; shorter label wins ties, which favours the canonical
  // name of a group ("Fed" over "Economic Policy")
  const ranked = [...volume.entries()].sort(
    (a, b) =>
      b[1] - a[1] || (labels.get(a[0])?.length ?? 0) - (labels.get(b[0])?.length ?? 0),
  );

  const kept: { slug: string; total: number }[] = [];
  for (const [slug, total] of ranked) {
    if (kept.length >= limit) break;
    const ids = eventIds.get(slug)!;
    const redundant = kept.some((k) => {
      const other = eventIds.get(k.slug)!;
      let shared = 0;
      for (const id of ids) if (other.has(id)) shared++;
      return shared / ids.size >= OVERLAP_LIMIT;
    });
    if (!redundant) kept.push({ slug, total });
  }

  return kept.map((k, i) => ({
    rank: i + 1,
    name: labels.get(k.slug) ?? k.slug,
    slug: k.slug,
    volumeToday: formatUsdCompact(k.total),
  }));
}
