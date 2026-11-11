import { OpenMarketsDesk } from "@/components/admin/open-markets-desk";

/**
 * Every market with open bets, ours and Bayse's, to settle or void, and the
 * controls for a type of market: stop new bets, close and refund, close early.
 */
export default function AdminOpenMarketsPage() {
  return <OpenMarketsDesk />;
}
