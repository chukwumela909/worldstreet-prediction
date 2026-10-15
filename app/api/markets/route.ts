import { getEvents, type GetEventsOptions } from "@/lib/polymarket";
import { BAYSE_MAX_PAGE, getBayseEventsPage } from "@/lib/bayse";
import { CATEGORY_TABS } from "@/lib/categories";
import { GROUP_TAG_SLUGS } from "@/lib/category-groups";
import type { MarketEvent } from "@/types/market";

/**
 * The next page of a market list — what a board's "Load more" reads
 * (lib/use-load-more.ts). The first page is always server-rendered; this
 * only serves the ones after it.
 *
 *   GET /api/markets?offset=24&limit=24[&tagSlug=politics][&order=startDate]
 *       Polymarket (Gamma), the Trending board and every category page
 *   GET /api/markets?source=bayse&page=3
 *       Bayse Relay, the Local tab (pages 1–2 are already on the board)
 *   → { events: MarketEvent[], hasMore: boolean }
 *
 * Nothing from the query string reaches an upstream as typed: numbers are
 * parsed and clamped, and `tagSlug` / `order` must be values a category
 * tab actually uses (lib/categories.ts). Anything else is a 400.
 *
 * Both sources go through their libraries' cached fetchers, so a page two
 * visitors ask for within the cache period costs one upstream call.
 */

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;
/** Paging past this is a scraper, not a visitor; it also bounds the cache keys. */
const MAX_OFFSET = 2_000;

const DEFAULT_ORDER = "volume24hr";
// a category tab's own tag, or one of its sidebar groups (lib/category-groups.ts)
const TAG_SLUGS = new Set([
  ...CATEGORY_TABS.flatMap((t) => (t.tagSlug ? [t.tagSlug] : [])),
  ...GROUP_TAG_SLUGS,
]);
const ORDERS = new Set([DEFAULT_ORDER, ...CATEGORY_TABS.flatMap((t) => (t.order ? [t.order] : []))]);

interface Page {
  events: MarketEvent[];
  hasMore: boolean;
}

/** A non-negative integer param, clamped to [min, max]; null when malformed. */
function intParam(raw: string | null, fallback: number, min: number, max: number): number | null {
  if (raw === null || raw === "") return fallback;
  if (!/^\d{1,9}$/.test(raw)) return null;
  return Math.min(max, Math.max(min, Number(raw)));
}

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const source = params.get("source") ?? "polymarket";

  if (source === "bayse") {
    const page = intParam(params.get("page"), 1, 1, BAYSE_MAX_PAGE);
    if (page === null) return badRequest("page must be a positive integer");
    try {
      const body: Page = await getBayseEventsPage(page);
      return Response.json(body);
    } catch {
      return Response.json({ error: "Bayse feed unavailable" }, { status: 502 });
    }
  }

  if (source !== "polymarket") return badRequest("unknown source");

  const offset = intParam(params.get("offset"), 0, 0, MAX_OFFSET);
  const limit = intParam(params.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  if (offset === null) return badRequest("offset must be a non-negative integer");
  if (limit === null) return badRequest("limit must be a positive integer");

  const tagSlug = params.get("tagSlug") || undefined;
  if (tagSlug !== undefined && !TAG_SLUGS.has(tagSlug)) return badRequest("unknown tagSlug");
  const order = params.get("order") || DEFAULT_ORDER;
  if (!ORDERS.has(order)) return badRequest("unknown order");

  // the default order is left unset, as the server-rendered pages do, so
  // the options — and so the cache key — read the same however it's asked
  const options = (at: number): GetEventsOptions => ({
    limit,
    offset: at,
    tagSlug,
    order: order === DEFAULT_ORDER ? undefined : order,
  });

  try {
    const events = await getEvents(options(offset));
    let hasMore = events.length > 0 && offset + limit < MAX_OFFSET;
    // Gamma fills every page but the last, so a short page is usually the
    // end — but normalizing drops events with no open market, so it can
    // also be a full page that lost one. Asking for the next page settles
    // it, and costs nothing when there is one: it's the exact request the
    // client makes next, now already cached. If that check itself fails,
    // leave the button up: the click will retry it and say so if it fails.
    if (hasMore && events.length < limit) {
      const next = await getEvents(options(offset + limit)).catch(() => null);
      hasMore = next === null || next.length > 0;
    }
    const body: Page = { events, hasMore };
    return Response.json(body);
  } catch {
    return Response.json({ error: "Polymarket feed unavailable" }, { status: 502 });
  }
}
