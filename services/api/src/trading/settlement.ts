import type { FastifyBaseLogger } from "fastify";
import { sendAlert } from "../alerts.js";
import { config } from "../config.js";
import { fetchTradableEvent } from "./events.js";
import { creditNaira } from "./ledger.js";
import { Position, Settlement, type SettlementSource } from "./models.js";
import { markWorldstreetSettled } from "./worldstreet.js";

/**
 * Settlement engine for the Local markets book. One market settles
 * exactly once (Settlement has a unique marketId index); positions
 * transition open → won/lost/voided via guarded updates, and payouts/
 * refunds are idempotent per position via the ledger's refKey — so a
 * crashed run can be re-run safely and finishes what it started.
 *
 * Two callers: the poller below and the admin routes (manual
 * settle/void with the admin as the oracle of record). What the poller
 * can finish by itself depends on the origin — Bayse resolves its own
 * markets, including the 15-min countdown series, so those settle
 * unattended; Worldstreet's own markets have no oracle but the desk,
 * so for those the poller only voids cancelled events and raises the
 * overdue alert.
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

  // no-op unless the market is one of ours
  await markWorldstreetSettled({
    marketId,
    winningOutcomeId,
    voided,
    log: params.log,
  });

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
/* Auto-settlement poller                                              */
/* ------------------------------------------------------------------ */

/**
 * One pass: every event carrying open positions is re-checked at
 * source. Resolved markets settle with the source's own outcome as
 * evidence, cancelled events void, and anything unresolved long past
 * its resolution date raises an alert for the desk.
 *
 * For a Bayse event this is the whole settlement story — Relay
 * resolves its own markets and the desk never has to look. For one of
 * ours, a market only reaches "resolved" *because* the desk settled
 * it, so the resolved branch finds the Settlement already written and
 * no-ops; what earns the pass its keep there is voiding a cancelled
 * event and nagging about an overdue one.
 */
export async function runSettlementPass(log: FastifyBaseLogger): Promise<void> {
  const eventIds: string[] = await Position.distinct("eventId", {
    status: "open",
  });

  for (const eventId of eventIds) {
    try {
      const event = await fetchTradableEvent(eventId);
      const autoSource: SettlementSource =
        event.origin === "bayse" ? "bayse-auto" : "worldstreet-auto";

      if (event.status === "cancelled") {
        for (const market of event.markets) {
          await settlePositions({
            eventId,
            marketId: market.id,
            winningOutcomeId: null,
            voided: true,
            source: autoSource,
            actor: "system",
            evidence: { origin: event.origin, eventStatus: event.status },
            log,
          });
        }
        continue;
      }

      for (const market of event.markets) {
        if (market.status !== "resolved") continue;
        if (!market.resolvedOutcomeId) {
          await sendAlert(
            log,
            "Resolved market with unmatchable outcome",
            {
              eventId,
              marketId: market.id,
              resolvedOutcome: market.resolvedOutcomeLabel,
              eventTitle: event.title,
            },
            `unmatched:${market.id}`,
          );
          continue;
        }
        await settlePositions({
          eventId,
          marketId: market.id,
          winningOutcomeId: market.resolvedOutcomeId,
          voided: false,
          source: autoSource,
          actor: "system",
          evidence: {
            origin: event.origin,
            resolvedOutcome: market.resolvedOutcomeLabel,
            marketStatus: market.status,
          },
          log,
        });
      }

      // overdue: resolution date long past, still nothing resolved
      const resolutionMs = event.resolutionDate
        ? Date.parse(event.resolutionDate)
        : NaN;
      if (
        !Number.isNaN(resolutionMs) &&
        Date.now() - resolutionMs > config.SETTLEMENT_OVERDUE_HOURS * 3_600_000 &&
        event.markets.some((m) => m.status !== "resolved")
      ) {
        await sendAlert(
          log,
          "Market overdue for resolution",
          {
            eventId,
            origin: event.origin,
            eventTitle: event.title,
            resolutionDate: event.resolutionDate,
          },
          `overdue:${eventId}`,
        );
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
