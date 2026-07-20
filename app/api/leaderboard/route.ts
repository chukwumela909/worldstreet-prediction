import {
  getLeaderboard,
  LEADERBOARD_WINDOWS,
  type LeaderboardRankType,
  type LeaderboardWindow,
} from "@/lib/polymarket";

/**
 * Ranked traders by profit or volume, for the leaderboard page.
 *
 *   GET /api/leaderboard?window=30d&sort=pnl
 *   → { traders: LeaderboardTrader[] }
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const window = params.get("window") ?? "";
  const sort = params.get("sort") ?? "pnl";

  if (
    !(LEADERBOARD_WINDOWS as readonly string[]).includes(window) ||
    (sort !== "pnl" && sort !== "vol")
  ) {
    return Response.json({ error: "Invalid window or sort" }, { status: 400 });
  }

  try {
    return Response.json({
      traders: await getLeaderboard(
        window as LeaderboardWindow,
        sort as LeaderboardRankType,
      ),
    });
  } catch {
    return Response.json({ error: "Leaderboard unavailable" }, { status: 502 });
  }
}
