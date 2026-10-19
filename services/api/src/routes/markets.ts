import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { getBookSettings } from "../trading/settings.js";
import { risesFor } from "../trading/margin.js";
import { eventOrMarketId } from "../trading/ids.js";
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

/** Markets one rises request may ask about. */
const MAX_RISE_MARKETS = 50;
const risesQuery = z.object({
  /** Comma-separated market ids. */
  marketIds: z.string().min(1).max(4_000),
});
const MAX_LISTED = 60;

export const marketRoutes: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  /**
   * What the web app needs to quote and gate trades: whether the
   * international book is open, the spread added to Polymarket's price,
   * and the stake bounds. All of it is admin-set (trading/settings.ts),
   * so each number lives in one place and what a visitor is quoted is
   * what the trade route will fill at. Public for the same reason as the
   * feed below: any visitor sees these prices on the page.
   */
  app.get("/markets/pricing", async () => {
    const s = await getBookSettings();
    return {
      success: true,
      data: {
        internationalTrading: s.internationalTrading,
        polymarketSpreadBps: s.polymarketSpreadBps,
        localSpreadBps: s.localSpreadBps,
        autoSpreadStepKobo: s.autoSpreadStepKobo,
        minStakeKobo: s.minStakeKobo,
        maxStakeKobo: s.maxStakeKobo,
      },
    };
  });

  /**
   * The automatic rise on each side of the given markets right now
   * (trading/margin.ts) — what the bet slip adds to show the price an
   * order will actually be charged. Only sides with a rise appear.
   * Public like the pricing above: the price on the page shows it anyway.
   */
  app.get(
    "/markets/rises",
    {
      schema: { querystring: risesQuery },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (request) => {
      const ids = [
        ...new Set(
          request.query.marketIds
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ];
      if (ids.length > MAX_RISE_MARKETS || ids.some((id) => !eventOrMarketId.safeParse(id).success)) {
        throw new ApiError(400, "Up to 50 valid market ids", "INVALID_MARKET_IDS");
      }
      const rises = await risesFor(ids, await getBookSettings());
      return {
        success: true,
        data: {
          rises: Object.fromEntries(
            [...rises].map(([marketId, sides]) => [marketId, Object.fromEntries(sides)]),
          ),
        },
      };
    },
  );

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
