import type { FastifyBaseLogger } from "fastify";
import { sendAlert } from "../alerts.js";
import { config } from "../config.js";
import { fetchTradableEvent } from "./events.js";
import { creditNaira } from "./ledger.js";
import { Position, Settlement, type SettlementSource } from "./models.js";
import { markWorldstreetSettled } from "./worldstreet.js";
import { checkRiskAlerts } from "./risk-alerts.js";
import { pausedPattern } from "./paused.js";
import { getBookSettings } from "./settings.js";
import { emailRefunds } from "./pause-refunds.js";

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

export interface PausedVoidResult {
  /** Markets with open bets that the pause covers. */
  markets: number;
  /** Open bets on them (before voiding, on a dry run). */
  positions: number;
  /** Stakes refunded — or that would be, on a dry run. */
  refundKobo: number;
  /** Markets someone else settled first; their bets were left alone. */
  alreadySettled: number;
  /** Customers told by email that their bet was refunded (0 on a dry run). */
  emailed: number;
  dryRun: boolean;
}

/**
 * Void every market the paused topics cover (trading/paused.ts) that
 * still has open bets: each refunds every open stake, exactly as the
 * desk's single-market void does, and every customer refunded gets one
 * email saying so (customer-mail.ts). A dry run only counts.
 */
export async function voidPausedMarkets(params: {
  topics: readonly string[];
  actor: string;
  reason: string;
  dryRun: boolean;
  log: FastifyBaseLogger;
}): Promise<PausedVoidResult> {
  const none = { markets: 0, positions: 0, refundKobo: 0, alreadySettled: 0, emailed: 0 };
  const pattern = pausedPattern(params.topics);
  if (!pattern) return { ...none, dryRun: params.dryRun };
  const open = await Position.find(
    {
      status: "open",
      $or: [{ eventTitle: pattern }, { eventSlug: pattern }, { marketTitle: pattern }],
    },
    { eventId: 1, marketId: 1, stakeKobo: 1 },
  ).lean();
  if (open.length === 0) return { ...none, dryRun: params.dryRun };

  const markets = new Map<string, string>(); // marketId → eventId
  let stakes = 0;
  for (const p of open) {
    markets.set(p.marketId, p.eventId);
    stakes += p.stakeKobo;
  }
  if (params.dryRun) {
    return { ...none, markets: markets.size, positions: open.length, refundKobo: stakes, dryRun: true };
  }

  let positions = 0;
  let refundKobo = 0;
  let alreadySettled = 0;
  for (const [marketId, eventId] of markets) {
    const result = await adminVoidMarket({
      eventId,
      marketId,
      actor: params.actor,
      reason: params.reason,
      log: params.log,
    });
    if (result.outcome === "already_settled") alreadySettled += 1;
    positions += result.positionsSettled;
    refundKobo += result.payoutTotalKobo;
  }

  // what each customer actually got back — only bets this void refunded
  const voided = await Position.find(
    { _id: { $in: open.map((p) => p._id) }, status: "voided" },
    { authUserId: 1, eventTitle: 1, stakeKobo: 1, refundNotifiedAt: 1 },
  ).lean();
  const emailed = await emailRefunds(voided, params.topics, params.log);

  params.log.warn(
    { markets: markets.size, positions, refundKobo, alreadySettled, emailed, actor: params.actor },
    "paused markets voided",
  );
  return { markets: markets.size, positions, refundKobo, alreadySettled, emailed, dryRun: false };
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
  // Paused topics first: their open bets are voided and refunded before
  // anything below could settle them as won or lost (trading/paused.ts).
  const { pausedTopics } = await getBookSettings();
  if (pausedTopics.length > 0) {
    await voidPausedMarkets({
      topics: pausedTopics,
      actor: "system:paused",
      reason: `Paused topic: ${pausedTopics.join(", ")}`,
      dryRun: false,
      log,
    }).catch((err: unknown) => log.error({ err }, "voiding paused markets failed"));
  }

  const eventIds: string[] = await Position.distinct("eventId", {
    status: "open",
  });

  for (const eventId of eventIds) {
    try {
      const event = await fetchTradableEvent(eventId);
      const autoSource: SettlementSource =
        event.origin === "bayse"
          ? "bayse-auto"
          : event.origin === "polymarket"
            ? "polymarket-auto"
            : "worldstreet-auto";

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
        // the source called it no-contest (Polymarket's 50/50): the book
        // pays whole shares or nothing, so every stake goes back
        if (market.voided) {
          await settlePositions({
            eventId,
            marketId: market.id,
            winningOutcomeId: null,
            voided: true,
            source: autoSource,
            actor: "system",
            evidence: { origin: event.origin, marketStatus: market.status, split: true },
            log,
          });
          continue;
        }
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
            { throttleKey: `unmatched:${market.id}`, kind: "settlement", eventId, marketId: market.id },
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
          { throttleKey: `overdue:${eventId}`, kind: "settlement", eventId },
        );
      }
    } catch (err) {
      // one broken event must not stall the rest of the pass
      log.error({ err, eventId }, "settlement pass failed for event");
    }
  }

  // with this pass's settlements done, warn the admins if what's still
  // open is heading for a loss (trading/risk-alerts.ts)
  try {
    await checkRiskAlerts(log);
  } catch (err) {
    log.error({ err }, "risk alert check failed");
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
