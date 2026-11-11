import { Suspense } from "react";
import { TradersDesk } from "@/components/admin/traders-desk";

/**
 * The people: "Active traders" (everyone who has placed a bet) and "All
 * accounts", sortable, each opening onto everything the desk does to one
 * customer: suspend, lock withdrawals, their bets, taking back winnings.
 */
export default function AdminCustomersPage() {
  return (
    <Suspense fallback={null}>
      <TradersDesk />
    </Suspense>
  );
}
