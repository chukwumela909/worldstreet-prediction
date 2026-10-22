"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftIcon as ArrowLeft,
  ArrowUturnLeftIcon as Recovery,
  BanknotesIcon as Coins,
  ChatBubbleLeftRightIcon as Support,
  Cog6ToothIcon as Settings,
  ShieldExclamationIcon as Shield,
  UsersIcon as Users,
} from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/auth-context";
import { setAdminKey, useAdminKey } from "@/lib/admin-key";
import { AdminUnlock } from "./admin-unlock";
import { CurrencySwitch } from "./currency-switch";

/**
 * The sidebar's sections. A section with more than one page shows them
 * as tabs along the top of the page — the pages and their addresses are
 * unchanged, only the sidebar is shorter.
 */
const NAV = [
  {
    label: "Book",
    icon: Coins,
    pages: [
      { href: "/admin", label: "Local book" },
      { href: "/admin/markets", label: "Our markets" },
    ],
  },
  { label: "Traders", icon: Users, pages: [{ href: "/admin/traders", label: "Traders" }] },
  {
    label: "Watch",
    icon: Shield,
    pages: [
      { href: "/admin/alerts", label: "Alerts" },
      { href: "/admin/abuse", label: "Abuse watch" },
    ],
  },
  {
    label: "Incidents",
    icon: Recovery,
    pages: [
      { href: "/admin/settled", label: "Settled bets" },
      { href: "/admin/recovery", label: "Recovery" },
    ],
  },
  { label: "Support", icon: Support, pages: [{ href: "/admin/support", label: "Support" }] },
  { label: "Settings", icon: Settings, pages: [{ href: "/admin/settings", label: "Settings" }] },
] as const;

const isOn = (href: string, pathname: string) =>
  href === "/admin" ? pathname === href : pathname.startsWith(href);

/**
 * Admin chrome: sidebar on desktop, horizontal tab row on mobile. Both
 * carry the "₦ | $" switch (CurrencySwitch) every amount on the desk
 * follows.
 *
 * The way in is an access key (AdminUnlock — kept for this tab, sent on
 * every admin call) or, as before, an account with the central Clerk
 * `admin` role. Either only gets you this far: every admin endpoint
 * checks the key or the role itself, and the desk renders that refusal
 * rather than pretending the page works.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, openAuth } = useAuth();
  const adminKey = useAdminKey();
  const pathname = usePathname();
  // a logged-in account without the admin role can still switch to a key
  const [unlocking, setUnlocking] = useState(false);

  // the stored key isn't readable until hydration — wait rather than
  // flash the unlock form at an admin who already unlocked this tab
  if (adminKey === undefined && !user) {
    return <main className="min-h-screen" aria-busy="true" />;
  }

  if (!adminKey && (!user || unlocking)) {
    return (
      <AdminUnlock
        onLogIn={user ? undefined : openAuth}
        onCancel={user ? () => setUnlocking(false) : undefined}
      />
    );
  }

  /** Who the desk is acting as, and the way to change it. */
  const identity = adminKey ? (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate text-xs text-secondary">
        Key: <span className="font-semibold text-primary">{adminKey.label}</span>
      </span>
      <button
        type="button"
        onClick={() => setAdminKey(null)}
        className="shrink-0 text-xs font-semibold text-accent-ink hover:underline"
      >
        Lock
      </button>
    </span>
  ) : (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate text-xs text-secondary">{user?.name}</span>
      <button
        type="button"
        onClick={() => setUnlocking(true)}
        className="shrink-0 text-xs font-semibold text-accent-ink hover:underline"
      >
        Use a key
      </button>
    </span>
  );

  const section = NAV.find((g) => g.pages.some((p) => isOn(p.href, pathname)));

  const nav = NAV.map(({ label, icon: Icon, pages }) => {
    const href = pages[0].href;
    const active = section?.label === label;
    return (
      <Link
        key={label}
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
        <div className="mb-3 flex flex-col gap-1.5 px-3">
          <span className="text-xs font-medium text-secondary">Show amounts in</span>
          <CurrencySwitch explainMissingRate />
        </div>
        {nav}
        <div className="mt-auto flex flex-col gap-1 border-t border-border pt-3">
          <div className="px-3">{identity}</div>
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
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 pt-2">{identity}</div>
          <CurrencySwitch align="end" />
        </div>
        <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{nav}</nav>
      </div>

      <main className="min-w-0 flex-1 px-4 pb-16 pt-6 lg:px-8">
        {section && section.pages.length > 1 && (
          <nav
            aria-label={`${section.label} pages`}
            className="mb-5 inline-flex max-w-full overflow-x-auto rounded-md bg-element-2 p-1"
          >
            {section.pages.map((p) => {
              const on = isOn(p.href, pathname);
              return (
                <Link
                  key={p.href}
                  href={p.href}
                  aria-current={on ? "page" : undefined}
                  className={`h-9 shrink-0 whitespace-nowrap rounded-sm px-4 text-sm font-semibold leading-9 transition-colors ${
                    on ? "bg-surface text-primary shadow-card" : "text-secondary hover:text-primary"
                  }`}
                >
                  {p.label}
                </Link>
              );
            })}
          </nav>
        )}
        {children}
      </main>
    </div>
  );
}
