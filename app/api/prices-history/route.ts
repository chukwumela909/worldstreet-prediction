import { getPriceHistory } from "@/lib/polymarket";
import type { HistoryWindow, SeriesPoint } from "@/lib/series";

/**
 * Real price history for the charts.
 *
 *   GET /api/prices-history?tokens=<id>,<id>&window=1D
 *   → { series: { [tokenId]: [{ t, p }] } }
 *
 * Proxied server-side rather than called from the browser so the CLOB
 * sees one cached request per window instead of one per visitor (its
 * rate limits are per-IP), and so a Polymarket outage or geoblock
 * surfaces as a clean 502 the chart can fall back from.
 */

const WINDOWS: HistoryWindow[] = ["1H", "6H", "1D", "1W", "1M", "ALL", "HERO"];
/** One chart draws at most 3 lines. */
const MAX_TOKENS = 3;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const window = params.get("window") ?? "";
  if (!WINDOWS.includes(window as HistoryWindow)) {
    return Response.json(
      { error: `Unknown window "${window}"` },
      { status: 400 },
    );
  }

  const tokens = (params.get("tokens") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, MAX_TOKENS);
  if (tokens.length === 0) {
    return Response.json({ error: "No tokens requested" }, { status: 400 });
  }

  const results = await Promise.allSettled(
    tokens.map((token) => getPriceHistory(token, window as HistoryWindow)),
  );

  // one dead token shouldn't blank the whole chart — omit it and let the
  // others draw; only a total failure is worth a 502
  const series: Record<string, SeriesPoint[]> = {};
  results.forEach((result, i) => {
    if (result.status === "fulfilled") series[tokens[i]] = result.value;
  });

  if (Object.keys(series).length === 0) {
    return Response.json(
      { error: "Price history unavailable" },
      { status: 502 },
    );
  }

  return Response.json({ series });
}
