"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  Gavel,
  LayoutDashboard,
  LayoutTemplate,
  ScrollText,
  Table2,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/markets", label: "Markets", icon: Table2 },
  { href: "/admin/resolution", label: "Resolution", icon: Gavel },
  { href: "/admin/content", label: "Content", icon: LayoutTemplate },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
] as const;

/**
 * Admin chrome: sidebar on desktop, horizontal tab row on mobile.
 * Any signed-in user counts as an admin — mock auth, demo only.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, openAuth } = useAuth();
  const pathname = usePathname();

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-card">
          <h1 className="text-xl font-semibold">Worldstreet Admin</h1>
          <p className="mt-2 text-sm text-secondary">
            Log in to manage markets, resolutions, and site content.
          </p>
          <button
            onClick={openAuth}
            className="mt-5 h-11 w-full rounded-md bg-accent text-base font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            Log In
          </button>
        </div>
      </main>
    );
  }

  const nav = NAV.map(({ href, label, icon: Icon }) => {
    const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        className={`flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
          active
            ? "bg-element-2 text-primary"
            : "text-secondary hover:bg-element-2 hover:text-primary"
        }`}
      >
        <Icon className="size-4" />
        {label}
      </Link>
    );
  });

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col lg:flex-row">
      {/* sidebar (desktop) */}
      <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border px-3 py-5 lg:flex">
        <div className="mb-4 px-3">
          <div className="text-base font-bold tracking-tight">Worldstreet</div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
            Admin
          </div>
        </div>
        {nav}
        <div className="mt-auto flex flex-col gap-1 border-t border-border pt-3">
          <div className="truncate px-3 text-xs text-secondary">{user.name}</div>
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold text-secondary transition-colors hover:bg-element-2 hover:text-primary"
          >
            <ArrowLeft className="size-4" />
            Back to site
          </Link>
        </div>
      </aside>

      {/* top bar (mobile) */}
      <div className="flex flex-col gap-2 border-b border-border px-4 pb-2 pt-4 lg:hidden">
        <div className="flex items-center justify-between">
          <div className="text-base font-bold tracking-tight">
            Worldstreet <span className="text-secondary">Admin</span>
          </div>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm font-semibold text-secondary hover:text-primary"
          >
            <ArrowLeft className="size-3.5" />
            Site
          </Link>
        </div>
        <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{nav}</nav>
      </div>

      <main className="min-w-0 flex-1 px-4 pb-16 pt-6 lg:px-8">{children}</main>
    </div>
  );
}
