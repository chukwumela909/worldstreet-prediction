import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../auth.js";

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.get("/user/me", async (request) => {
    const user = await authenticate(request);

    return {
      success: true,
      data: {
        user: {
          id: String(user.dbUser._id),
          authUserId: user.authUserId,
          email: user.email,
          username: user.dbUser.username,
          displayName: user.dbUser.displayName,
          avatar: user.dbUser.avatar,
          role: user.role,
        },
      },
    };
  });
};
