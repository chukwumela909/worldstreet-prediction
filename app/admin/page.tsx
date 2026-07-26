import { LocalDesk } from "@/components/admin/local-desk";

/**
 * The Local book's operating desk: the FX rate and settlement, for both
 * origins of market. Writing Worldstreet's own markets is /admin/markets.
 */
export default function AdminPage() {
  return <LocalDesk />;
}
