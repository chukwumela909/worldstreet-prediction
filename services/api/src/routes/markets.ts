import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { WorldstreetEvent, WorldstreetMarket } from "../trading/models.js";
import { activityByEvent, serializeEvent } from "../trading/serialize.js";

/**
 * The public feed of Worldstreet's own markets — what the site's Local
 * tab lists alongside the Bayse events, and what /local/[slug] renders.
 *
 * Deliberately unauthenticated: this is the same read anyone gets by
 * loading the page, and the Next server calls it during SSR where there
 * is no session to forward. Nothing here exposes anything a visitor
 * couldn't see on the page itself — drafts never leave the desk.
 */

const LISTED_STATUSES = ["open", "closed"] as const;
const MAX_LISTED = 60;

export const marketRoutes: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  /** Live markets, soonest to close first, undated ones last. */
  app.get("/markets", async () => {
    const events = await WorldstreetEvent.find({
      status: { $in: LISTED_STATUSES },
    }).limit(MAX_LISTED);
    if (events.length === 0) return { success: true, data: { events: [] } };

    const eventIds = events.map((e) => e.eventId);
    const [markets, activity] = await Promise.all([
      WorldstreetMarket.find({
        eventId: { $in: eventIds },
        status: { $ne: "cancelled" },
      }).sort({ order: 1, createdAt: 1 }),
      activityByEvent(eventIds),
    ]);

    const ordered = [...events].sort((a, b) => {
      const at = a.closesAt?.getTime() ?? Infinity;
      const bt = b.closesAt?.getTime() ?? Infinity;
      return at - bt;
    });

    return {
      success: true,
      data: {
        events: ordered.map((event) =>
          serializeEvent(
            event,
            markets.filter((m) => m.eventId === event.eventId),
            activity.get(event.eventId),
          ),
        ),
      },
    };
  });

  /**
   * One market by slug. Settled and cancelled events still resolve —
   * a link someone was sent should show the result, not a 404. Drafts
   * do not exist as far as this route is concerned.
   */
  app.get(
    "/markets/slug/:slug",
    { schema: { params: z.object({ slug: z.string().min(1).max(120) }) } },
    async (request) => {
      const event = await WorldstreetEvent.findOne({
        slug: request.params.slug,
        status: { $ne: "draft" },
      });
      if (!event) {
        throw new ApiError(404, "Market not found", "EVENT_NOT_FOUND");
      }

      const [markets, activity] = await Promise.all([
        WorldstreetMarket.find({ eventId: event.eventId }).sort({
          order: 1,
          createdAt: 1,
        }),
        activityByEvent([event.eventId]),
      ]);

      return {
        success: true,
        data: {
          event: serializeEvent(event, markets, activity.get(event.eventId)),
        },
      };
    },
  );
};
