import type { FastifyBaseLogger, FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { assertNotSuspended } from "../accounts.js";
import { sendAlert } from "../alerts.js";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { fetchTradableEvent, requireMarket } from "../trading/events.js";
import { isPolymarketId } from "../trading/polymarket/index.js";
import { getBookSettings } from "../trading/settings.js";
import { baseMarginBps, quotedPriceKobo, risesFor } from "../trading/margin.js";
import {
  creditNaira,
  debitNaira,
  findExistingEntry,
  getNairaBalanceKobo,
  PAYOUT_PER_SHARE_KOBO,
} from "../trading/ledger.js";
import { eventOrMarketId, outcomeId } from "../trading/ids.js";
import { withMarketLock } from "../trading/market-lock.js";
import { isPausedMarket } from "../trading/paused.js";
import { checkBookLimit } from "../trading/book-limit.js";
import { Position, Settlement, type IPosition } from "../trading/models.js";

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
 * one of ours — adds the house margin (the book's base plus any
 * automatic rise on an exposed side, trading/margin.ts), and executes
 * at the fresh price only if it moved less than the tolerance,
 * otherwise 409 PRICE_MOVED with the fresh price for the client to
 * re-confirm. Fixed odds rarely trip that, but the desk can reprice
 * mid-session and this is what stops the stale quote filling.
 *
 * Countdown markets additionally close to new trades a cut-off before
 * their closing time, since a nearly-decided 15-minute market is pure
 * adverse selection. A Bayse game closes at kickoff (409 GAME_STARTED),
 * not at Bayse's own closing time three hours later.
 *
 * Money integrity: a market fills one order at a time, from the
 * loss-limit check to the position write (trading/market-lock.ts), so
 * orders arriving together can't overrun the limit. If the position
 * write fails, the stake is returned; a retry of that order is refused
 * with 409 ORDER_REFUNDED instead of filling with no stake, and the bet
 * slip starts a fresh order.
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
      return placeOrder(authUserId, request.body, request.log);
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

export type TradeBody = z.infer<typeof tradeBody>;

/**
 * One order for a signed-in user — all of POST /trades after sign-in,
 * exported so the smoke tests can drive it without Clerk.
 */
export async function placeOrder(authUserId: string, body: TradeBody, log: FastifyBaseLogger) {
  const idempotencyKey = `${authUserId}:${body.idempotencyKey}`;
  const stakeRef = `trade:${idempotencyKey}`;
  /** A retried request returns the original position, no new stake. */
  const alreadyPlaced = async () => {
    const existing = await Position.findOne({ idempotencyKey });
    return existing
      ? {
          success: true,
          data: { position: serializePosition(existing), alreadyProcessed: true },
        }
      : null;
  };

  const placed = await alreadyPlaced();
  if (placed) return placed;

  // a suspended account places nothing new (accounts.ts)
  await assertNotSuspended(authUserId);

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
  // one the desk has already settled or voided takes nothing new, even
  // while its source still lists it open: a bet placed now could never
  // settle (a market settles once — its Settlement row is unique)
  if (await Settlement.exists({ marketId: market.id })) {
    throw new ApiError(409, "This market is not open for trading", "MARKET_CLOSED");
  }

  // the desk's emergency stop for a topic (trading/paused.ts)
  if (isPausedMarket(settings.pausedTopics, event.title, event.slug, market.title)) {
    throw new ApiError(409, "This market is paused for now", "MARKET_PAUSED");
  }

  // A game stops taking bets at kickoff: in play, anyone watching knows
  // more than the price we copy. One whose kickoff no source states is
  // refused rather than guessed (trading/bayse.ts).
  if (event.kickoff === null) {
    throw new ApiError(
      409,
      "We can't confirm when this game kicks off, so betting on it is paused",
      "GAME_START_UNKNOWN",
    );
  }
  if (event.kickoff && Date.now() >= Date.parse(event.kickoff)) {
    throw new ApiError(409, "This game has started — betting on it is closed", "GAME_STARTED");
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
    // a market whose result shows itself as the day goes on — a count of
    // posts or likes anyone can watch — closes early, before it's known
    if (
      settings.earlyCloseHours > 0 &&
      isPausedMarket(settings.earlyCloseTopics, event.title, event.slug, market.title) &&
      Date.now() >= closingMs - settings.earlyCloseHours * 3_600_000
    ) {
      throw new ApiError(
        409,
        `Betting on this market has closed — it stops ${settings.earlyCloseHours} hour${settings.earlyCloseHours === 1 ? "" : "s"} before the end`,
        "MARKET_CLOSING",
      );
    }
  }

  const outcome = market.outcomes.find((o) => o.id === body.outcomeId);
  if (!outcome) {
    throw new ApiError(404, "Outcome not found on this market", "OUTCOME_NOT_FOUND");
  }

  // the source's price plus the house margin: the book's base and any
  // automatic rise on a side the house stands to lose on (margin.ts)
  const rise = (await risesFor([market.id], settings)).get(market.id)?.get(outcome.id) ?? 0;
  const freshPriceKobo = quotedPriceKobo(
    outcome.priceKobo,
    baseMarginBps(event.origin, settings),
    rise,
  );
  if (freshPriceKobo < 1 || freshPriceKobo > 9_999) {
    throw new ApiError(409, "This outcome is not currently priceable", "MARKET_CLOSED");
  }
  // the desk's ceiling: a side priced above it is almost decided, and
  // only someone who already knows the answer buys it there
  if (settings.maxQuoteKobo > 0 && freshPriceKobo > settings.maxQuoteKobo) {
    throw new ApiError(
      409,
      "This side is almost decided — it isn't on sale now",
      "NEAR_CERTAIN",
      { freshPriceKobo, maxQuoteKobo: settings.maxQuoteKobo },
    );
  }
  if (Math.abs(freshPriceKobo - body.expectedPriceKobo) > settings.priceToleranceKobo) {
    throw new ApiError(409, "The price moved — confirm the new price", "PRICE_MOVED", {
      freshPriceKobo,
    });
  }

  const shares = body.stakeKobo / freshPriceKobo;
  const potentialPayoutKobo = Math.floor(shares * PAYOUT_PER_SHARE_KOBO);
  const newExposure = potentialPayoutKobo - body.stakeKobo;

  // From the loss-limit check to the fill, one order at a time on this
  // market — checked together, two orders could each pass and between
  // them go past the limit (trading/market-lock.ts).
  return withMarketLock(market.id, async () => {
    // the same order may have filled while this one waited for the lock
    const filled = await alreadyPlaced();
    if (filled) return filled;

    // the most one customer may stake on one market, all their bets on it
    // together — checked under the lock, so quick repeats can't slip past
    if (settings.maxStakePerMarketKobo > 0) {
      const [mine] = await Position.aggregate<{ staked: number }>([
        { $match: { authUserId, marketId: market.id, status: { $ne: "voided" } } },
        { $group: { _id: null, staked: { $sum: "$stakeKobo" } } },
      ]);
      const stakedKobo = mine?.staked ?? 0;
      if (stakedKobo + body.stakeKobo > settings.maxStakePerMarketKobo) {
        const left = Math.max(settings.maxStakePerMarketKobo - stakedKobo, 0);
        throw new ApiError(
          409,
          left >= settings.minStakeKobo
            ? `You can stake up to ${naira(settings.maxStakePerMarketKobo)} on one market — ${naira(left)} more on this one`
            : `You've reached the most you can stake on this market (${naira(settings.maxStakePerMarketKobo)})`,
          "MARKET_STAKE_LIMIT",
          { stakedKobo, maxKobo: settings.maxStakePerMarketKobo },
        );
      }
    }

    // house-exposure cap per market: what settlement could owe across
    // all open positions, beyond the stakes already collected
    const [agg] = await Position.aggregate<{ exposure: number }>([
      { $match: { marketId: market.id, status: "open" } },
      {
        $group: {
          _id: null,
          exposure: { $sum: { $subtract: ["$potentialPayoutKobo", "$stakeKobo"] } },
        },
      },
    ]);
    if ((agg?.exposure ?? 0) + newExposure > settings.maxMarketExposureKobo) {
      throw new ApiError(
        409,
        "This market has reached its trading limit for now",
        "MARKET_LIMIT_REACHED",
      );
    }

    // the whole book's limit: only a bet that adds to the worst case past
    // it is refused — the other side stays open — and the customer is
    // told how much would still fit (trading/book-limit.ts)
    if (settings.maxBookLossKobo > 0) {
      const limit = await checkBookLimit({
        marketId: market.id,
        outcomeId: outcome.id,
        stakeKobo: body.stakeKobo,
        priceKobo: freshPriceKobo,
        capKobo: settings.maxBookLossKobo,
      });
      if (!limit.ok) {
        void sendAlert(
          log,
          "Bets refused: the book's total loss limit is reached",
          {
            market: `${event.title} — ${market.title}`,
            refusedSide: outcome.label,
            worstCaseWithIt: `−${naira(limit.worstLossKobo)}`,
            limit: naira(settings.maxBookLossKobo),
            whatToDo:
              "Customers can't add to this side. Void or reprice the most one-sided market, or raise Maximum total loss in Settings if the book can carry more.",
          },
          {
            throttleKey: "risk:book-cap",
            kind: "risk",
            eventId: event.id,
            marketId: market.id,
            footer: "Deal with it in the admin desk: Admin → Watch → Alerts.",
          },
        ).catch((err: unknown) => log.error({ err }, "book-limit alert failed"));
        const fits = limit.maxStakeKobo >= settings.minStakeKobo;
        throw new ApiError(
          409,
          fits
            ? `So much is already riding on ${outcome.label} that you can bet up to ${naira(limit.maxStakeKobo)} on it right now — or back another outcome`
            : `${outcome.label} isn't taking more bets right now because so much is already riding on it — you can still back another outcome`,
          "BOOK_LIMIT_REACHED",
          { maxStakeKobo: fits ? limit.maxStakeKobo : 0 },
        );
      }
    }

    const debit = await debitNaira({
      authUserId,
      amountKobo: body.stakeKobo,
      type: "trade_stake",
      refKey: stakeRef,
      description: `${outcome.label} — ${event.title}`,
      metadata: { eventId: event.id, marketId: market.id, outcomeId: outcome.id },
    });

    // A retry of an order that failed once: its position write failed and
    // the stake was returned (the reversal below), so the debit above found
    // that first charge and took nothing now. Filling it would be a bet
    // with no stake — refuse it, and the bet slip starts a fresh order.
    if (await findExistingEntry(`${stakeRef}:reversal`)) {
      throw new ApiError(
        409,
        "That bet didn't go through and your stake was returned — place it again",
        "ORDER_REFUNDED",
      );
    }

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
      const dup = err && typeof err === "object" && "code" in err && err.code === 11000;
      if (dup) {
        // concurrent retry created it first; the stake refKey deduped too
        const winner = await alreadyPlaced();
        if (winner) return winner;
      }
      await creditNaira({
        authUserId,
        amountKobo: body.stakeKobo,
        type: "refund",
        refKey: `${stakeRef}:reversal`,
        description: "Trade failed — stake returned",
      }).catch((repairErr) =>
        log.error(
          { err: repairErr, idempotencyKey },
          "trade compensation failed — manual repair needed",
        ),
      );
      throw err;
    }
  });
}

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
