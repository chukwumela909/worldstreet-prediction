import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { fetchTradableEvent, requireMarket } from "../trading/events.js";
import { isPolymarketId } from "../trading/polymarket/index.js";
import { getBookSettings } from "../trading/settings.js";
import {
  creditNaira,
  debitNaira,
  getNairaBalanceKobo,
  PAYOUT_PER_SHARE_KOBO,
} from "../trading/ledger.js";
import { eventOrMarketId, outcomeId } from "../trading/ids.js";
import { Position, type IPosition } from "../trading/models.js";

/**
 * Hold-to-settlement trades on both books — the Local one (Bayse-fed
 * events and WorldStreet's own fixed-odds ones) and the international
 * one (Polymarket events, priced at Polymarket plus the house spread —
 * see trading/polymarket/). WorldStreet is the counterparty every time:
 * the stake debits the user's naira ledger and the position pays
 * ₦100/share if settlement declares its outcome the winner. There is no
 * sell-back in v1.
 *
 * Price integrity: the client sends the price it showed the user
 * (`expectedPriceKobo`); the server re-reads the market at source —
 * Relay for a Bayse event, Gamma for a Polymarket one, our own row for
 * one of ours — and executes
 * at the fresh price only if it moved less than the tolerance,
 * otherwise 409 PRICE_MOVED with the fresh price for the client to
 * re-confirm. Fixed odds rarely trip that, but the desk can reprice
 * mid-session and this is what stops the stale quote filling.
 *
 * Countdown markets additionally close to new trades a cut-off before
 * their closing time, since a nearly-decided 15-minute market is pure
 * adverse selection.
 *
 * Every limit here — stake bounds, the price tolerance, the countdown
 * cut-off, the per-market exposure cap — and the international on/off
 * switch are the desk's book settings (trading/settings.ts), read per
 * order, so an admin's change applies to the next trade.
 */

const tradeBody = z.object({
  eventId: eventOrMarketId,
  marketId: eventOrMarketId,
  outcomeId,
  /** Stake in kobo. */
  stakeKobo: z.number().int().min(100 * 100), // ₦100 minimum, Bayse's own floor
  /** Price the user saw, kobo per share (1–9999). */
  expectedPriceKobo: z.number().int().min(1).max(9_999),
  idempotencyKey: z.string().min(8).max(128),
});

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

      const settings = await getBookSettings();
      const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-US")}`;

      // the international book opens only on the desk's switch — checked
      // by id shape before anything is fetched from Polymarket
      if (isPolymarketId(body.eventId) && !settings.internationalTrading) {
        throw new ApiError(
          409,
          "International markets aren't open for betting yet",
          "INTERNATIONAL_CLOSED",
        );
      }
      if (body.stakeKobo < settings.minStakeKobo) {
        throw new ApiError(
          400,
          `Minimum stake is ${naira(settings.minStakeKobo)}`,
          "STAKE_TOO_SMALL",
        );
      }
      if (body.stakeKobo > settings.maxStakeKobo) {
        throw new ApiError(
          400,
          `Maximum stake is ${naira(settings.maxStakeKobo)}`,
          "STAKE_TOO_LARGE",
        );
      }

      // fresh state at source — never the cached display feed
      const event = await fetchTradableEvent(body.eventId);
      if (event.status !== "open") {
        throw new ApiError(409, "This market is not open for trading", "MARKET_CLOSED");
      }
      const market = requireMarket(event, body.marketId);
      if (market.status !== "open") {
        throw new ApiError(409, "This market is not open for trading", "MARKET_CLOSED");
      }

      const closingMs = event.closingDate ? Date.parse(event.closingDate) : NaN;
      if (!Number.isNaN(closingMs)) {
        const cutoffMs =
          (event.countdown ? settings.countdownCutoffSeconds : 0) * 1000;
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

      const freshPriceKobo = outcome.priceKobo;
      if (freshPriceKobo < 1 || freshPriceKobo > 9_999) {
        throw new ApiError(409, "This outcome is not currently priceable", "MARKET_CLOSED");
      }
      if (Math.abs(freshPriceKobo - body.expectedPriceKobo) > settings.priceToleranceKobo) {
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
      if ((agg?.exposure ?? 0) + newExposure > settings.maxMarketExposureKobo) {
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
          source: event.origin === "polymarket" ? "polymarket" : "local",
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
    source: p.source ?? "local",
    createdAt: p.createdAt?.toISOString?.() ?? null,
    settledAt: p.settledAt?.toISOString() ?? null,
  };
}
