import type { FastifyPluginAsync } from "fastify";
import { ApiError } from "../errors.js";
import {
  getLeaderboard,
  LEADERBOARD_SORTS,
  LEADERBOARD_WINDOWS,
  type LeaderboardSort,
  type LeaderboardWindow,
} from "../trading/leaderboard.js";

/**
 * Public trader rankings over the Local book.
 *
 * Deliberately unauthenticated: a leaderboard is a shop window, and
 * requiring a session would hide it from exactly the people it exists to
 * attract. It exposes only what a ranked trader has already agreed to
 * publish — display name, avatar, and their own totals. No user ids, no
 * balances, no per-position detail.
 */
export const leaderboardRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/leaderboard",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request) => {
      const query = request.query as Record<string, string | undefined>;
      const window = query.window ?? "30d";
      const sort = query.sort ?? "pnl";
      const limit = Math.min(Math.max(Number(query.limit) || 30, 1), 100);

      if (!(LEADERBOARD_WINDOWS as readonly string[]).includes(window)) {
        throw new ApiError(
          400,
          `window must be one of ${LEADERBOARD_WINDOWS.join(", ")}`,
          "INVALID_WINDOW",
        );
      }
      if (!(LEADERBOARD_SORTS as readonly string[]).includes(sort)) {
        throw new ApiError(
          400,
          `sort must be one of ${LEADERBOARD_SORTS.join(", ")}`,
          "INVALID_SORT",
        );
      }

      const traders = await getLeaderboard(
        window as LeaderboardWindow,
        sort as LeaderboardSort,
        limit,
      );
      return { success: true, data: { traders } };
    },
  );
};
