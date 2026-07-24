import { LocalDesk } from "@/components/admin/local-desk";

/**
 * The admin is the Local book's desk — the one surface with a backend
 * behind it. The market-authoring, resolution, content and audit pages
 * that used to live here ran on a localStorage mock with nothing to
 * point at, and were removed rather than left looking operational.
 */
export default function AdminPage() {
  return <LocalDesk />;
}
