import { Suspense } from "react";
import { TodayDesk } from "@/components/admin/today-desk";

/**
 * Today: what needs someone now (markets to pay out, customers to check,
 * money at risk, withdrawals and support waiting) and how the book stands.
 * Alert emails link here as ?alert=<id> (Suspense: it reads the URL).
 */
export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <TodayDesk />
    </Suspense>
  );
}
