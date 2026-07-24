import type { FastifyPluginAsync } from "fastify";
import { adminRoutes } from "./admin.js";
import { ngnWalletRoutes } from "./ngn-wallet.js";
import { tradeRoutes } from "./trades.js";
import { userRoutes } from "./users.js";
import { walletRoutes } from "./wallet.js";

export const apiRoutes: FastifyPluginAsync = async (app) => {
  await app.register(userRoutes);
  await app.register(walletRoutes);
  await app.register(ngnWalletRoutes);
  await app.register(tradeRoutes);
  await app.register(adminRoutes);
};
