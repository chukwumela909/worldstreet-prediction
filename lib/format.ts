/** Compact USD amount: 4248952871 → "$4.2B", 970000 → "$970K". */
export function formatUsdCompact(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  if (n >= 1_000_000_000) return `$${trimZero(n / 1_000_000_000)}B`;
  if (n >= 1_000_000) return `$${trimZero(n / 1_000_000)}M`;
  if (n >= 1_000) return `$${trimZero(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

/** Format a decimal-string USD volume like Polymarket: "$4,248,952,871 Vol." → "$4B Vol." on cards. */
export function formatVolume(volume: string): string {
  const n = parseFloat(volume);
  if (Number.isNaN(n)) return "$0 Vol.";
  return `${formatUsdCompact(n)} Vol.`;
}

/**
 * The Local book's currency is naira end to end — the ledger, the API and
 * Bayse all speak NGN/kobo — but it is presented to users as "Credit"
 * under the ₩ sign. Every rendered amount goes through this symbol so the
 * mark is a one-line change.
 */
export const CREDIT = "₩";

/** Compact credit amount: 2779660 → "₩2.8M", 69491 → "₩69.5K". */
export function formatNairaCompact(n: number): string {
  if (!Number.isFinite(n)) return `${CREDIT}0`;
  if (n >= 1_000_000_000) return `${CREDIT}${trimZero(n / 1_000_000_000)}B`;
  if (n >= 1_000_000) return `${CREDIT}${trimZero(n / 1_000_000)}M`;
  if (n >= 1_000) return `${CREDIT}${trimZero(n / 1_000)}K`;
  return `${CREDIT}${Math.round(n)}`;
}

/**
 * Kobo → "₩12,500" / "₩12,500.75". Credit amounts in the Local book are
 * integer kobo end to end; only show the decimals when there are any.
 */
export function formatNaira(kobo: number): string {
  if (!Number.isFinite(kobo)) return `${CREDIT}0`;
  const naira = kobo / 100;
  return `${CREDIT}${naira.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: kobo % 100 === 0 ? 0 : 2,
  })}`;
}

/**
 * Signed credit amount with the sign outside the mark: "−₩4,200",
 * "+₩5,800". `formatNaira` on its own puts a hyphen between the two
 * ("₩-4,200"), which reads as part of the number rather than its sign —
 * fine nowhere, and worst on the admin desk where the sign IS the point.
 */
export function formatNairaSigned(kobo: number): string {
  if (!Number.isFinite(kobo)) return `${CREDIT}0`;
  return `${kobo < 0 ? "−" : "+"}${formatNaira(Math.abs(kobo))}`;
}

function trimZero(n: number): string {
  const fixed = n >= 100 ? n.toFixed(0) : n.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

/** "0.582" → 58 (rounded percent). */
export function toPercent(price: string): number {
  return Math.round(parseFloat(price) * 100);
}

/**
 * "0.582" → "1.72x" — what one unit staked returns if the outcome hits.
 * A winning share always settles at 1 whole unit, so the multiple is just
 * the inverse of the price. Prices at the rails make it meaningless
 * (0 pays out infinitely, 1 pays out nothing), so those render as "—".
 */
export function toMultiplier(price: string): string {
  const p = parseFloat(price);
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return "—";
  const m = 1 / p;
  // Longshots run to four figures (a 0.05% runner really does pay 2000x).
  // Precision that matters near evens is noise out there, and the extra
  // glyphs shove the row's numbers out of alignment, so drop decimals as
  // the multiple climbs.
  const digits = m < 10 ? 2 : m < 100 ? 1 : 0;
  return `${m.toFixed(digits)}x`;
}

/** "0.582" → "58.2¢" (price in cents, one decimal). */
export function toCents(price: string): string {
  return `${(parseFloat(price) * 100).toFixed(1)}¢`;
}

/** Relative time for feeds: "just now", "5m ago", "2h ago", "3d ago". */
export function timeAgo(msEpoch: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - msEpoch) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}
