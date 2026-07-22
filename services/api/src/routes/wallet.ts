import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { getWalletUsdBalance, isWalletConfigured } from "../wallet.js";

export const walletRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/wallet/balance",
    {
      config: {
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      if (!isWalletConfigured()) {
        throw new ApiError(503, "The wallet service is unavailable", "WALLET_UNAVAILABLE");
      }

      const { authUserId } = await authenticate(request);
      const result = await getWalletUsdBalance(authUserId);

      if (!result.ok) {
        request.log.error(
          { code: result.code, msg: result.message },
          "wallet balance lookup failed",
        );
        throw new ApiError(503, "Could not read your wallet balance", "WALLET_UNAVAILABLE");
      }

      const usd = result.data.balances.USD;
      return {
        success: true,
        data: {
          availableUsdMinor: usd.availableMinor,
          lockedUsdMinor: usd.lockedMinor,
          currency: "USD",
        },
      };
    },
  );
};
