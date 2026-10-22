import { AbuseDesk } from "@/components/admin/abuse-desk";

/**
 * Patterns that point to money being taken that shouldn't be — beating
 * the odds, near-certain buying, paired accounts, cash-outs, ledger gaps —
 * and withdrawals the wallet never confirmed.
 */
export default function AdminAbusePage() {
  return <AbuseDesk />;
}
