import { MarketsDesk } from "@/components/admin/markets-desk";

/**
 * Where Worldstreet's own fixed-odds markets are written, priced and
 * published. Settling them is the Local book desk at /admin.
 */
export default function AdminMarketsPage() {
  return <MarketsDesk />;
}
