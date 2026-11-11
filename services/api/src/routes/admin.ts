import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  STAKE_LEVELS,
  lockWithdrawals,
  reinstateAccount,
  restoreAutoStakeLevels,
  setStakeLevel,
  suspendAccount,
  unlockWithdrawals,
} from "../accounts.js";
import { requireAdmin } from "../admin-auth.js";
import { ApiError } from "../errors.js";
import { SupportTicket, User } from "../models.js";
import { getFxQuote } from "../trading/fx.js";
import { FxRate, LedgerEntry, Position, Settlement } from "../trading/models.js";
import {
  adminSettleMarket,
  adminVoidMarket,
  voidPausedMarkets,
} from "../trading/settlement.js";
import { fetchTradableEvent, requireMarket } from "../trading/events.js";
import { eventOrMarketId, outcomeId } from "../trading/ids.js";
import { getSettlementQueue } from "../trading/exposure.js";
import { listTraders, TRADER_SORTS, type TraderSort } from "../trading/traders.js";
import { getBookRisk } from "../trading/risk.js";
import {
  getBookSettings,
  getSettingsView,
  isUsableTopic,
  normalizeTopics,
  updateBookSettings,
} from "../trading/settings.js";
import { getTopicBets } from "../trading/topic-bets.js";
import {
  clearDebts,
  findCustomerId,
  getRecovery,
  notifyReversals,
  openBetsMatching,
  previewReversal,
  runReversalBatch,
} from "../trading/reversals.js";
import { getProfitAndLoss } from "../trading/pnl.js";
import { getAdminOverview } from "../trading/overview.js";
import { getPausedRefunds } from "../trading/pause-refunds.js";
import { getAbuseWatch } from "../trading/abuse.js";
import { getCustomerBetReview } from "../trading/bet-review.js";
import { getWithdrawalDesk, resolveWithdrawalCheck } from "../trading/withdrawals.js";
import { listWalletChecks, readTestAccount, runWalletCheck } from "../trading/wallet-check.js";
import { listAlerts, resolveAlert, sendAlert } from "../alerts.js";
import { WithdrawalCheck } from "../trading/models.js";
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
  // not z.coerce.boolean(): that reads ANY non-empty string — "false"
  // included — as true, so the desk could never turn the filter off
  activeOnly: z
    .enum(["true", "false", "1", "0"])
    .transform((v) => v === "true" || v === "1")
    .optional(),
  suspendedOnly: z
    .enum(["true", "false", "1", "0"])
    .transform((v) => v === "true" || v === "1")
    .optional(),
  /** Only customers on a reduced or restricted stake level. */
  limitedOnly: z
    .enum(["true", "false", "1", "0"])
    .transform((v) => v === "true" || v === "1")
    .optional(),
});

const alertsQuery = z.object({
  status: z.enum(["open", "resolved", "all"]).default("open"),
});
const resolveAlertBody = z.object({
  id: z.string().regex(/^[0-9a-f]{24}$/, "Not an alert id"),
  note: z.string().trim().max(500).default(""),
});

const abuseQuery = z.object({
  /** Bets placed in the last N days; 0 = all time. Money in and out is always all time. */
  days: z.coerce.number().int().min(0).max(3650).default(30),
});
const testAccountQuery = z.object({
  account: z.string().trim().min(2).max(200),
});
const walletCheckBody = z.object({
  /** Whose dollar wallet to test on: a username or email. */
  account: z.string().trim().min(2).max(200),
  /** It moves real money, if only a cent, so it's never run by accident. */
  confirm: z.literal("RUN"),
});
const withdrawalResolveBody = z.object({
  refKey: z.string().min(8).max(300),
  /** retry: ask the wallet again; paid / return: the desk's own call. */
  action: z.enum(["retry", "paid", "return"]),
});

/** Suspending: the reason is the customer's to read (accounts.ts). */
const suspendBody = z.object({
  reason: z.string().trim().min(5, "Give a reason the customer will understand").max(500),
  notify: z.boolean(),
});
/** Locking withdrawals: the note is the desk's own, never shown to the customer. */
const withdrawalLockBody = z.object({
  note: z.string().trim().max(500).default(""),
});
/** A stake level, and the desk's reason for it (never shown to the customer). */
const stakeLevelBody = z.object({
  level: z.enum(STAKE_LEVELS),
  reason: z.string().trim().min(5, "Say why, for the account's history").max(500),
});
const reinstateBody = z.object({
  reason: z.string().trim().max(500).default(""),
  notify: z.boolean(),
});

/** Any subset of the book settings; bounds are checked in trading/settings.ts. */
const settingsBody = z
  .object({
    internationalTrading: z.boolean(),
    polymarketSpreadBps: z.number().int(),
    localSpreadBps: z.number().int(),
    autoSpreadStepKobo: z.number().int(),
    maxQuoteKobo: z.number().int(),
    fxSpreadBps: z.number().int(),
    minStakeKobo: z.number().int(),
    maxStakeKobo: z.number().int(),
    maxMarketExposureKobo: z.number().int(),
    priceToleranceKobo: z.number().int(),
    countdownCutoffSeconds: z.number().int(),
    lossAlertKobo: z.number().int(),
    pausedTopics: z.array(z.string().max(80)).max(50),
    stoppedTopics: z.array(z.string().max(80)).max(50),
    maxStakePerMarketKobo: z.number().int(),
    reducedStakePct: z.number().int(),
    restrictedStakePct: z.number().int(),
    earlyCloseHours: z.number().int(),
    earlyCloseTopics: z.array(z.string().max(80)).max(50),
    withdrawalReviewKobo: z.number().int(),
    maxBookLossKobo: z.number().int(),
  })
  .partial()
  .strict();

const voidPausedBody = z.object({
  reason: z.string().min(3).max(500),
  dryRun: z.boolean(),
});

// a market's slug (pasted as its link) can run past a topic's usual 80
const recoveryTopics = z.array(z.string().max(200)).min(1).max(10);
const recoveryPreviewBody = z.object({
  topics: recoveryTopics,
  /** Bets placed in the last N days; null = all time. */
  sinceDays: z.number().int().min(1).max(3650).nullable(),
  /** Bets placed from this exact moment (ISO, with offset); wins over sinceDays. */
  sinceAt: z.iso.datetime({ offset: true }).optional(),
  /** Only this customer's bets (username or email); empty = everyone's. */
  customer: z.string().trim().max(200).optional(),
  /** With a customer: the reason to write the email preview with. */
  reason: z.string().trim().max(1000).optional(),
});
const recoveryRunBody = recoveryPreviewBody.extend({
  shortfall: z.enum(["negative", "cap"]),
  /** Why — the customer's email says it in these words. */
  reason: z.string().trim().min(10, "Say why, in words the customer will understand").max(1000),
  /** Typed by the admin — reversing moves real balances. */
  confirm: z.literal("REVERSE"),
});
const recoveryNotifyBody = z.object({
  dryRun: z.boolean(),
  /** Only this customer (username or email); a dry run then returns the emails as written. */
  customer: z.string().trim().max(200).optional(),
  /** The desk's edited wording of that customer's one waiting email. */
  subject: z.string().trim().min(3).max(200).optional(),
  text: z.string().trim().min(20).max(10_000).optional(),
});

/** One market named by its slug — what the desk gets from pasting its link. */
const MARKET_SLUG = /^[a-z0-9][a-z0-9-]{1,199}$/;

/** Normalized, checked topics (or market slugs), or a 400 the desk can show. */
function checkTopics(raw: string[]): string[] {
  const topics = normalizeTopics(raw);
  if (topics.length === 0) throw new ApiError(400, "Name at least one topic", "NO_TOPICS");
  const bad = topics.find((t) => !isUsableTopic(t) && !MARKET_SLUG.test(t));
  if (bad !== undefined) {
    throw new ApiError(400, `"${bad}" isn't a usable topic — letters, numbers, spaces, dots or dashes`, "BAD_TOPIC");
  }
  return topics;
}

const topicBetsQuery = z.object({
  /** Comma-separated; absent = the paused topics. */
  topics: z.string().max(400).optional(),
  hours: z.coerce.number().int().min(1).max(2160).default(72),
  /** Bets placed from this exact moment instead of settled in the last `hours`. */
  sinceAt: z.iso.datetime({ offset: true }).optional(),
});

const refundsQuery = z.object({
  hours: z.coerce.number().int().min(1).max(720).default(72),
});


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

  /**
   * The desk's headline numbers — money staked, profit / loss, margin,
   * active traders, money in play, credit held, and the FX mid for the
   * desk's ₦/$ switch (trading/overview.ts).
   */
  app.get("/admin/overview", async (request) => {
    await requireAdmin(request);
    return { success: true, data: await getAdminOverview() };
  });

  /**
   * The current conversion quote, for the desk — the users' wallet
   * endpoint needs a Clerk login, which an access-key admin doesn't have.
   */
  app.get("/admin/fx", async (request) => {
    await requireAdmin(request);
    const fx = await getFxQuote().catch((err: unknown) => {
      if (err instanceof ApiError && err.code === "FX_UNAVAILABLE") return null;
      throw err;
    });
    return { success: true, data: { fx } };
  });

  /**
   * What the book has actually made or lost on finished markets — all
   * time, last 30 and 7 days, Local vs international (trading/pnl.ts).
   */
  app.get("/admin/pnl", async (request) => {
    await requireAdmin(request);
    return { success: true, data: await getProfitAndLoss() };
  });

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
        { kind: "test" },
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

  /**
   * Void every market the paused topics cover (Settings → Paused
   * markets) that still has open bets, refunding each stake — the
   * single-market void below, in bulk. `dryRun` only counts, so the desk
   * can show what will happen before it does.
   */
  app.post(
    "/admin/void-paused",
    { schema: { body: voidPausedBody }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => {
      const user = await requireAdmin(request);
      const settings = await getBookSettings();
      if (settings.pausedTopics.length === 0) {
        throw new ApiError(409, "No topics are paused", "NOTHING_PAUSED");
      }
      const result = await voidPausedMarkets({
        topics: settings.pausedTopics,
        actor: user.id,
        reason: request.body.reason,
        dryRun: request.body.dryRun,
        log: request.log,
      });
      return { success: true, data: { ...result, topics: settings.pausedTopics } };
    },
  );

  /**
   * Recovery: what reversing settled bets has taken back, owed and
   * written off, per customer and in all (trading/reversals.ts).
   */
  app.get("/admin/recovery", async (request) => {
    await requireAdmin(request);
    return { success: true, data: await getRecovery() };
  });

  /** What reversing these topics' bets would do — nothing moves. */
  app.post("/admin/recovery/preview", { schema: { body: recoveryPreviewBody } }, async (request) => {
    await requireAdmin(request);
    const topics = checkTopics(request.body.topics);
    const { pausedTopics } = await getBookSettings();
    const authUserId = request.body.customer ? await findCustomerId(request.body.customer) : undefined;
    const sinceAt = request.body.sinceAt ? new Date(request.body.sinceAt) : null;
    const preview = await previewReversal(topics, request.body.sinceDays, authUserId, sinceAt, request.body.reason);
    return {
      success: true,
      data: { ...preview, paused: topics.every((t) => pausedTopics.includes(t)) },
    };
  });

  /**
   * Reverse one batch of these markets' settled bets: stake back, any
   * winnings taken back, and the reason kept for the customer's email.
   * Markets with open bets must be paused first, so no new bet lands
   * while it runs. Call again until `remaining` is 0.
   */
  app.post(
    "/admin/recovery/run",
    { schema: { body: recoveryRunBody }, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request) => {
      const user = await requireAdmin(request);
      const topics = checkTopics(request.body.topics);
      // markets still holding bets are paused first, so nothing new lands
      // while reversing and the open bets are refunded; finished markets
      // can be reversed as they are
      const authUserId = request.body.customer ? await findCustomerId(request.body.customer) : undefined;
      const { pausedTopics } = await getBookSettings();
      const unpaused = topics.filter((t) => !pausedTopics.includes(t));
      if (unpaused.length > 0 && (await openBetsMatching(topics, authUserId)) > 0) {
        throw new ApiError(
          409,
          `These markets still have open bets — pause them first: ${unpaused.join(", ")}`,
          "NOT_PAUSED",
        );
      }
      return {
        success: true,
        data: await runReversalBatch({
          topics,
          sinceDays: request.body.sinceDays,
          sinceAt: request.body.sinceAt ? new Date(request.body.sinceAt) : null,
          ...(authUserId ? { authUserId } : {}),
          shortfall: request.body.shortfall,
          reason: request.body.reason,
          actor: user.id,
          log: request.log,
        }),
      };
    },
  );

  /**
   * Clear what reversal customers owe: everyone below zero back to zero,
   * lifting their block. Keeps what's been recovered. `dryRun` only counts.
   */
  app.post(
    "/admin/recovery/clear-debts",
    { schema: { body: recoveryNotifyBody }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => {
      const user = await requireAdmin(request);
      return {
        success: true,
        data: await clearDebts({ dryRun: request.body.dryRun, actor: user.id, log: request.log }),
      };
    },
  );

  /** Email every customer with reversed bets not yet told, once each; `dryRun` only counts. */
  app.post(
    "/admin/recovery/notify",
    { schema: { body: recoveryNotifyBody }, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request) => {
      await requireAdmin(request);
      const { subject, text } = request.body;
      if ((subject === undefined) !== (text === undefined) || ((subject || text) && !request.body.customer)) {
        throw new ApiError(400, "An edited email needs a customer, a subject and the text", "BAD_EDIT");
      }
      const authUserId = request.body.customer ? await findCustomerId(request.body.customer) : undefined;
      return {
        success: true,
        data: await notifyReversals({
          dryRun: request.body.dryRun,
          ...(authUserId ? { authUserId } : {}),
          ...(subject && text ? { edited: { subject, text } } : {}),
          log: request.log,
        }),
      };
    },
  );

  /**
   * Every bet on a topic's markets that finished in the window — won,
   * lost or refunded — with who placed it and what they're up or down
   * (trading/topic-bets.ts). Topics default to the paused ones.
   */
  app.get("/admin/topic-bets", { schema: { querystring: topicBetsQuery } }, async (request) => {
    await requireAdmin(request);
    const asked = request.query.topics;
    const topics =
      asked === undefined ? (await getBookSettings()).pausedTopics : normalizeTopics(asked.split(","));
    if (topics.length === 0) {
      throw new ApiError(400, "Name at least one topic, e.g. bitcoin", "NO_TOPICS");
    }
    if (topics.length > 10) throw new ApiError(400, "At most 10 topics at once", "TOO_MANY_TOPICS");
    // a word, or a market's slug from a pasted link (longer than a saved topic)
    const bad = topics.find((t) => !isUsableTopic(t) && !MARKET_SLUG.test(t));
    if (bad !== undefined) {
      throw new ApiError(400, `"${bad}" isn't a usable topic — letters, numbers, spaces, dots or dashes`, "BAD_TOPIC");
    }
    const { sinceAt } = request.query;
    return {
      success: true,
      data: await getTopicBets(topics, request.query.hours, sinceAt ? new Date(sinceAt) : undefined),
    };
  });

  /**
   * Who the paused topics refunded, and how much: the markets voided and
   * the customers paid back, each with whether they've had the apology
   * email — over the last `hours` (default 3 days).
   */
  app.get("/admin/paused-refunds", { schema: { querystring: refundsQuery } }, async (request) => {
    await requireAdmin(request);
    const settings = await getBookSettings();
    return { success: true, data: await getPausedRefunds(settings.pausedTopics, request.query.hours) };
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
      const { search, sort, limit, offset, activeOnly, suspendedOnly, limitedOnly } = request.query;
      return {
        success: true,
        data: await listTraders({
          search,
          sort: sort as TraderSort,
          limit,
          offset,
          activeOnly,
          suspendedOnly,
          limitedOnly,
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

    const [positions, ledger, profile, money] = await Promise.all([
      Position.find({ authUserId }).sort({ createdAt: -1 }).limit(100).lean(),
      LedgerEntry.find({ authUserId }).sort({ createdAt: -1 }).limit(50).lean(),
      User.findOne({ authUserId }, { accountActions: 1 }).lean(),
      // all time, by kind — what the balance is made of, which the latest
      // 50 movements can't show for an account with hundreds of them
      LedgerEntry.aggregate<{ _id: string; amountKobo: number; count: number }>([
        { $match: { authUserId } },
        { $group: { _id: "$type", amountKobo: { $sum: "$amountKobo" }, count: { $sum: 1 } } },
      ]),
    ]);

    return {
      success: true,
      data: {
        trader,
        money: money.map((m) => ({ type: m._id, amountKobo: m.amountKobo, count: m.count })),
        // suspensions and reinstatements, newest first
        accountActions: [...(profile?.accountActions ?? [])].reverse().map((a) => ({
          action: a.action,
          reason: a.reason ?? "",
          by: a.by,
          at: a.at.toISOString(),
        })),
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
          // a voided bet the desk reversed after it settled, not a refund
          reversedFrom: p.reversedFrom ?? null,
          reversalReason: p.reversalReason ?? null,
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

  /**
   * Suspend an account: no new bets, no money in or out, until lifted.
   * Open bets settle as usual. The reason is recorded and, with
   * `notify`, emailed to the customer (accounts.ts).
   */
  app.post(
    "/admin/traders/:authUserId/suspend",
    { schema: { body: suspendBody }, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request) => {
      const actor = await requireAdmin(request);
      const { authUserId } = request.params as { authUserId: string };
      return {
        success: true,
        data: await suspendAccount({
          authUserId,
          reason: request.body.reason,
          notify: request.body.notify,
          actor: actor.label,
          log: request.log,
        }),
      };
    },
  );

  /**
   * Lock an account's withdrawals: it keeps betting and adding money, but
   * nothing goes out until unlocked. The customer learns of it only when
   * they try to withdraw (accounts.ts).
   */
  app.post(
    "/admin/traders/:authUserId/lock-withdrawals",
    { schema: { body: withdrawalLockBody }, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request) => {
      const actor = await requireAdmin(request);
      const { authUserId } = request.params as { authUserId: string };
      return {
        success: true,
        data: await lockWithdrawals({ authUserId, note: request.body.note, actor: actor.label, log: request.log }),
      };
    },
  );

  /**
   * Set a customer's stake level: normal, reduced or restricted, with the
   * desk's reason, kept on the account's history (accounts.ts).
   */
  app.post(
    "/admin/traders/:authUserId/stake-level",
    { schema: { body: stakeLevelBody }, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request) => {
      const actor = await requireAdmin(request);
      const { authUserId } = request.params as { authUserId: string };
      return {
        success: true,
        data: await setStakeLevel({
          authUserId,
          level: request.body.level,
          reason: request.body.reason,
          actor: actor.label,
          log: request.log,
        }),
      };
    },
  );

  /** Let the account withdraw again. */
  app.post(
    "/admin/traders/:authUserId/unlock-withdrawals",
    { schema: { body: withdrawalLockBody }, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request) => {
      const actor = await requireAdmin(request);
      const { authUserId } = request.params as { authUserId: string };
      return {
        success: true,
        data: await unlockWithdrawals({ authUserId, note: request.body.note, actor: actor.label, log: request.log }),
      };
    },
  );

  /** Lift a suspension; `notify` emails the customer that they're back. */
  app.post(
    "/admin/traders/:authUserId/reinstate",
    { schema: { body: reinstateBody }, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request) => {
      const actor = await requireAdmin(request);
      const { authUserId } = request.params as { authUserId: string };
      return {
        success: true,
        data: await reinstateAccount({
          authUserId,
          reason: request.body.reason,
          notify: request.body.notify,
          actor: actor.label,
          log: request.log,
        }),
      };
    },
  );

  /**
   * Alerts: every condition the API has alerted on (alerts.ts), open ones
   * first, with what else is waiting on the desk — support requests and
   * withdrawals the wallet never confirmed.
   */
  app.get("/admin/alerts", { schema: { querystring: alertsQuery } }, async (request) => {
    await requireAdmin(request);
    const [list, support, withdrawals] = await Promise.all([
      listAlerts(request.query.status),
      SupportTicket.countDocuments({ status: "open" }),
      WithdrawalCheck.countDocuments({ status: { $in: ["unconfirmed", "review"] } }),
    ]);
    return { success: true, data: { ...list, waiting: { support, withdrawals } } };
  });

  /**
   * Mark an alert settled, with an optional note; it reopens if it fires
   * again. Settling an abuse alert puts back the stake levels the scan
   * lowered for it (accounts.ts).
   */
  app.post("/admin/alerts/resolve", { schema: { body: resolveAlertBody } }, async (request) => {
    const actor = await requireAdmin(request);
    const alert = await resolveAlert(request.body.id, actor.label, request.body.note);
    const restored =
      alert.kind === "abuse"
        ? await restoreAutoStakeLevels({
            authUserIds: alert.authUserIds,
            alertId: request.body.id,
            actor: actor.label,
            why: `Cleared with the alert "${alert.subject}"`,
            log: request.log,
          })
        : 0;
    return { success: true, data: { id: request.body.id, restored } };
  });

  /**
   * Abuse watch: accounts beating the odds, buying near-certain sides,
   * moving in pairs, cashing out more than they put in, balances off
   * their ledger, and withdrawals the wallet never confirmed
   * (trading/abuse.ts). Read-only.
   */
  app.get("/admin/abuse", { schema: { querystring: abuseQuery } }, async (request) => {
    await requireAdmin(request);
    const days = request.query.days === 0 ? null : request.query.days;
    return { success: true, data: await getAbuseWatch(days) };
  });

  /** One customer's ₦90+ bets, counted from all their bets. Read-only. */
  app.get<{ Params: { authUserId: string } }>("/admin/traders/:authUserId/high-price-bets", async (request) => {
    await requireAdmin(request);
    return { success: true, data: await getCustomerBetReview(request.params.authUserId) };
  });

  /** Everyone with a withdrawal waiting: their requests stacked, their money beside them. */
  app.get("/admin/withdrawals", async (request) => {
    await requireAdmin(request);
    return { success: true, data: await getWithdrawalDesk() };
  });

  /** One account's balances right now, for the guided deposit and withdrawal test. */
  app.get("/admin/wallet-check/account", { schema: { querystring: testAccountQuery } }, async (request) => {
    await requireAdmin(request);
    return { success: true, data: await readTestAccount(request.query.account) };
  });

  /** The latest wallet checks (trading/wallet-check.ts). */
  app.get("/admin/wallet-check", async (request) => {
    await requireAdmin(request);
    return { success: true, data: { runs: await listWalletChecks() } };
  });

  /** Test the live wallet with 1 cent on one account, then take it back. */
  app.post(
    "/admin/wallet-check",
    { schema: { body: walletCheckBody }, config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (request) => {
      const actor = await requireAdmin(request);
      return { success: true, data: await runWalletCheck({ account: request.body.account, actor: actor.label }) };
    },
  );

  /**
   * Settle a withdrawal the wallet never confirmed: ask it again under
   * the same reference, or mark it paid / return the credit by hand
   * (trading/withdrawals.ts).
   */
  app.post(
    "/admin/withdrawal-checks/resolve",
    { schema: { body: withdrawalResolveBody }, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request) => {
      const actor = await requireAdmin(request);
      return {
        success: true,
        data: await resolveWithdrawalCheck({
          refKey: request.body.refKey,
          action: request.body.action,
          actor: actor.label,
          log: request.log,
        }),
      };
    },
  );

  /** Recent settlements, newest first — the audit trail. */
  app.get("/admin/settlements", async (request) => {
    await requireAdmin(request);
    const settlements = await Settlement.find().sort({ createdAt: -1 }).limit(100);
    // a settlement row only knows ids; the positions it paid carry the
    // names (denormalized at trade time), which is what the desk shows
    const names = new Map(
      (
        await Position.aggregate<{
          _id: string;
          eventTitle: string;
          marketTitle: string;
          eventSlug: string;
          outcomes: { id: string; label: string }[];
        }>([
          { $match: { marketId: { $in: settlements.map((s) => s.marketId) } } },
          {
            $group: {
              _id: "$marketId",
              eventTitle: { $first: "$eventTitle" },
              marketTitle: { $first: "$marketTitle" },
              eventSlug: { $first: "$eventSlug" },
              outcomes: { $addToSet: { id: "$outcomeId", label: "$outcomeLabel" } },
            },
          },
        ])
      ).map((n) => [n._id, n]),
    );
    return {
      success: true,
      data: {
        settlements: settlements.map((s) => ({
          id: String(s._id),
          eventId: s.eventId,
          marketId: s.marketId,
          eventTitle: names.get(s.marketId)?.eventTitle ?? null,
          marketTitle: names.get(s.marketId)?.marketTitle ?? null,
          eventSlug: names.get(s.marketId)?.eventSlug ?? null,
          // null when nobody had backed the winner, so no position names it
          winningOutcomeLabel:
            names.get(s.marketId)?.outcomes.find((o) => o.id === s.winningOutcomeId)?.label ??
            null,
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
