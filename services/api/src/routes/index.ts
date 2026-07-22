import type { FastifyPluginAsync } from "fastify";
import { userRoutes } from "./users.js";
import { walletRoutes } from "./wallet.js";

export const apiRoutes: FastifyPluginAsync = async (app) => {
  await app.register(userRoutes);
  await app.register(walletRoutes);
};
