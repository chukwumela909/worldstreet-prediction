import { getEventsBySlugs } from "@/lib/polymarket";

/**
 * Live events by slug, for client surfaces that hold references to
 * markets rather than rendering a server-fetched list — the boards' live
 * price poll (lib/use-live-prices.ts), the portfolio and the watchlist.
 *
 *   GET /api/events?slugs=<slug>,<slug>
 *   → { events: MarketEvent[] }
 *
 * Slugs not found upstream are simply absent from the response; callers
 * render those as "price unknown" (see lib/market-lookup.ts).
 *
 * A board with "Load more" pressed a few times polls 90+ slugs, so the
 * set is fetched in fixed chunks, each its own cached Gamma call. The
 * poller sends its slugs sorted, so every visitor on the same board asks
 * for the same chunks and shares their cache: upstream load is one call
 * per chunk per cache window, however many people are watching.
 */
const MAX_SLUGS = 150;
const CHUNK = 50;

export async function GET(request: Request) {
  const slugs = (new URL(request.url).searchParams.get("slugs") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_SLUGS);

  if (slugs.length === 0) {
    return Response.json({ error: "No slugs requested" }, { status: 400 });
  }

  const chunks: string[][] = [];
  for (let i = 0; i < slugs.length; i += CHUNK) chunks.push(slugs.slice(i, i + CHUNK));

  // one failed chunk costs only its own cards a tick, not the whole board
  const results = await Promise.allSettled(chunks.map((c) => getEventsBySlugs(c)));
  if (results.every((r) => r.status === "rejected")) {
    return Response.json({ error: "Events unavailable" }, { status: 502 });
  }
  return Response.json({
    events: results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
  });
}
