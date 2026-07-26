import type { FastifyBaseLogger } from "fastify";
import { ApiError } from "../errors.js";
import { PAYOUT_PER_SHARE_KOBO } from "./ledger.js";
import {
  WorldstreetEvent,
  WorldstreetMarket,
  type IWorldstreetEvent,
  type IWorldstreetMarket,
} from "./models.js";

/**
 * Worldstreet's own markets — the half of the Local book we write
 * ourselves, on fixed odds.
 *
 * There is no maker and no order book here: the desk types a price per
 * outcome and that is the price until the desk types another one. The
 * two prices of a market are set independently and normally sum to
 * more than a share pays, and that overround IS the house's edge —
 * a book priced at ₦55/₦50 keeps ₦5 of every matched ₦105. Pricing the
 * book under 100% would hand a guaranteed profit to anyone who bought
 * both sides, so `assertPriceable` refuses it.
 *
 * Everything here is storage and validation. Turning these rows into
 * something tradeable is trading/events.ts, which is also what the
 * trade route and the settlement engine talk to.
 */

/* ------------------------------------------------------------------ */
/* Pricing                                                             */
/* ------------------------------------------------------------------ */

/** ₦1 — below this a share is priced like a rounding error. */
export const MIN_OUTCOME_PRICE_KOBO = 100;
/** ₦99 — a certainty still has to pay something. */
export const MAX_OUTCOME_PRICE_KOBO = 9_900;
/** 30% overround. Anything fatter is a fat finger, not a margin. */
export const MAX_MARGIN_BPS = 3_000;

/**
 * The house edge baked into a set of prices, in basis points. The book
 * pays ₦100 (10 000 kobo) per share, so a book summing to 10 500 kobo
 * is 5% over — and because the payout is 10 000, kobo over parity and
 * basis points are the same number.
 */
export function bookMarginBps(pricesKobo: number[]): number {
  return pricesKobo.reduce((sum, p) => sum + p, 0) - PAYOUT_PER_SHARE_KOBO;
}

export interface OutcomeInput {
  label: string;
  priceKobo: number;
}

/** Reject a market nobody should be able to trade against the house. */
export function assertPriceable(outcomes: OutcomeInput[]): void {
  if (outcomes.length !== 2) {
    throw new ApiError(400, "A market needs exactly two outcomes", "BAD_MARKET");
  }
  const labels = outcomes.map((o) => o.label.trim().toLowerCase());
  if (labels.some((l) => l.length === 0)) {
    throw new ApiError(400, "Every outcome needs a label", "BAD_MARKET");
  }
  if (labels[0] === labels[1]) {
    throw new ApiError(400, "The two outcomes need different labels", "BAD_MARKET");
  }
  for (const { priceKobo } of outcomes) {
    if (
      !Number.isInteger(priceKobo) ||
      priceKobo < MIN_OUTCOME_PRICE_KOBO ||
      priceKobo > MAX_OUTCOME_PRICE_KOBO
    ) {
      throw new ApiError(
        400,
        `Each price must be a whole ₦${MIN_OUTCOME_PRICE_KOBO / 100}–₦${
          MAX_OUTCOME_PRICE_KOBO / 100
        } per ₦100 share`,
        "BAD_PRICE",
      );
    }
  }

  const marginBps = bookMarginBps(outcomes.map((o) => o.priceKobo));
  if (marginBps < 0) {
    throw new ApiError(
      400,
      "The two prices must add up to at least ₦100 — a shorter book pays anyone who buys both sides",
      "BAD_PRICE",
    );
  }
  if (marginBps > MAX_MARGIN_BPS) {
    throw new ApiError(
      400,
      `That book is ${(marginBps / 100).toFixed(1)}% over — the cap is ${
        MAX_MARGIN_BPS / 100
      }%`,
      "BAD_PRICE",
    );
  }
}

/* ------------------------------------------------------------------ */
/* Slugs                                                               */
/* ------------------------------------------------------------------ */

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72)
      .replace(/-+$/g, "") || "market"
  );
}

/**
 * A URL slug for a title, suffixed until it is free. `keepEventId` is
 * the event being renamed, so a title edit that produces the same slug
 * doesn't collide with itself.
 */
export async function uniqueSlug(
  title: string,
  keepEventId?: string,
): Promise<string> {
  const base = slugify(title);
  for (let suffix = 0; suffix < 200; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const clash = await WorldstreetEvent.findOne({ slug: candidate })
      .select("eventId")
      .lean();
    if (!clash || clash.eventId === keepEventId) return candidate;
  }
  // 200 events with one title is not a real case; fail loudly if it is.
  throw new ApiError(409, "Could not find a free slug for that title", "SLUG_TAKEN");
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

export interface WorldstreetEventRecord {
  event: IWorldstreetEvent;
  markets: IWorldstreetMarket[];
}

/**
 * Our events by id, with their markets, in two queries. Ids that
 * aren't ours are simply absent — which is how trading/events.ts tells
 * the two origins apart without a discriminator on Position.
 */
export async function loadWorldstreetEvents(
  eventIds: string[],
): Promise<Map<string, WorldstreetEventRecord>> {
  const out = new Map<string, WorldstreetEventRecord>();
  if (eventIds.length === 0) return out;

  const events = await WorldstreetEvent.find({ eventId: { $in: eventIds } });
  if (events.length === 0) return out;

  const markets = await WorldstreetMarket.find({
    eventId: { $in: events.map((e) => e.eventId) },
  }).sort({ order: 1, createdAt: 1 });

  for (const event of events) {
    out.set(event.eventId, {
      event,
      markets: markets.filter((m) => m.eventId === event.eventId),
    });
  }
  return out;
}

export async function loadWorldstreetEvent(
  eventId: string,
): Promise<WorldstreetEventRecord | null> {
  return (await loadWorldstreetEvents([eventId])).get(eventId) ?? null;
}

export async function loadWorldstreetEventBySlug(
  slug: string,
): Promise<WorldstreetEventRecord | null> {
  const event = await WorldstreetEvent.findOne({ slug });
  if (!event) return null;
  return loadWorldstreetEvent(event.eventId);
}

/* ------------------------------------------------------------------ */
/* Settlement bookkeeping                                              */
/* ------------------------------------------------------------------ */

/**
 * Close the books on one of our markets after the settlement engine
 * has paid it out: record the winner, stop it taking stakes, and roll
 * the event to resolved once nothing on it is still live. A no-op for
 * Bayse markets, which is what lets settlement.ts stay origin-blind.
 *
 * Called after the money has already moved, so a failure here is
 * logged rather than thrown — it would otherwise turn a completed
 * payout into an error the desk might retry.
 */
export async function markWorldstreetSettled(params: {
  marketId: string;
  winningOutcomeId: string | null;
  voided: boolean;
  log: FastifyBaseLogger;
}): Promise<void> {
  const { marketId, winningOutcomeId, voided, log } = params;
  try {
    const updated = await WorldstreetMarket.findOneAndUpdate(
      { marketId },
      {
        $set: {
          status: voided ? "cancelled" : "resolved",
          resolvedOutcomeId: voided ? null : winningOutcomeId,
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) return; // a Bayse market — nothing of ours to close

    const live = await WorldstreetMarket.countDocuments({
      eventId: updated.eventId,
      status: { $in: ["open", "closed"] },
    });
    if (live > 0) return;

    const allVoided = await WorldstreetMarket.countDocuments({
      eventId: updated.eventId,
      status: { $ne: "cancelled" },
    });
    await WorldstreetEvent.updateOne(
      { eventId: updated.eventId, status: { $nin: ["resolved", "cancelled"] } },
      { $set: { status: allVoided === 0 ? "cancelled" : "resolved" } },
    );
  } catch (err) {
    log.error({ err, marketId }, "could not close out a Worldstreet market");
  }
}
