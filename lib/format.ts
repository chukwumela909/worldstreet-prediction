/** Format a decimal-string USD volume like Polymarket: "$4,248,952,871 Vol." → "$4B Vol." on cards. */
export function formatVolume(volume: string): string {
  const n = parseFloat(volume);
  if (Number.isNaN(n)) return "$0 Vol.";
  if (n >= 1_000_000_000) return `$${trimZero(n / 1_000_000_000)}B Vol.`;
  if (n >= 1_000_000) return `$${trimZero(n / 1_000_000)}M Vol.`;
  if (n >= 1_000) return `$${trimZero(n / 1_000)}K Vol.`;
  return `$${Math.round(n)} Vol.`;
}

function trimZero(n: number): string {
  const fixed = n >= 100 ? n.toFixed(0) : n.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

/** "0.582" → 58 (rounded percent). */
export function toPercent(price: string): number {
  return Math.round(parseFloat(price) * 100);
}

/** "0.582" → "58.2¢" (price in cents, one decimal). */
export function toCents(price: string): string {
  return `${(parseFloat(price) * 100).toFixed(1)}¢`;
}
