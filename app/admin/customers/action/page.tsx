import { Suspense } from "react";
import { TakeActionDesk } from "@/components/admin/take-action-desk";

/**
 * Take action on a type of market: who bet on it, close it, take back
 * what one customer or everyone won on it, email them why, clear what's
 * owed, and every incident so far.
 */
export default function AdminTakeActionPage() {
  return (
    <Suspense fallback={null}>
      <TakeActionDesk />
    </Suspense>
  );
}
