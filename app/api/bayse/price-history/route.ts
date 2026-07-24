import {
  BAYSE_TIMEFRAMES,
  BayseApiError,
  getBaysePriceHistory,
  type BayseTimeframe,
} from "@/lib/bayse";

/**
 * GET /api/bayse/price-history?eventId=<uuid>&window=24H
 *
 * Yes-price history for every market of one Bayse event, keyed by
 * market id — the client half of the /local/[slug] chart's timeframe
 * switching. Shape: { series: { [marketId]: {t, p}[] } }.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("eventId");
  const window = searchParams.get("window") ?? "24H";

  if (!eventId) {
    return Response.json({ error: "eventId is required" }, { status: 400 });
  }
  if (!(BAYSE_TIMEFRAMES as readonly string[]).includes(window)) {
    return Response.json({ error: "unknown window" }, { status: 400 });
  }

  try {
    const series = await getBaysePriceHistory(eventId, window as BayseTimeframe);
    return Response.json({ series });
  } catch (err) {
    const status = err instanceof BayseApiError ? (err.status ?? 502) : 502;
    return Response.json({ error: "Bayse request failed" }, { status });
  }
}
