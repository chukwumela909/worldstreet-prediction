import { getTopHolders } from "@/lib/polymarket";

/**
 * Top holders per side of a market, for the event page's Top Holders tab.
 *
 *   GET /api/holders?market=0x<conditionId>
 *   → { yes: MarketHolder[], no: MarketHolder[] }
 *
 * Proxied server-side like the other Polymarket reads: one cached
 * request per market instead of one per visitor.
 */
export async function GET(request: Request) {
  const market = new URL(request.url).searchParams.get("market") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(market)) {
    return Response.json({ error: "Invalid market" }, { status: 400 });
  }

  try {
    return Response.json(await getTopHolders(market));
  } catch {
    return Response.json({ error: "Holders unavailable" }, { status: 502 });
  }
}
