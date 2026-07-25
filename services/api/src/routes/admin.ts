import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate, type AuthenticatedUser } from "../auth.js";
import { ApiError } from "../errors.js";
import { getFxQuote } from "../trading/fx.js";
import { FxRate, Position, Settlement } from "../trading/models.js";
import {
  adminSettleMarket,
  adminVoidMarket,
} from "../trading/settlement.js";
import { fetchBayseEvent, winningOutcome } from "../trading/bayse.js";
import { getSettlementQueue } from "../trading/exposure.js";
import { sendAlert } from "../alerts.js";
import { config } from "../config.js";

/**
 * Admin surface for the Local markets book. Authorization is the
 * central Clerk role (publicMetadata.role === "admin") — the same
 * signal the rest of WorldStreet uses. Settlement here is manual and
 * final; the resolution desk should call GET /admin/markets/:eventId
 * first, which surfaces Bayse's own resolution to pre-fill the form.
 */

async function requireAdmin(request: FastifyRequest): Promise<AuthenticatedUser> {
  const user = await authenticate(request);
  if (user.role !== "admin") {
    throw new ApiError(403, "Admin access required", "FORBIDDEN");
  }
  return user;
}

const fxBody = z.object({
  /** Naira per USD mid rate. */
  usdToNgn: z.number().min(1).max(1_000_000),
});

const settleBody = z.object({
  eventId: z.string().uuid(),
  marketId: z.string().uuid(),
  winningOutcomeId: z.string().uuid(),
});

const voidBody = z.object({
  eventId: z.string().uuid(),
  marketId: z.string().uuid(),
  reason: z.string().min(3).max(500),
});

export const adminRoutes: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  /** Set the USD/NGN mid rate (history kept for audit). */
  app.post("/admin/fx-rate", { schema: { body: fxBody } }, async (request) => {
    const user = await requireAdmin(request);
    await FxRate.create({
      usdToNgn: request.body.usdToNgn,
      setBy: user.authUserId,
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
          triggeredBy: user.email,
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
   * Resolution-desk view of one event: our open exposure per market
   * next to Bayse's live status/resolution, so settlement is a
   * confirm-what-Bayse-says action rather than data entry.
   */
  app.get("/admin/markets/:eventId", async (request) => {
    await requireAdmin(request);
    const { eventId } = request.params as { eventId: string };
    const event = await fetchBayseEvent(eventId);

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
          title: event.title,
          status: event.status,
          resolutionDate: event.resolutionDate,
          markets: event.markets.map((m) => ({
            id: m.id,
            title: m.title,
            status: m.status,
            outcomes: m.outcomes,
            bayseResolvedOutcome: m.resolvedOutcome || null,
            bayseWinnerOutcomeId: winningOutcome(m)?.id ?? null,
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
    const event = await fetchBayseEvent(eventId);
    const market = event.markets.find((m) => m.id === marketId);
    if (!market) {
      throw new ApiError(404, "Market not found on this event", "MARKET_NOT_FOUND");
    }
    if (!market.outcomes.some((o) => o.id === winningOutcomeId)) {
      throw new ApiError(400, "Outcome does not belong to this market", "OUTCOME_NOT_FOUND");
    }

    const result = await adminSettleMarket({
      eventId,
      marketId,
      winningOutcomeId,
      actor: user.authUserId,
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
      actor: user.authUserId,
      log: request.log,
    });
    if (result.outcome === "already_settled") {
      throw new ApiError(409, "This market is already settled", "ALREADY_SETTLED");
    }
    return { success: true, data: result };
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
