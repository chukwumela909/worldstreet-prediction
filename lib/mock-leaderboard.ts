/**
 * Mock leaderboard fixtures modeled on polymarket.com/leaderboard
 * (recon 2026-07-17): ranked traders with profit + volume per period,
 * and a "Biggest wins" rail. Avatars are deterministic CSS gradients.
 */

export const LEADERBOARD_PERIODS = ["Today", "Weekly", "Monthly", "All"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

export interface Trader {
  name: string;
  /** Profit per period, USD. */
  profit: Record<LeaderboardPeriod, number>;
  /** Volume per period, USD. */
  volume: Record<LeaderboardPeriod, number>;
}

const seed = (
  name: string,
  monthlyProfit: number,
  monthlyVolume: number,
): Trader => ({
  name,
  profit: {
    Today: Math.round(monthlyProfit * 0.031),
    Weekly: Math.round(monthlyProfit * 0.22),
    Monthly: monthlyProfit,
    All: Math.round(monthlyProfit * 7.4),
  },
  volume: {
    Today: Math.round(monthlyVolume * 0.028),
    Weekly: Math.round(monthlyVolume * 0.24),
    Monthly: monthlyVolume,
    All: Math.round(monthlyVolume * 9.1),
  },
});

export const MOCK_TRADERS: Trader[] = [
  seed("deepvalue", 8_052_185, 72_132_443),
  seed("swisstony", 5_971_733, 330_921_996),
  seed("candlehammer", 3_009_712, 17_937_424),
  seed("gud-alpha", 2_730_259, 9_882_106),
  seed("maz26", 2_581_221, 44_120_580),
  seed("asparagus2012", 2_276_290, 12_400_338),
  seed("sparkling8899", 2_275_393, 89_567_014),
  seed("muchobliged", 2_029_201, 7_204_996),
  seed("allezpapa", 1_856_427, 15_338_820),
  seed("weatherman12", 1_822_553, 26_671_243),
  seed("palegrit", 1_692_747, 5_910_411),
  seed("ramadam", 1_531_540, 33_804_162),
  seed("hot2trot", 1_481_339, 11_260_774),
  seed("nightowl-cap", 1_426_203, 8_871_530),
  seed("cnyek", 1_398_912, 19_240_066),
  seed("jsram", 1_396_043, 6_115_982),
  seed("tankjack", 1_264_668, 41_775_301),
  seed("myzbsq", 1_244_222, 9_053_617),
  seed("latetotheparty", 1_243_122, 14_662_090),
  seed("highnetworth", 1_205_800, 22_408_455),
];

export interface BigWin {
  trader: string;
  market: string;
  stake: number;
  payout: number;
}

export const MOCK_BIG_WINS: BigWin[] = [
  { trader: "deepvalue", market: "France vs. Spain — Moneyline", stake: 4_884_167, payout: 10_980_912 },
  { trader: "deepvalue", market: "France vs. Spain", stake: 6_394_390, payout: 10_195_543 },
  { trader: "deepvalue", market: "Switzerland vs. Colombia", stake: 1_920_582, payout: 5_685_222 },
  { trader: "1two1two", market: "Paraguay vs. France — Moneyline", stake: 2_753_782, payout: 6_385_478 },
  { trader: "muchobliged", market: "England vs. DR Congo", stake: 2_298_994, payout: 4_695_964 },
  { trader: "coldsway", market: "Australia vs. Egypt", stake: 2_171_102, payout: 4_253_504 },
  { trader: "muchobliged", market: "Switzerland vs. Colombia", stake: 2_622_456, payout: 4_587_409 },
];

/** Deterministic avatar gradient from a username. */
export function avatarGradient(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  const h2 = (h + 110) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 60%), hsl(${h2} 70% 45%))`;
}
