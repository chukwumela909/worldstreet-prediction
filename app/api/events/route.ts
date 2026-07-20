import { getEventsBySlugs } from "@/lib/polymarket";

/**
 * Live events by slug, for client surfaces that hold references to
 * markets rather than rendering a server-fetched list — the portfolio
 * (pricing open positions) and the watchlist.
 *
 *   GET /api/events?slugs=<slug>,<slug>
 *   → { events: MarketEvent[] }
 *
 * Slugs not found upstream are simply absent from the response; callers
 * fall back to the mock fixtures for those.
 */

/** Portfolio + watchlist are demo-scale; keeps one Gamma call bounded. */
const MAX_SLUGS = 30;

export async function GET(request: Request) {
  const slugs = (new URL(request.url).searchParams.get("slugs") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_SLUGS);

  if (slugs.length === 0) {
    return Response.json({ error: "No slugs requested" }, { status: 400 });
  }

  try {
    return Response.json({ events: await getEventsBySlugs(slugs) });
  } catch {
    return Response.json({ error: "Events unavailable" }, { status: 502 });
  }
}
