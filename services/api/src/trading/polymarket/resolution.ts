import type { GammaMarketRaw } from "./client.js";
import { parseList } from "./client.js";

/**
 * Reading Polymarket's result for one market.
 *
 * A market is settled here only once its answer is FINAL: Gamma has
 * closed it, UMA's resolution status is "resolved" (a "proposed" answer
 * can still be disputed and flipped), and the final prices are exactly
 * one outcome at 1 and the other at 0. A 50/50 split — Polymarket's
 * answer for an unresolvable question — is reported as a void, because
 * the book pays a whole share or nothing; those positions get their
 * stake back. Anything else is "not yet": the poller simply looks again.
 */
export type GammaResolution =
  | { kind: "winner"; index: 0 | 1 }
  | { kind: "void" }
  | null;

export function finalResolution(market: GammaMarketRaw): GammaResolution {
  if (!market.closed) return null;
  if ((market.umaResolutionStatus ?? "").toLowerCase() !== "resolved") return null;

  const prices = parseList(market.outcomePrices).map(Number);
  if (prices.length !== 2 || prices.some((p) => !Number.isFinite(p))) return null;
  const [a, b] = prices as [number, number];

  if (a === 1 && b === 0) return { kind: "winner", index: 0 };
  if (a === 0 && b === 1) return { kind: "winner", index: 1 };
  if (a === 0.5 && b === 0.5) return { kind: "void" };
  return null;
}
