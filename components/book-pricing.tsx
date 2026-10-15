import { quoteKobo, quoteMultiplier } from "@/lib/book";

/**
 * Book quotes for components — see lib/book.ts. Only the Local book is
 * quoted today, so there's nothing to bind; the hook stays the one seam
 * every price goes through, which is where the international house
 * book's API-published spread hands down when it ships (parked on the
 * `international-book` branch).
 */
const QUOTE = { quoteKobo, quoteMultiplier };

export function useQuote() {
  return QUOTE;
}
