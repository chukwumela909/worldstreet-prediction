import { BayseApiError, getBayseEventLive } from "@/lib/bayse";
import { getWorldstreetEventLive } from "@/lib/worldstreet-markets";

/**
 * GET /api/local/event?slug=<slug>
 *
 * One Local event with fresh prices, for the /local/[slug] poller —
 * the naira book's counterpart of /api/events. Serves both origins,
 * ours first, matching how the page itself resolved the slug.
 * Shape: { event: MarketEvent }. 404 when the event is gone or has no
 * open, priceable market, which the client treats as "keep showing
 * what we have".
 */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug")?.trim();
  if (!slug) {
    return Response.json({ error: "slug is required" }, { status: 400 });
  }

  const ours = await getWorldstreetEventLive(slug).catch(() => null);
  if (ours) return Response.json({ event: ours });

  try {
    const event = await getBayseEventLive(slug);
    if (!event) {
      return Response.json({ error: "Event not found" }, { status: 404 });
    }
    return Response.json({ event });
  } catch (err) {
    const status = err instanceof BayseApiError ? (err.status ?? 502) : 502;
    return Response.json({ error: "Bayse request failed" }, { status });
  }
}
