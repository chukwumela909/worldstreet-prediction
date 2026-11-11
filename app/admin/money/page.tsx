import { Suspense } from "react";
import { WithdrawalsDesk } from "@/components/admin/withdrawals-desk";

/**
 * Withdrawals waiting on an admin, stacked by customer with their money
 * beside them. Withdrawal alerts link here as ?customer=<authUserId>
 * (Suspense: it reads the URL).
 */
export default function AdminMoneyPage() {
  return (
    <Suspense fallback={null}>
      <WithdrawalsDesk />
    </Suspense>
  );
}
