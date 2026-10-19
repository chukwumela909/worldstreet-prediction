import { TradersDesk } from "@/components/admin/traders-desk";

/**
 * The people view: "Active traders" (everyone who has placed a bet) and
 * "All accounts", with what each person has staked, has in play, has
 * won or lost and is holding — sortable by most recent bet, most staked
 * and more. Read-only — money moves on the Local book desk at /admin.
 */
export default function AdminTradersPage() {
  return <TradersDesk />;
}
