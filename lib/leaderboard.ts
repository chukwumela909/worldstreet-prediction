"use client";

import { apiFetch, isApiConfigured } from "@/lib/api-client";

/**
 * Trader rankings over the Local book (services/api `/v1/leaderboard`).
 *
 * These are this platform's own traders and its own credit P&L. The page
 * used to render Polymarket's leaderboard — real numbers, but real
 * numbers about other people's users on another exchange, shown under our
 * heading as though they were ours.
 */

export const LEADERBOARD_WINDOWS = ["1d", "1w", "30d", "all"] as const;
export type LeaderboardWindow = (typeof LEADERBOARD_WINDOWS)[number];

export type LeaderboardSort = "pnl" | "vol";

export interface LeaderboardTrader {
  rank: number;
  username: string;
  displayName: string;
  avatar: string;
  /** Realized profit in kobo; negative for a losing window. */
  profitKobo: number;
  volumeKobo: number;
}

/** Stable hue for the fallback avatar, derived from the name. */
export function avatarHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export async function fetchLeaderboard(
  window: LeaderboardWindow,
  sort: LeaderboardSort,
  limit = 30,
): Promise<LeaderboardTrader[]> {
  if (!isApiConfigured()) {
    throw new Error("The prediction API is not configured");
  }
  const res = await apiFetch<{ data: { traders: LeaderboardTrader[] } }>(
    `/v1/leaderboard?window=${window}&sort=${sort}&limit=${limit}`,
  );
  return res.data.traders;
}
