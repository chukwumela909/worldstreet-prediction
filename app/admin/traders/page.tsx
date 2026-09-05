import { TradersDesk } from "@/components/admin/traders-desk";

/**
 * The people view: who has an account, what they have staked and what
 * each of them is actually holding. Read-only — money moves on the
 * Local book desk at /admin.
 */
export default function AdminTradersPage() {
  return <TradersDesk />;
}
