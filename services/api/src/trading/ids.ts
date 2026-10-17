import { z } from "zod";

/**
 * Ids the trading routes accept. Local-book events, markets and outcomes
 * are UUIDs (ours and Bayse's alike); international ones are Polymarket's
 * — integer Gamma ids for events and markets, and CLOB token ids (long
 * integers, up to ~78 digits) for outcomes. Anything else is rejected
 * before it can reach an upstream URL.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const eventOrMarketId = z
  .string()
  .refine((v) => UUID.test(v) || /^\d{1,20}$/.test(v), "Invalid id");

export const outcomeId = z
  .string()
  .refine((v) => UUID.test(v) || /^\d{1,100}$/.test(v), "Invalid id");
