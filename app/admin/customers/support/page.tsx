import { Suspense } from "react";
import { SupportDesk } from "@/components/admin/support-desk";

/**
 * Customers' questions from the site's Support page, and the desk's
 * replies. Support emails link here as ?ref=WS-… (Suspense: it reads the URL).
 */
export default function AdminSupportPage() {
  return (
    <Suspense fallback={null}>
      <SupportDesk />
    </Suspense>
  );
}
