import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import {
  chargeWallet,
  creditWallet,
  isWalletConfigured,
  refundWalletCharge,
} from "../wallet.js";
import {
  creditNaira,
  debitNaira,
  findExistingEntry,
  getNairaBalanceKobo,
} from "../trading/ledger.js";
import { getFxQuote, koboToUsdMinor, usdMinorToKobo } from "../trading/fx.js";

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
      const { direction, amountMinor, idempotencyKey } = request.body;

      // one naira-ledger refKey per client key; if it exists the
      // conversion already completed — return it instead of re-running
      const refKey = `convert:${authUserId}:${idempotencyKey}`;
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
          await refundWalletCharge({
            clerkUserId: authUserId,
            chargeId: charge.data.charge.id,
            reason: "NGN credit failed",
          }).catch((refundErr) =>
            request.log.error(
              { err: refundErr, chargeId: charge.data.charge.id },
              "conversion compensation failed — manual repair needed",
            ),
          );
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

      const credit = await creditWallet({
        clerkUserId: authUserId,
        amountUsdMinor,
        description: `Naira wallet withdrawal (₦${(amountMinor / 100).toFixed(2)})`,
        idempotencyKey: refKey,
        metadata: { kind: "ngn_withdrawal", rate: fx.ngnToUsd },
      });
      if (!credit.ok) {
        request.log.error(
          { code: credit.code, message: credit.message, refKey },
          "central wallet credit failed during NGN withdrawal",
        );
        // central side failed — give the naira back
        await creditNaira({
          authUserId,
          amountKobo: amountMinor,
          type: "refund",
          refKey: `${refKey}:reversal`,
          description: "Withdrawal failed — naira returned",
        }).catch((repairErr) =>
          request.log.error(
            { err: repairErr, refKey },
            "withdrawal compensation failed — manual repair needed",
          ),
        );
        throw new ApiError(503, "Could not credit your dollar wallet", "WALLET_UNAVAILABLE");
      }

      return {
        success: true,
        data: { amountUsdMinor, balanceKobo: debit.balanceAfterKobo },
      };
    },
  );
};
