"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeftIcon as ArrowLeft,
  Bars3Icon as Menu,
  BanknotesIcon as Money,
  BeakerIcon as Test,
  BellAlertIcon as Bell,
  ChartBarIcon as Markets,
  ChatBubbleLeftRightIcon as Support,
  Cog6ToothIcon as Settings,
  FlagIcon as Flag,
  GlobeAltIcon as Open,
  InboxIcon as Today,
  MagnifyingGlassIcon as Search,
  ShieldExclamationIcon as Action,
  UsersIcon as Users,
  XMarkIcon as X,
} from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/auth-context";
import { fetchAlerts } from "@/lib/admin-api";
import { isApiConfigured } from "@/lib/api-client";
import { setAdminKey, useAdminKey } from "@/lib/admin-key";
import { AdminUnlock } from "./admin-unlock";
import { CurrencySwitch } from "./currency-switch";
import { Avatar } from "./kit";

/**
 * The desk's chrome, after the WorldStreet console: a darker sidebar with
 * a search box, every page listed under what kind of work it is — the two
 * queues (Support, Withdrawals) and Today carry live counts — and, at the
 * foot, the ₦/$ switch with the hide-amounts eye, who you are, and the
 * way back to the site. On a phone the sidebar slides out from a menu
 * button.
 *
 * The search box goes straight to the thing: a request number (WS-…)
 * opens that request; anything else searches the people.
 *
 * The way in is an access key (AdminUnlock — kept for this tab, sent on
 * every admin call) or, as before, an account with the central Clerk
 * `admin` role. Either only gets you this far: every admin endpoint
 * checks the key or the role itself, and the desk renders that refusal
 * rather than pretending the page works. The old addresses redirect
 * here (next.config.ts).
 */

type CountKey = "alerts" | "support" | "withdrawals";

interface NavPage {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: CountKey;
}

const NAV: { title?: string; pages: NavPage[] }[] = [
  { pages: [{ href: "/admin", label: "Today", icon: Today, count: "alerts" }] },
  {
    title: "Inbox",
    pages: [
      { href: "/admin/customers/support", label: "Support", icon: Support, count: "support" },
      { href: "/admin/money", label: "Withdrawals", icon: Money, count: "withdrawals" },
    ],
  },
  {
    title: "Markets",
    pages: [
      { href: "/admin/markets", label: "Our markets", icon: Markets },
      { href: "/admin/markets/open", label: "All open", icon: Open },
    ],
  },
  {
    title: "Customers",
    pages: [
      { href: "/admin/customers", label: "People", icon: Users },
      { href: "/admin/customers/flagged", label: "Flagged", icon: Flag },
      { href: "/admin/customers/action", label: "Take action", icon: Action },
    ],
  },
  {
    title: "Tools",
    pages: [
      { href: "/admin/alert-test", label: "Alert test", icon: Bell },
      { href: "/admin/money/wallet-test", label: "Wallet test", icon: Test },
      { href: "/admin/settings", label: "Settings", icon: Settings },
    ],
  },
];

const PAGES = NAV.flatMap((g) => g.pages.map((p) => p.href));

/** The page the address belongs to: the longest href it is, or sits under. */
function currentHref(pathname: string): string | null {
  let best: string | null = null;
  for (const href of PAGES) {
    if ((pathname === href || pathname.startsWith(`${href}/`)) && (!best || href.length > best.length)) best = href;
  }
  return best;
}

const REQUEST_REF = /^WS-[A-Z0-9]{6}$/i;
const COUNTS_EVERY_MS = 60_000;

/** What's waiting, for the sidebar's counts; re-read every minute. */
function useWaitingCounts(enabled: boolean): Partial<Record<CountKey, number>> {
  const [counts, setCounts] = useState<Partial<Record<CountKey, number>>>({});
  useEffect(() => {
    if (!enabled || !isApiConfigured()) return;
    let cancelled = false;
    const read = () =>
      fetchAlerts("open")
        .then((v) => {
          if (!cancelled) {
            setCounts({ alerts: v.counts.open, support: v.waiting.support, withdrawals: v.waiting.withdrawals });
          }
        })
        .catch(() => undefined); // counts are a nicety; the pages say what's wrong
    void read();
    const timer = setInterval(read, COUNTS_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);
  return counts;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, openAuth } = useAuth();
  const adminKey = useAdminKey();
  const pathname = usePathname();
  // a logged-in account without the admin role can still switch to a key
  const [unlocking, setUnlocking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const signedIn = Boolean(adminKey) || (Boolean(user) && !unlocking);
  const counts = useWaitingCounts(signedIn);

  // a page change closes the phone menu
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }

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

  const who = adminKey ? adminKey.label : (user?.name ?? "Admin");
  const identity = (
    <div className="flex min-w-0 items-center gap-2.5 px-2">
      <Avatar name={who} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{who}</p>
        <p className="truncate text-xs text-tertiary">{adminKey ? "Access key" : "Admin account"}</p>
      </div>
      <button
        type="button"
        onClick={() => (adminKey ? setAdminKey(null) : setUnlocking(true))}
        className="shrink-0 rounded-sm px-2 py-1 text-xs font-semibold text-accent-ink hover:bg-element-2"
      >
        {adminKey ? "Lock" : "Use a key"}
      </button>
    </div>
  );

  const sidebar = (
    <Sidebar
      here={currentHref(pathname)}
      counts={counts}
      identity={identity}
      onClose={menuOpen ? () => setMenuOpen(false) : undefined}
    />
  );

  return (
    <div className="flex min-h-screen w-full">
      {/* sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-border bg-sunken lg:flex">
        {sidebar}
      </aside>

      {/* sidebar (phone): slides out from the menu button */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-alpha-black-600" onClick={() => setMenuOpen(false)} aria-hidden />
          <aside className="relative flex h-full w-[min(18rem,85vw)] border-r border-border bg-sunken shadow-popover">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* top bar (phone) */}
        <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-page px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open the menu"
            className="-ml-2 inline-flex size-9 items-center justify-center rounded-sm text-secondary hover:bg-element-2 hover:text-primary"
          >
            <Menu className="size-5" />
          </button>
          <span className="text-base font-bold tracking-tight">
            WS Predict{" "}
            {/* silver: a bright-to-grey sheen off the neutral ladder */}
            <span className="bg-gradient-to-b from-neutral-900 via-neutral-600 to-neutral-500 bg-clip-text text-transparent">
              Admin
            </span>
          </span>
          <span className="flex-1" />
          <CurrencySwitch align="end" />
        </div>

        <main className="min-w-0 flex-1 px-4 pb-16 pt-6 lg:px-8 lg:pt-8">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({
  here,
  counts,
  identity,
  onClose,
}: {
  here: string | null;
  counts: Partial<Record<CountKey, number>>;
  identity: React.ReactNode;
  /** Set on a phone: the close button. */
  onClose?: (() => void) | undefined;
}) {
  return (
    <div className="flex min-h-0 w-full flex-col">
      <div className="flex items-center justify-between gap-2 px-5 pb-3 pt-5">
        <div>
          <div className="text-base font-bold tracking-tight">WS Predict</div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">Admin</div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the menu"
            className="inline-flex size-9 items-center justify-center rounded-sm text-secondary hover:bg-element-2 hover:text-primary"
          >
            <X className="size-5" />
          </button>
        )}
      </div>

      <div className="px-3 pb-2">
        <DeskSearch />
      </div>

      <nav aria-label="Admin" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {NAV.map((group, i) => (
          <div key={group.title ?? i} className="mt-3 first:mt-1">
            {group.title && (
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-tertiary">{group.title}</p>
            )}
            <ul className="flex flex-col gap-0.5">
              {group.pages.map(({ href, label, icon: Icon, count }) => {
                const on = href === here;
                const n = count ? counts[count] : undefined;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={on ? "page" : undefined}
                      className={`flex h-9 items-center gap-2.5 rounded-md px-3 text-sm transition-colors ${
                        on
                          ? "bg-element-2 font-semibold text-primary"
                          : "font-medium text-secondary hover:bg-element-2 hover:text-primary"
                      }`}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="flex-1 truncate">{label}</span>
                      {n !== undefined && n > 0 && (
                        <span
                          className="min-w-5 rounded-full bg-accent px-1.5 text-center text-[11px] font-bold leading-5 text-on-accent tabular-nums"
                          aria-label={`${n} waiting`}
                        >
                          {n > 99 ? "99+" : n}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-3 border-t border-border px-3 py-4">
        <div className="hidden flex-col gap-1.5 px-2 lg:flex">
          <span className="text-xs font-medium text-tertiary">Show amounts in</span>
          <CurrencySwitch explainMissingRate />
        </div>
        {identity}
        <Link
          href="/"
          className="flex h-9 items-center gap-2.5 rounded-md px-3 text-sm font-medium text-secondary transition-colors hover:bg-element-2 hover:text-primary"
        >
          <ArrowLeft className="size-4" />
          Back to site
        </Link>
      </div>
    </div>
  );
}

/** Straight to the thing: WS-… opens that request, anything else finds the person. */
function DeskSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        if (!term) return;
        router.push(
          REQUEST_REF.test(term)
            ? `/admin/customers/support?ref=${encodeURIComponent(term.toUpperCase())}`
            : `/admin/customers?search=${encodeURIComponent(term.replace(/^@/, ""))}`,
        );
        setQ("");
      }}
      className="flex h-9 items-center gap-2 rounded-md border border-border bg-page px-2.5 focus-within:border-accent"
    >
      <Search className="size-4 shrink-0 text-tertiary" />
      <label className="sr-only" htmlFor="desk-search">
        Find a customer or a request number
      </label>
      <input
        id="desk-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Customer or WS-…"
        className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-tertiary"
      />
    </form>
  );
}
