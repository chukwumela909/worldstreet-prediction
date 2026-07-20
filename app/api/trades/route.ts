import { getEventTrades } from "@/lib/polymarket";

/**
 * Recent trades across an event's markets, for the Activity tab.
 *
 *   GET /api/trades?event=16612
 *   → { trades: EventTrade[] }
 */
export async function GET(request: Request) {
  const event = new URL(request.url).searchParams.get("event") ?? "";
  // Gamma event ids are numeric
  if (!/^\d+$/.test(event)) {
    return Response.json({ error: "Invalid event" }, { status: 400 });
  }

  try {
    return Response.json({ trades: await getEventTrades(event) });
  } catch {
    return Response.json({ error: "Trades unavailable" }, { status: 502 });
  }
}
