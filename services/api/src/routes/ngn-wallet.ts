import type { FastifyBaseLogger, FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { assertNotSuspended } from "../accounts.js";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { getBookSettings } from "../trading/settings.js";
import {
  holdForReview,
  holdWithdrawal,
  returnWithdrawal,
  reviewReason,
  sendWithdrawal,
} from "../trading/withdrawals.js";
import { chargeWallet, isWalletConfigured, refundWalletCharge } from "../wallet.js";
import {
  creditNaira,
  debitNaira,
  findExistingEntry,
  getNairaBalanceKobo,
} from "../trading/ledger.js";
import { getFxQuote, koboToUsdMinor, usdMinorToKobo } from "../trading/fx.js";
import { ReversedConversion } from "../trading/models.js";

/**
 * The naira trading wallet. Lives entirely in this service's Mongo —
 * the central (USD) wallet is only the funding source and withdrawal
 * sink, reached through its existing idempotent charge/credit calls.
 *
 * Conversion is a two-step saga with compensation:
 *   USD→NGN: charge central wallet, then credit naira; a naira-side
 *            failure refunds the central charge.
 *   NGN→USD: debit naira, then credit central wallet; a central-side
 *            failure re-credits the naira.
 * Either way, a key whose conversion was reversed is refused from then
 * on (409 CONVERSION_REVERSED) and the client starts a fresh one.
 */

const convertBody = z.object({
  direction: z.enum(["usd_to_ngn", "ngn_to_usd"]),
  /** Amount in the SOURCE currency's minor units (cents or kobo). */
  amountMinor: z.number().int().min(1),
  /** Client-generated idempotency key — retries must reuse it. */
  idempotencyKey: z.string().min(8).max(128),
});

export const ngnWalletRoutes: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  /** Balance + the current conversion rates (null until an admin sets one). */
  app.get("/wallet/ngn", async (request) => {
    const { authUserId } = await authenticate(request);
    const balanceKobo = await getNairaBalanceKobo(authUserId);
    const fx = await getFxQuote().catch(() => null);
    return {
      success: true,
      data: {
        balanceKobo,
        currency: "NGN",
        fx: fx
          ? {
              mid: fx.mid,
              usdToNgn: fx.usdToNgn,
              ngnToUsd: fx.ngnToUsd,
              spreadBps: fx.spreadBps,
              asOf: fx.asOf.toISOString(),
            }
          : null,
      },
    };
  });

  app.post(
    "/wallet/ngn/convert",
    {
      schema: { body: convertBody },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request) => {
      if (!isWalletConfigured()) {
        throw new ApiError(503, "The wallet service is unavailable", "WALLET_UNAVAILABLE");
      }
      const { authUserId } = await authenticate(request);
      return convertNaira(authUserId, request.body, request.log);
    },
  );
};

export type ConvertBody = z.infer<typeof convertBody>;

/**
 * One conversion for a signed-in user — all of POST /wallet/ngn/convert
 * after sign-in, exported so the smoke tests can drive it.
 */
export async function convertNaira(authUserId: string, body: ConvertBody, log: FastifyBaseLogger) {
  const { direction, amountMinor, idempotencyKey } = body;

  // one naira-ledger refKey per client key; if it exists the
  // conversion already completed — return it instead of re-running
  const refKey = `convert:${authUserId}:${idempotencyKey}`;

  // A conversion that failed and was put back can't be replayed under its
  // key: a withdrawal's naira debit would read as done ("already
  // processed") though no dollars moved, and a funding charge the wallet
  // dedupes would credit naira for dollars already refunded. The client
  // starts a fresh conversion instead.
  if (
    (await findExistingEntry(`${refKey}:reversal`)) ||
    (await ReversedConversion.exists({ refKey }))
  ) {
    throw new ApiError(
      409,
      "That conversion didn't go through and was reversed — please try again",
      "CONVERSION_REVERSED",
    );
  }

  const prior = await findExistingEntry(refKey);
  if (prior) {
    return {
      success: true,
      data: {
        alreadyProcessed: true,
        amountKobo: Math.abs(prior.amountKobo),
        balanceKobo: await getNairaBalanceKobo(authUserId),
      },
    };
  }

  // a suspended account moves no money in or out (accounts.ts); a
  // conversion that already went through still reports itself above
  await assertNotSuspended(authUserId);

  const fx = await getFxQuote();

  if (direction === "usd_to_ngn") {
    const amountKobo = usdMinorToKobo(amountMinor, fx);
    if (amountKobo < 1) {
      throw new ApiError(400, "Amount too small to convert", "AMOUNT_TOO_SMALL");
    }

    const charge = await chargeWallet({
      clerkUserId: authUserId,
      amountUsdMinor: amountMinor,
      description: `Convert $${(amountMinor / 100).toFixed(2)} to naira`,
      idempotencyKey: refKey,
      metadata: { kind: "ngn_funding", rate: fx.usdToNgn },
    });
    if (!charge.ok) {
      const insufficient = /insufficient/i.test(charge.message);
      throw new ApiError(
        insufficient ? 402 : 503,
        insufficient
          ? "Insufficient dollar balance"
          : "Could not charge your dollar wallet",
        insufficient ? "INSUFFICIENT_FUNDS" : "WALLET_UNAVAILABLE",
      );
    }

    try {
      const entry = await creditNaira({
        authUserId,
        amountKobo,
        type: "conversion_in",
        refKey,
        description: `Funded from $${(amountMinor / 100).toFixed(2)} @ ₦${fx.usdToNgn.toFixed(2)}/$`,
        metadata: { chargeId: charge.data.charge.id, amountUsdMinor: amountMinor },
      });
      return {
        success: true,
        data: { amountKobo, balanceKobo: entry.balanceAfterKobo },
      };
    } catch (err) {
      // naira side failed after the dollar charge — give the money back
      // (the wallet client reports failure in its result, never by throwing)
      const refund = await refundWalletCharge({
        clerkUserId: authUserId,
        chargeId: charge.data.charge.id,
        reason: "NGN credit failed",
      });
      if (refund.ok) {
        // the dollars are back, so this key must never fund naira again
        await ReversedConversion.create({ refKey }).catch((markErr: unknown) =>
          log.error({ err: markErr, refKey }, "could not record a reversed conversion"),
        );
      } else {
        log.error(
          { code: refund.code, message: refund.message, chargeId: charge.data.charge.id },
          "conversion compensation failed — manual repair needed",
        );
      }
      throw err;
    }
  }

  // ngn_to_usd
  const amountUsdMinor = koboToUsdMinor(amountMinor, fx);
  if (amountUsdMinor < 1) {
    throw new ApiError(400, "Amount too small to convert", "AMOUNT_TOO_SMALL");
  }

  const debit = await debitNaira({
    authUserId,
    amountKobo: amountMinor,
    type: "conversion_out",
    refKey,
    description: `Withdraw ₦${(amountMinor / 100).toFixed(2)} to dollars @ ₦${fx.ngnToUsd.toFixed(2)}/$`,
    metadata: { amountUsdMinor },
  });

  // the wallet adds the dollars; a lost answer is asked again under the
  // same reference, and never refunded on a guess (trading/withdrawals.ts)
  const withdrawal = { authUserId, refKey, amountKobo: amountMinor, amountUsdMinor, rate: fx.ngnToUsd };

  // a big day of withdrawals, or a flagged account, waits for an admin
  const reason = await reviewReason(authUserId, await getBookSettings());
  if (reason) {
    await holdForReview({ ...withdrawal, reason, log });
    throw new ApiError(
      409,
      `Your withdrawal of $${(amountUsdMinor / 100).toFixed(2)} is being checked and will reach your WorldStreet wallet once it's approved — usually within a day. The credit is set aside for it, and we'll email you when it's sent.`,
      "WITHDRAWAL_IN_REVIEW",
    );
  }

  const sent = await sendWithdrawal({ ...withdrawal, log });
  if (sent.outcome === "refused") {
    log.error(
      { code: sent.code, message: sent.message, refKey },
      "central wallet refused the credit during NGN withdrawal",
    );
    // the wallet said no, so nothing moved there — give the naira back
    await returnWithdrawal(withdrawal).catch((repairErr) =>
      log.error(
        { err: repairErr, refKey },
        "withdrawal compensation failed — manual repair needed",
      ),
    );
    throw new ApiError(
      503,
      "Couldn't add the dollars to your WorldStreet wallet — your credit was returned",
      "WALLET_UNAVAILABLE",
    );
  }
  if (sent.outcome === "unknown") {
    // the dollars may have arrived: hold the credit for the desk to settle
    await holdWithdrawal({ ...withdrawal, code: sent.code, message: sent.message, log });
    throw new ApiError(
      502,
      "We couldn't confirm your withdrawal with your WorldStreet wallet. Check your dollar balance shortly — if the dollars haven't arrived, contact support and we'll return your credit.",
      "WITHDRAWAL_UNCONFIRMED",
    );
  }

  return {
    success: true,
    data: { amountUsdMinor, balanceKobo: debit.balanceAfterKobo },
  };
}
