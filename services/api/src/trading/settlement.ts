import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { fetchBayseEvent, winningOutcome } from "./bayse.js";
import { creditNaira } from "./ledger.js";
import { Position, Settlement, type SettlementSource } from "./models.js";

/**
 * Settlement engine for the Local markets book. One market settles
 * exactly once (Settlement has a unique marketId index); positions
 * transition open → won/lost/voided via guarded updates, and payouts/
 * refunds are idempotent per position via the ledger's refKey — so a
 * crashed run can be re-run safely and finishes what it started.
 *
 * Two callers: the poller below (Bayse-verified auto-settlement, the
 * primary path — Bayse resolves its own markets, including the 15-min
 * countdown series) and the admin routes (manual settle/void with the
 * admin as the oracle of record).
 */

export interface SettleResult {
  marketId: string;
  outcome: "settled" | "voided" | "already_settled";
  positionsSettled: number;
  payoutTotalKobo: number;
}

async function settlePositions(params: {
  eventId: string;
  marketId: string;
  winningOutcomeId: string | null;
  voided: boolean;
  source: SettlementSource;
  actor: string;
  evidence: Record<string, unknown>;
  log: FastifyBaseLogger;
}): Promise<SettleResult> {
  const { marketId, winningOutcomeId, voided } = params;

  // claim the market — a second settle of the same market no-ops
  let settlement;
  try {
    settlement = await Settlement.create({
      eventId: params.eventId,
      marketId,
      winningOutcomeId,
      voided,
      source: params.source,
      actor: params.actor,
      evidence: params.evidence,
    });
  } catch (err) {
    const dup =
      err && typeof err === "object" && "code" in err && err.code === 11000;
    if (dup) {
      return {
        marketId,
        outcome: "already_settled",
        positionsSettled: 0,
        payoutTotalKobo: 0,
      };
    }
    throw err;
  }

  let settled = 0;
  let payoutTotal = 0;

  // process one position at a time; each step is idempotent, so a crash
  // mid-loop resumes cleanly on the next poll (open positions remain)
  const open = await Position.find({ marketId, status: "open" });
  for (const position of open) {
    const won = !voided && position.outcomeId === winningOutcomeId;
    const refund = voided;

    if (won || refund) {
      const amountKobo = won ? position.potentialPayoutKobo : position.stakeKobo;
      if (amountKobo > 0) {
        await creditNaira({
          authUserId: position.authUserId,
          amountKobo,
          type: won ? "payout" : "refund",
          refKey: `${won ? "payout" : "void"}:${String(position._id)}`,
          description: won
            ? `Won: ${position.outcomeLabel} — ${position.eventTitle}`
            : `Voided: ${position.eventTitle}`,
          metadata: { positionId: String(position._id), marketId },
        });
        payoutTotal += amountKobo;
      }
    }

    // guarded transition — only ever moves open → final
    const updated = await Position.updateOne(
      { _id: position._id, status: "open" },
      {
        $set: {
          status: refund ? "voided" : won ? "won" : "lost",
          settledAt: new Date(),
          settlementId: String(settlement._id),
        },
      },
    );
    if (updated.modifiedCount > 0) settled += 1;
  }

  await Settlement.updateOne(
    { _id: settlement._id },
    { $set: { positionsSettled: settled, payoutTotalKobo: payoutTotal } },
  );

  params.log.info(
    { marketId, voided, winningOutcomeId, settled, payoutTotal },
    "market settled",
  );
  return {
    marketId,
    outcome: voided ? "voided" : "settled",
    positionsSettled: settled,
    payoutTotalKobo: payoutTotal,
  };
}

/** Admin-declared settlement (the oracle of record). */
export function adminSettleMarket(params: {
  eventId: string;
  marketId: string;
  winningOutcomeId: string;
  actor: string;
  log: FastifyBaseLogger;
}): Promise<SettleResult> {
  return settlePositions({
    ...params,
    voided: false,
    source: "admin",
    evidence: { declaredBy: params.actor },
  });
}

/** Admin void — every open position refunds its stake. */
export function adminVoidMarket(params: {
  eventId: string;
  marketId: string;
  actor: string;
  reason: string;
  log: FastifyBaseLogger;
}): Promise<SettleResult> {
  return settlePositions({
    eventId: params.eventId,
    marketId: params.marketId,
    winningOutcomeId: null,
    voided: true,
    source: "admin",
    actor: params.actor,
    evidence: { reason: params.reason },
    log: params.log,
  });
}

/* ------------------------------------------------------------------ */
/* Bayse-verified auto-settlement poller                               */
/* ------------------------------------------------------------------ */

/**
 * Exception alert — a market that needs human eyes (resolved on Bayse
 * but our settlement failed, or resolution overdue). Logs always;
 * POSTs to ALERT_WEBHOOK_URL when configured, which is where an email
 * bridge (Zapier/n8n/own endpoint) plugs in.
 */
async function alertAdmin(
  log: FastifyBaseLogger,
  subject: string,
  detail: Record<string, unknown>,
): Promise<void> {
  log.warn({ alert: subject, ...detail }, "settlement alert");
  if (!config.ALERT_WEBHOOK_URL) return;
  try {
    await fetch(config.ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, detail, service: "worldstreet-prediction-api" }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    log.error({ err }, "alert webhook failed");
  }
}

/**
 * One pass: every event carrying open positions is re-checked against
 * Bayse; resolved markets settle with Bayse's own outcome as evidence,
 * cancelled events void, and anything unresolved long past its
 * resolution date raises an alert for the admin.
 */
export async function runSettlementPass(log: FastifyBaseLogger): Promise<void> {
  const eventIds: string[] = await Position.distinct("eventId", {
    status: "open",
  });

  for (const eventId of eventIds) {
    try {
      const event = await fetchBayseEvent(eventId);

      if (event.status === "cancelled") {
        for (const market of event.markets) {
          await settlePositions({
            eventId,
            marketId: market.id,
            winningOutcomeId: null,
            voided: true,
            source: "bayse-auto",
            actor: "system",
            evidence: { bayseStatus: event.status },
            log,
          });
        }
        continue;
      }

      for (const market of event.markets) {
        if (market.status !== "resolved") continue;
        const winner = winningOutcome(market);
        if (!winner) {
          await alertAdmin(log, "Resolved market with unmatchable outcome", {
            eventId,
            marketId: market.id,
            resolvedOutcome: market.resolvedOutcome,
            eventTitle: event.title,
          });
          continue;
        }
        await settlePositions({
          eventId,
          marketId: market.id,
          winningOutcomeId: winner.id,
          voided: false,
          source: "bayse-auto",
          actor: "system",
          evidence: {
            bayseResolvedOutcome: market.resolvedOutcome,
            bayseStatus: market.status,
          },
          log,
        });
      }

      // overdue: resolution date long past but Bayse still not resolved
      const resolutionMs = event.resolutionDate
        ? Date.parse(event.resolutionDate)
        : NaN;
      if (
        !Number.isNaN(resolutionMs) &&
        Date.now() - resolutionMs > config.SETTLEMENT_OVERDUE_HOURS * 3_600_000 &&
        event.markets.some((m) => m.status !== "resolved")
      ) {
        await alertAdmin(log, "Market overdue for resolution", {
          eventId,
          eventTitle: event.title,
          resolutionDate: event.resolutionDate,
        });
      }
    } catch (err) {
      // one broken event must not stall the rest of the pass
      log.error({ err, eventId }, "settlement pass failed for event");
    }
  }
}

/** Start the recurring poller; returns a stop function for shutdown. */
export function startSettlementWorker(log: FastifyBaseLogger): () => void {
  if (config.SETTLEMENT_POLL_SECONDS <= 0) {
    log.info("settlement worker disabled (SETTLEMENT_POLL_SECONDS=0)");
    return () => {};
  }
  let running = false;
  const timer = setInterval(() => {
    if (running) return; // never overlap passes
    running = true;
    runSettlementPass(log)
      .catch((err) => log.error({ err }, "settlement pass crashed"))
      .finally(() => {
        running = false;
      });
  }, config.SETTLEMENT_POLL_SECONDS * 1000);
  timer.unref();
  log.info(
    { intervalSeconds: config.SETTLEMENT_POLL_SECONDS },
    "settlement worker started",
  );
  return () => clearInterval(timer);
}
