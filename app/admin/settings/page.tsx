import { SettingsDesk } from "@/components/admin/settings-desk";

/**
 * How the book prices and limits bets: spreads, stake limits, the
 * per-market loss cap and the international on/off switch. Every save
 * is audited, and the API serves the new values within about a minute.
 */
export default function AdminSettingsPage() {
  return <SettingsDesk />;
}
