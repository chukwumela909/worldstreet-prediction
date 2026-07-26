import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { requireAdmin } from "./admin.js";
import {
  Position,
  WorldstreetEvent,
  WorldstreetMarket,
  type IWorldstreetMarket,
} from "../trading/models.js";
import {
  activityByEvent,
  exposureByMarket,
  serializeAdminEvent,
  type AdminEvent,
} from "../trading/serialize.js";
import {
  assertPriceable,
  loadWorldstreetEvent,
  uniqueSlug,
} from "../trading/worldstreet.js";

/**
 * Authoring Worldstreet's own markets. Everything here is admin-only
 * and writes the rows that trading/events.ts then serves to the trade
 * route, the settlement engine and the public feed.
 *
 * Two rules shape the whole surface:
 *
 *  - **Ids are permanent.** Positions denormalize titles but reference
 *    outcome ids, so an edit can change what an outcome is called and
 *    what it costs, never which id it is. Outcomes are matched by
 *    position in the array; a market always has exactly two.
 *  - **Money is a one-way door.** A market that has ever been traded
 *    can't be deleted, only closed, cancelled or settled — the audit
 *    trail has to keep pointing at something.
 *
 * Resolution is not here: settling one of these pays real balances out
 * and goes through the same POST /admin/settle as a Bayse market.
 */

/** Mirrors CATEGORIES in types/market.ts — the site's own filter tabs. */
const CATEGORIES = [
  "Trending",
  "Politics",
  "Sports",
  "Crypto",
  "Esports",
  "Finance",
  "Geopolitics",
  "Tech",
  "Culture",
  "Economy",
  "Weather",
] as const;

const outcomeInput = z.object({
  label: z.string().min(1).max(40),
  /** Kobo per ₦100 share; the real bounds live in assertPriceable. */
  priceKobo: z.number().int(),
});

const marketInput = z.object({
  title: z.string().min(1).max(200),
  rules: z.string().max(4_000).optional(),
  outcomes: z.array(outcomeInput).length(2),
});

const createBody = z.object({
  title: z.string().min(3).max(200),
  category: z.enum(CATEGORIES).default("Trending"),
  description: z.string().max(4_000).optional(),
  imageUrl: z.string().max(500).optional(),
  resolutionSource: z.string().max(500).optional(),
  /** ISO instants; omit for "no deadline yet". */
  closesAt: z.string().nullish(),
  resolutionDate: z.string().nullish(),
  /** Publish straight away, or keep it off the site while it's written. */
  status: z.enum(["draft", "open"]).default("draft"),
  markets: z.array(marketInput).min(1).max(12),
});

const eventPatch = z.object({
  title: z.string().min(3).max(200).optional(),
  category: z.enum(CATEGORIES).optional(),
  description: z.string().max(4_000).optional(),
  imageUrl: z.string().max(500).optional(),
  resolutionSource: z.string().max(500).optional(),
  closesAt: z.string().nullish(),
  resolutionDate: z.string().nullish(),
  status: z.enum(["draft", "open", "closed", "cancelled"]).optional(),
});

const marketPatch = z.object({
  title: z.string().min(1).max(200).optional(),
  rules: z.string().max(4_000).optional(),
  status: z.enum(["open", "closed"]).optional(),
  /** Positional — [0] and [1] keep the ids they already have. */
  outcomes: z.array(outcomeInput).length(2).optional(),
});

const eventParams = z.object({ eventId: z.string().uuid() });
const marketParams = z.object({
  eventId: z.string().uuid(),
  marketId: z.string().uuid(),
});

/* ------------------------------------------------------------------ */
/* Input normalization                                                 */
/* ------------------------------------------------------------------ */

/** `undefined` leaves a field alone; `null`/"" clears it. */
function parseInstant(
  value: string | null | undefined,
  field: string,
): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === "") return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new ApiError(400, `${field} is not a valid date`, "BAD_DATE");
  }
  return new Date(ms);
}

/**
 * Icons and resolution sources are rendered as an image and a link on a
 * public page, so only absolute https URLs get through. Empty is fine —
 * the site falls back to the emoji tile and hides the link.
 */
function httpsUrl(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return "";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ApiError(400, `${field} must be a full https:// URL`, "BAD_URL");
  }
  if (url.protocol !== "https:") {
    throw new ApiError(400, `${field} must be a full https:// URL`, "BAD_URL");
  }
  return url.toString();
}

/** Present keys only — so a PATCH can't blank a field it never sent. */
function assign<T extends object>(
  target: T,
  patch: { [K in keyof T]?: T[K] | undefined },
): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

async function adminView(eventId: string): Promise<AdminEvent> {
  const record = await loadWorldstreetEvent(eventId);
  if (!record) {
    throw new ApiError(404, "Market not found", "EVENT_NOT_FOUND");
  }
  const [activity, exposure] = await Promise.all([
    activityByEvent([eventId]),
    exposureByMarket(record.markets.map((m) => m.marketId)),
  ]);
  return serializeAdminEvent(
    record.event,
    record.markets,
    activity.get(eventId) ?? { trades: 0, stakedKobo: 0 },
    exposure,
  );
}

export const adminMarketRoutes: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  /** Every market we've written, newest first, with its exposure. */
  app.get("/admin/worldstreet/events", async (request) => {
    await requireAdmin(request);

    const events = await WorldstreetEvent.find().sort({ createdAt: -1 }).limit(200);
    if (events.length === 0) {
      return { success: true, data: { events: [] } };
    }

    const eventIds = events.map((e) => e.eventId);
    const markets = await WorldstreetMarket.find({
      eventId: { $in: eventIds },
    }).sort({ order: 1, createdAt: 1 });

    const [activity, exposure] = await Promise.all([
      activityByEvent(eventIds),
      exposureByMarket(markets.map((m) => m.marketId)),
    ]);

    return {
      success: true,
      data: {
        events: events.map((event) =>
          serializeAdminEvent(
            event,
            markets.filter((m) => m.eventId === event.eventId),
            activity.get(event.eventId) ?? { trades: 0, stakedKobo: 0 },
            exposure,
          ),
        ),
      },
    };
  });

  app.get(
    "/admin/worldstreet/events/:eventId",
    { schema: { params: eventParams } },
    async (request) => {
      await requireAdmin(request);
      return { success: true, data: { event: await adminView(request.params.eventId) } };
    },
  );

  /* ---------------------------------------------------------------- */
  /* Writes                                                            */
  /* ---------------------------------------------------------------- */

  /** Create an event and its markets in one shot. */
  app.post(
    "/admin/worldstreet/events",
    { schema: { body: createBody } },
    async (request, reply) => {
      const user = await requireAdmin(request);
      const body = request.body;

      for (const market of body.markets) assertPriceable(market.outcomes);

      const event = await WorldstreetEvent.create({
        slug: await uniqueSlug(body.title),
        title: body.title.trim(),
        category: body.category,
        description: body.description?.trim() ?? "",
        imageUrl: httpsUrl(body.imageUrl, "Image URL") ?? "",
        resolutionSource:
          httpsUrl(body.resolutionSource, "Resolution source") ?? "",
        status: body.status,
        closesAt: parseInstant(body.closesAt, "Closing time") ?? null,
        resolutionDate: parseInstant(body.resolutionDate, "Resolution date") ?? null,
        createdBy: user.authUserId,
      });

      try {
        await WorldstreetMarket.insertMany(
          body.markets.map((market, index) => ({
            eventId: event.eventId,
            title: market.title.trim(),
            rules: market.rules?.trim() ?? "",
            status: "open",
            order: index,
            outcomes: market.outcomes.map((o) => ({
              label: o.label.trim(),
              priceKobo: o.priceKobo,
            })),
          })),
        );
      } catch (err) {
        // an event with no markets is unusable and un-listable; don't
        // leave one behind for the desk to puzzle over
        await WorldstreetEvent.deleteOne({ _id: event._id });
        throw err;
      }

      return reply
        .code(201)
        .send({ success: true, data: { event: await adminView(event.eventId) } });
    },
  );

  /** Edit the event itself — copy, timing, and whether it's listed. */
  app.patch(
    "/admin/worldstreet/events/:eventId",
    { schema: { params: eventParams, body: eventPatch } },
    async (request) => {
      await requireAdmin(request);
      const { eventId } = request.params;
      const body = request.body;

      const event = await WorldstreetEvent.findOne({ eventId });
      if (!event) throw new ApiError(404, "Market not found", "EVENT_NOT_FOUND");
      if (event.status === "resolved") {
        throw new ApiError(
          409,
          "This market is settled — its record can't be edited",
          "ALREADY_SETTLED",
        );
      }

      assign(event, {
        title: body.title?.trim(),
        category: body.category,
        description: body.description?.trim(),
        imageUrl: httpsUrl(body.imageUrl, "Image URL"),
        resolutionSource: httpsUrl(body.resolutionSource, "Resolution source"),
        status: body.status,
        closesAt: parseInstant(body.closesAt, "Closing time"),
        resolutionDate: parseInstant(body.resolutionDate, "Resolution date"),
      });
      if (body.title) {
        event.slug = await uniqueSlug(body.title, eventId);
      }
      await event.save();

      return { success: true, data: { event: await adminView(eventId) } };
    },
  );

  /** Add another market to an existing event. */
  app.post(
    "/admin/worldstreet/events/:eventId/markets",
    { schema: { params: eventParams, body: marketInput } },
    async (request, reply) => {
      await requireAdmin(request);
      const { eventId } = request.params;
      const body = request.body;

      const event = await WorldstreetEvent.findOne({ eventId });
      if (!event) throw new ApiError(404, "Market not found", "EVENT_NOT_FOUND");
      if (event.status === "resolved" || event.status === "cancelled") {
        throw new ApiError(409, "This market is closed out", "EVENT_CLOSED");
      }
      assertPriceable(body.outcomes);

      const last = await WorldstreetMarket.findOne({ eventId }).sort({ order: -1 });
      await WorldstreetMarket.create({
        eventId,
        title: body.title.trim(),
        rules: body.rules?.trim() ?? "",
        status: "open",
        order: (last?.order ?? -1) + 1,
        outcomes: body.outcomes.map((o) => ({
          label: o.label.trim(),
          priceKobo: o.priceKobo,
        })),
      });

      return reply
        .code(201)
        .send({ success: true, data: { event: await adminView(eventId) } });
    },
  );

  /**
   * Edit one market — including its prices, which is how the desk moves
   * the odds. Outcome ids survive: positions already taken keep pointing
   * at the same side of the same question, they just no longer match the
   * price on offer, which is exactly what repricing means.
   */
  app.patch(
    "/admin/worldstreet/events/:eventId/markets/:marketId",
    { schema: { params: marketParams, body: marketPatch } },
    async (request) => {
      await requireAdmin(request);
      const { eventId, marketId } = request.params;
      const body = request.body;

      const market = await WorldstreetMarket.findOne({ eventId, marketId });
      if (!market) throw new ApiError(404, "Market not found", "MARKET_NOT_FOUND");
      if (market.status === "resolved" || market.status === "cancelled") {
        throw new ApiError(
          409,
          "This market is settled — its record can't be edited",
          "ALREADY_SETTLED",
        );
      }

      if (body.outcomes) {
        assertPriceable(body.outcomes);
        market.outcomes = market.outcomes.map((existing, index) => {
          const next = body.outcomes![index]!;
          return {
            outcomeId: existing.outcomeId,
            label: next.label.trim(),
            priceKobo: next.priceKobo,
          };
        }) as IWorldstreetMarket["outcomes"];
      }
      assign(market, {
        title: body.title?.trim(),
        rules: body.rules?.trim(),
        status: body.status,
      });
      await market.save();

      return { success: true, data: { event: await adminView(eventId) } };
    },
  );

  /* ---------------------------------------------------------------- */
  /* Deletes — only what nobody has money on                           */
  /* ---------------------------------------------------------------- */

  app.delete(
    "/admin/worldstreet/events/:eventId/markets/:marketId",
    { schema: { params: marketParams } },
    async (request) => {
      await requireAdmin(request);
      const { eventId, marketId } = request.params;

      const market = await WorldstreetMarket.findOne({ eventId, marketId });
      if (!market) throw new ApiError(404, "Market not found", "MARKET_NOT_FOUND");

      if (await Position.exists({ marketId })) {
        throw new ApiError(
          409,
          "This market has been traded — cancel or settle it instead of deleting it",
          "HAS_POSITIONS",
        );
      }
      if ((await WorldstreetMarket.countDocuments({ eventId })) <= 1) {
        throw new ApiError(
          409,
          "An event needs at least one market — delete the whole event instead",
          "LAST_MARKET",
        );
      }
      await WorldstreetMarket.deleteOne({ _id: market._id });

      return { success: true, data: { event: await adminView(eventId) } };
    },
  );

  app.delete(
    "/admin/worldstreet/events/:eventId",
    { schema: { params: eventParams } },
    async (request) => {
      await requireAdmin(request);
      const { eventId } = request.params;

      const event = await WorldstreetEvent.findOne({ eventId });
      if (!event) throw new ApiError(404, "Market not found", "EVENT_NOT_FOUND");

      if (await Position.exists({ eventId })) {
        throw new ApiError(
          409,
          "This market has been traded — cancel or settle it instead of deleting it",
          "HAS_POSITIONS",
        );
      }
      await WorldstreetMarket.deleteMany({ eventId });
      await WorldstreetEvent.deleteOne({ _id: event._id });

      return { success: true, data: { deleted: eventId } };
    },
  );
};
