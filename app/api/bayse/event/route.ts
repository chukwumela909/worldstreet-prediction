import { BayseApiError, getBayseEventLive } from "@/lib/bayse";

/**
 * GET /api/bayse/event?slug=<slug>
 *
 * One Bayse event with fresh prices, for the /local/[slug] poller —
 * the Local counterpart of /api/events. Shape: { event: MarketEvent }.
 * 404 when the event is gone or has no open, priceable market, which
 * the client treats as "keep showing what we have".
 */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug")?.trim();
  if (!slug) {
    return Response.json({ error: "slug is required" }, { status: 400 });
  }

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
