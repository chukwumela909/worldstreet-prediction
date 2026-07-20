import { getComments } from "@/lib/polymarket";

/**
 * Filtered comments for an event, for the hero marquee.
 *
 *   GET /api/comments?eventId=411239
 *   → { comments: EventComment[] }
 *
 * Proxied server-side like the other Gamma reads: one cached request per
 * event instead of one per visitor, and the report-count/username-privacy
 * filtering happens before anything reaches the client.
 */
export async function GET(request: Request) {
  const eventId = new URL(request.url).searchParams.get("eventId") ?? "";
  // Gamma event ids are numeric; anything else can't have comments
  if (!/^\d+$/.test(eventId)) {
    return Response.json({ error: "Invalid eventId" }, { status: 400 });
  }

  try {
    return Response.json({ comments: await getComments(eventId) });
  } catch {
    return Response.json({ error: "Comments unavailable" }, { status: 502 });
  }
}
