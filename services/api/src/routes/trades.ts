import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../auth.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { fetchBayseEvent } from "../trading/bayse.js";
import {
  creditNaira,
  debitNaira,
  getNairaBalanceKobo,
  PAYOUT_PER_SHARE_KOBO,
} from "../trading/ledger.js";
import { Position, type IPosition } from "../trading/models.js";

/**
 * Hold-to-settlement trades on Bayse-fed Local markets. Worldstreet is
 * the counterparty: the stake debits the user's naira ledger and the
 * position pays ₦100/share if the admin/auto settlement declares its
 * outcome the winner. There is no sell-back in v1.
 *
 * Price integrity: the client sends the price it showed the user
 * (`expectedPriceKobo`); the server re-fetches Bayse LIVE and executes
 * at the fresh price only if it moved less than the tolerance —
 * otherwise 409 PRICE_MOVED with the fresh price, and the client
 * re-confirms. Countdown markets additionally close to new trades
 * `TRADE_COUNTDOWN_CUTOFF_SECONDS` before their closing time, since a
 * nearly-decided 15-minute market is pure adverse selection.
 */

const tradeBody = z.object({
  eventId: z.string().uuid(),
  marketId: z.string().uuid(),
  outcomeId: z.string().uuid(),
  /** Stake in kobo. */
  stakeKobo: z.number().int().min(100 * 100), // ₦100 minimum, Bayse's own floor
  /** Price the user saw, kobo per share (1–9999). */
  expectedPriceKobo: z.number().int().min(1).max(9_999),
  idempotencyKey: z.string().min(8).max(128),
});

/** |fresh − expected| tolerated before requiring re-confirmation. */
const PRICE_TOLERANCE_KOBO = 200; // ₦2 per ₦100 share = 2 percentage points

export const tradeRoutes: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/trades",
    {
      schema: { body: tradeBody },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { authUserId } = await authenticate(request);
      const body = request.body;

      // a retried request returns the original position, no new stake
      const existing = await Position.findOne({
        idempotencyKey: `${authUserId}:${body.idempotencyKey}`,
      });
      if (existing) {
        return {
          success: true,
          data: { position: serializePosition(existing), alreadyProcessed: true },
        };
      }

      if (body.stakeKobo > config.TRADE_MAX_STAKE_KOBO) {
        throw new ApiError(
          400,
          `Maximum stake is ₦${(config.TRADE_MAX_STAKE_KOBO / 100).toLocaleString("en-US")}`,
          "STAKE_TOO_LARGE",
        );
      }

      // fresh state from Bayse — never the cached display feed
      const event = await fetchBayseEvent(body.eventId);
      if (event.status !== "open") {
        throw new ApiError(409, "This market is not open for trading", "MARKET_CLOSED");
      }
      const market = event.markets.find((m) => m.id === body.marketId);
      if (!market) {
        throw new ApiError(404, "Market not found on this event", "MARKET_NOT_FOUND");
      }
      if (market.status !== "open") {
        throw new ApiError(409, "This market is not open for trading", "MARKET_CLOSED");
      }

      const closingMs = event.closingDate ? Date.parse(event.closingDate) : NaN;
      if (!Number.isNaN(closingMs)) {
        const cutoffMs =
          (event.countdown ? config.TRADE_COUNTDOWN_CUTOFF_SECONDS : 0) * 1000;
        if (Date.now() >= closingMs - cutoffMs) {
          throw new ApiError(
            409,
            event.countdown
              ? "This market is too close to closing to trade"
              : "This market has closed",
            "MARKET_CLOSING",
          );
        }
      }

      const outcome = market.outcomes.find((o) => o.id === body.outcomeId);
      if (!outcome) {
        throw new ApiError(404, "Outcome not found on this market", "OUTCOME_NOT_FOUND");
      }

      const freshPriceKobo = Math.round(outcome.price * PAYOUT_PER_SHARE_KOBO);
      if (freshPriceKobo < 1 || freshPriceKobo > 9_999) {
        throw new ApiError(409, "This outcome is not currently priceable", "MARKET_CLOSED");
      }
      if (Math.abs(freshPriceKobo - body.expectedPriceKobo) > PRICE_TOLERANCE_KOBO) {
        throw new ApiError(409, "The price moved — confirm the new price", "PRICE_MOVED", {
          freshPriceKobo,
        });
      }

      // house-exposure cap per market: what settlement could owe across
      // all open positions, beyond the stakes already collected
      const [agg] = await Position.aggregate<{ exposure: number }>([
        { $match: { marketId: body.marketId, status: "open" } },
        {
          $group: {
            _id: null,
            exposure: { $sum: { $subtract: ["$potentialPayoutKobo", "$stakeKobo"] } },
          },
        },
      ]);
      const shares = body.stakeKobo / freshPriceKobo;
      const potentialPayoutKobo = Math.floor(shares * PAYOUT_PER_SHARE_KOBO);
      const newExposure = potentialPayoutKobo - body.stakeKobo;
      if ((agg?.exposure ?? 0) + newExposure > config.TRADE_MAX_MARKET_EXPOSURE_KOBO) {
        throw new ApiError(
          409,
          "This market has reached its trading limit for now",
          "MARKET_LIMIT_REACHED",
        );
      }

      const idempotencyKey = `${authUserId}:${body.idempotencyKey}`;
      const debit = await debitNaira({
        authUserId,
        amountKobo: body.stakeKobo,
        type: "trade_stake",
        refKey: `trade:${idempotencyKey}`,
        description: `${outcome.label} — ${event.title}`,
        metadata: { eventId: event.id, marketId: market.id, outcomeId: outcome.id },
      });

      try {
        const position = await Position.create({
          authUserId,
          eventId: event.id,
          marketId: market.id,
          outcomeId: outcome.id,
          outcomeLabel: outcome.label,
          eventSlug: event.slug,
          eventTitle: event.title,
          marketTitle: market.title,
          stakeKobo: body.stakeKobo,
          priceKobo: freshPriceKobo,
          shares,
          potentialPayoutKobo,
          status: "open",
          idempotencyKey,
        });
        return {
          success: true,
          data: {
            position: serializePosition(position),
            balanceKobo: debit.balanceAfterKobo,
          },
        };
      } catch (err) {
        // position write failed after the stake was taken — refund
        const dup =
          err && typeof err === "object" && "code" in err && err.code === 11000;
        if (dup) {
          // concurrent retry created it first; the stake refKey deduped too
          const winner = await Position.findOne({ idempotencyKey });
          if (winner) {
            return {
              success: true,
              data: { position: serializePosition(winner), alreadyProcessed: true },
            };
          }
        }
        await creditNaira({
          authUserId,
          amountKobo: body.stakeKobo,
          type: "refund",
          refKey: `trade:${idempotencyKey}:reversal`,
          description: "Trade failed — stake returned",
        }).catch((repairErr) =>
          request.log.error(
            { err: repairErr, idempotencyKey },
            "trade compensation failed — manual repair needed",
          ),
        );
        throw err;
      }
    },
  );

  /** Open + settled positions with the naira balance, newest first. */
  app.get("/portfolio", async (request) => {
    const { authUserId } = await authenticate(request);
    const [positions, balanceKobo] = await Promise.all([
      Position.find({ authUserId }).sort({ createdAt: -1 }).limit(200),
      getNairaBalanceKobo(authUserId),
    ]);
    return {
      success: true,
      data: {
        balanceKobo,
        positions: positions.map(serializePosition),
      },
    };
  });
};

function serializePosition(p: IPosition & { createdAt?: Date | null }) {
  return {
    id: String(p._id),
    eventId: p.eventId,
    marketId: p.marketId,
    outcomeId: p.outcomeId,
    outcomeLabel: p.outcomeLabel,
    eventSlug: p.eventSlug,
    eventTitle: p.eventTitle,
    marketTitle: p.marketTitle,
    stakeKobo: p.stakeKobo,
    priceKobo: p.priceKobo,
    shares: p.shares,
    potentialPayoutKobo: p.potentialPayoutKobo,
    status: p.status,
    createdAt: p.createdAt?.toISOString?.() ?? null,
    settledAt: p.settledAt?.toISOString() ?? null,
  };
}
