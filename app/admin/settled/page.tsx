import { SettledDesk } from "@/components/admin/settled-desk";

/**
 * Every bet on a topic's markets that finished — won, lost or refunded —
 * and who placed it, starting from the paused topics (Bitcoin).
 */
export default function AdminSettledPage() {
  return <SettledDesk />;
}
