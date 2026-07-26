import type { FastifyPluginAsync } from "fastify";
import { adminRoutes } from "./admin.js";
import { adminMarketRoutes } from "./admin-markets.js";
import { leaderboardRoutes } from "./leaderboard.js";
import { marketRoutes } from "./markets.js";
import { ngnWalletRoutes } from "./ngn-wallet.js";
import { tradeRoutes } from "./trades.js";
import { userRoutes } from "./users.js";
import { walletRoutes } from "./wallet.js";

export const apiRoutes: FastifyPluginAsync = async (app) => {
  await app.register(userRoutes);
  await app.register(walletRoutes);
  await app.register(ngnWalletRoutes);
  await app.register(marketRoutes);
  await app.register(tradeRoutes);
  await app.register(leaderboardRoutes);
  await app.register(adminRoutes);
  await app.register(adminMarketRoutes);
};
