import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAdmin } from "../admin-auth.js";
import { ApiError } from "../errors.js";
import { getFxQuote } from "../trading/fx.js";
import { FxRate, LedgerEntry, Position, Settlement } from "../trading/models.js";
import {
  adminSettleMarket,
  adminVoidMarket,
} from "../trading/settlement.js";
import { fetchTradableEvent, requireMarket } from "../trading/events.js";
import { eventOrMarketId, outcomeId } from "../trading/ids.js";
import { getSettlementQueue } from "../trading/exposure.js";
import { listTraders, TRADER_SORTS, type TraderSort } from "../trading/traders.js";
import { getBookRisk } from "../trading/risk.js";
import { getSettingsView, updateBookSettings } from "../trading/settings.js";
import { sendAlert } from "../alerts.js";
import { config } from "../config.js";

/**
 * Admin surface for the Local markets book. Authorization is an admin
 * access key or the central Clerk admin role — see admin-auth.ts.
 * Settlement here is manual and final; the resolution desk should call
 * GET /admin/markets/:eventId first, which surfaces the source's own
 * resolution to pre-fill the form. Authoring Worldstreet's own markets
 * lives next door in admin-markets.ts.
 */

export { requireAdmin } from "../admin-auth.js";

const fxBody = z.object({
  /** Naira per USD mid rate. */
  usdToNgn: z.number().min(1).max(1_000_000),
});

const settleBody = z.object({
  eventId: eventOrMarketId,
  marketId: eventOrMarketId,
  winningOutcomeId: outcomeId,
});

const tradersQuery = z.object({
  /** Matches username, display name, email, or an exact Clerk user id. */
  search: z.string().trim().max(120).optional(),
  sort: z.enum(TRADER_SORTS).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  activeOnly: z.coerce.boolean().optional(),
});

/** Any subset of the book settings; bounds are checked in trading/settings.ts. */
const settingsBody = z
  .object({
    internationalTrading: z.boolean(),
    polymarketSpreadBps: z.number().int(),
    fxSpreadBps: z.number().int(),
    minStakeKobo: z.number().int(),
    maxStakeKobo: z.number().int(),
    maxMarketExposureKobo: z.number().int(),
    priceToleranceKobo: z.number().int(),
    countdownCutoffSeconds: z.number().int(),
  })
  .partial()
  .strict();

const voidBody = z.object({
  eventId: eventOrMarketId,
  marketId: eventOrMarketId,
  reason: z.string().min(3).max(500),
});

export const adminRoutes: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  /**
   * Who the request is, as far as the desk is concerned — what the
   * desk's unlock form calls to check a key before it keeps it.
   */
  app.get(
    "/admin/whoami",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request) => {
      const { label, via } = await requireAdmin(request);
      return { success: true, data: { label, via } };
    },
  );

  /** The book's pricing and limits, their defaults, bounds and change log. */
  app.get("/admin/settings", async (request) => {
    await requireAdmin(request);
    return { success: true, data: await getSettingsView() };
  });

  /**
   * Change any subset of the book's settings. Bounds and the min ≤ max
   * stake rule are checked in trading/settings.ts (400 INVALID_SETTINGS);
   * every value that actually moves is logged with the admin's email.
   */
  app.put("/admin/settings", { schema: { body: settingsBody } }, async (request) => {
    const user = await requireAdmin(request);
    const view = await updateBookSettings(request.body, user.label);
    request.log.info(
      { by: user.label, changed: Object.keys(request.body) },
      "book settings updated",
    );
    return { success: true, data: view };
  });

  /** Set the USD/NGN mid rate (history kept for audit). */
  app.post("/admin/fx-rate", { schema: { body: fxBody } }, async (request) => {
    const user = await requireAdmin(request);
    await FxRate.create({
      usdToNgn: request.body.usdToNgn,
      setBy: user.id,
    });
    const fx = await getFxQuote();
    return { success: true, data: { fx } };
  });

  /**
   * Send one alert through the real delivery path and report what
   * happened. Alerts only fire when a market is stuck, so without this
   * the first test of the mail configuration is an incident — and a
   * wrong key or an unverified sender fails silently into the logs.
   * Unthrottled deliberately: this is someone asking, not the poller.
   */
  app.post(
    "/admin/test-alert",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request) => {
      const user = await requireAdmin(request);
      const result = await sendAlert(
        request.log,
        "Test alert",
        {
          note: "Triggered from the admin desk to check alert delivery.",
          triggeredBy: user.label,
        },
      );
      return {
        success: true,
        data: {
          ...result,
          recipients: config.alertEmailTo.length,
          from: config.ALERT_EMAIL_FROM || null,
        },
      };
    },
  );

  /** The settlement queue — see trading/exposure.ts. */
  app.get("/admin/exposure", async (request) => {
    await requireAdmin(request);
    return { success: true, data: await getSettlementQueue() };
  });

  /**
   * What the open book could cost the house — see trading/risk.ts. The
   * margin in a price only pays if the money lands on both sides of it,
   * and this is the number that says whether it did.
   */
  app.get("/admin/risk", async (request) => {
    await requireAdmin(request);
    return { success: true, data: await getBookRisk() };
  });

  /**
   * Resolution-desk view of one event: our open exposure per market
   * next to the source's live status/resolution, so settling a Bayse
   * event is a confirm-what-Bayse-says action rather than data entry.
   * Works for our own events too, where the resolution half is
   * whatever the desk last recorded.
   */
  app.get("/admin/markets/:eventId", async (request) => {
    await requireAdmin(request);
    const { eventId } = request.params as { eventId: string };
    const event = await fetchTradableEvent(eventId);

    const exposures = await Position.aggregate<{
      _id: string;
      openPositions: number;
      stakeKobo: number;
      maxPayoutKobo: number;
    }>([
      { $match: { eventId, status: "open" } },
      {
        $group: {
          _id: "$marketId",
          openPositions: { $sum: 1 },
          stakeKobo: { $sum: "$stakeKobo" },
          maxPayoutKobo: { $sum: "$potentialPayoutKobo" },
        },
      },
    ]);
    const byMarket = new Map(exposures.map((e) => [e._id, e]));

    return {
      success: true,
      data: {
        event: {
          id: event.id,
          origin: event.origin,
          title: event.title,
          status: event.status,
          resolutionDate: event.resolutionDate,
          markets: event.markets.map((m) => ({
            id: m.id,
            title: m.title,
            status: m.status,
            outcomes: m.outcomes,
            resolvedOutcomeLabel: m.resolvedOutcomeLabel,
            winnerOutcomeId: m.resolvedOutcomeId,
            openPositions: byMarket.get(m.id)?.openPositions ?? 0,
            openStakeKobo: byMarket.get(m.id)?.stakeKobo ?? 0,
            maxPayoutKobo: byMarket.get(m.id)?.maxPayoutKobo ?? 0,
          })),
        },
      },
    };
  });

  /** Declare a winner and pay out — one shot per market, audited. */
  app.post("/admin/settle", { schema: { body: settleBody } }, async (request) => {
    const user = await requireAdmin(request);
    const { eventId, marketId, winningOutcomeId } = request.body;

    // the outcome must actually belong to the market being settled
    const event = await fetchTradableEvent(eventId);
    const market = requireMarket(event, marketId);
    if (!market.outcomes.some((o) => o.id === winningOutcomeId)) {
      throw new ApiError(400, "Outcome does not belong to this market", "OUTCOME_NOT_FOUND");
    }

    const result = await adminSettleMarket({
      eventId,
      marketId,
      winningOutcomeId,
      actor: user.id,
      log: request.log,
    });
    if (result.outcome === "already_settled") {
      throw new ApiError(409, "This market is already settled", "ALREADY_SETTLED");
    }
    return { success: true, data: result };
  });

  /** Void a market — refunds every open stake, audited. */
  app.post("/admin/void", { schema: { body: voidBody } }, async (request) => {
    const user = await requireAdmin(request);
    const result = await adminVoidMarket({
      eventId: request.body.eventId,
      marketId: request.body.marketId,
      reason: request.body.reason,
      actor: user.id,
      log: request.log,
    });
    if (result.outcome === "already_settled") {
      throw new ApiError(409, "This market is already settled", "ALREADY_SETTLED");
    }
    return { success: true, data: result };
  });

  /**
   * Who is playing the book. Everyone with a local profile, with what
   * they have staked, what they are still riding and what they have
   * realized next to it — the desk's people view, where /leaderboard is
   * the public winners view. `activeOnly=true` drops the accounts that
   * signed up and never staked.
   */
  app.get(
    "/admin/traders",
    { schema: { querystring: tradersQuery } },
    async (request) => {
      await requireAdmin(request);
      const { search, sort, limit, offset, activeOnly } = request.query;
      return {
        success: true,
        data: await listTraders({
          search,
          sort: sort as TraderSort,
          limit,
          offset,
          activeOnly,
        }),
      };
    },
  );

  /**
   * One person's play: their profile and their positions, newest first,
   * with the money movements that produced them. This is the answer to
   * "what has this account actually been doing" — the list view can
   * only say how much, not on what.
   */
  app.get("/admin/traders/:authUserId", async (request) => {
    await requireAdmin(request);
    const { authUserId } = request.params as { authUserId: string };

    const list = await listTraders({ search: authUserId, limit: 1 });
    const trader = list.traders.find((t) => t.authUserId === authUserId);
    if (!trader) {
      throw new ApiError(404, "No such trader", "USER_NOT_FOUND");
    }

    const [positions, ledger] = await Promise.all([
      Position.find({ authUserId }).sort({ createdAt: -1 }).limit(100).lean(),
      LedgerEntry.find({ authUserId }).sort({ createdAt: -1 }).limit(50).lean(),
    ]);

    return {
      success: true,
      data: {
        trader,
        positions: positions.map((p) => ({
          id: String(p._id),
          eventId: p.eventId,
          eventSlug: p.eventSlug,
          eventTitle: p.eventTitle,
          marketTitle: p.marketTitle,
          outcomeLabel: p.outcomeLabel,
          stakeKobo: p.stakeKobo,
          priceKobo: p.priceKobo,
          potentialPayoutKobo: p.potentialPayoutKobo,
          status: p.status,
          createdAt: p.createdAt?.toISOString?.() ?? null,
          settledAt: p.settledAt?.toISOString?.() ?? null,
        })),
        ledger: ledger.map((l) => ({
          id: String(l._id),
          type: l.type,
          amountKobo: l.amountKobo,
          balanceAfterKobo: l.balanceAfterKobo,
          description: l.description,
          createdAt: l.createdAt?.toISOString?.() ?? null,
        })),
      },
    };
  });

  /** Recent settlements, newest first — the audit trail. */
  app.get("/admin/settlements", async (request) => {
    await requireAdmin(request);
    const settlements = await Settlement.find().sort({ createdAt: -1 }).limit(100);
    return {
      success: true,
      data: {
        settlements: settlements.map((s) => ({
          id: String(s._id),
          eventId: s.eventId,
          marketId: s.marketId,
          winningOutcomeId: s.winningOutcomeId,
          voided: s.voided,
          source: s.source,
          actor: s.actor,
          positionsSettled: s.positionsSettled,
          payoutTotalKobo: s.payoutTotalKobo,
          createdAt: s.createdAt?.toISOString?.() ?? null,
        })),
      },
    };
  });
};
