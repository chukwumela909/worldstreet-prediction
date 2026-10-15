"use client";

import { usePathname } from "next/navigation";

/**
 * Shows the public site's chrome everywhere except the admin desk, which
 * has its own shell. The chrome is passed in as children, so it is still
 * rendered on the server; this only decides whether it appears.
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith("/admin")) return null;
  return <>{children}</>;
}
