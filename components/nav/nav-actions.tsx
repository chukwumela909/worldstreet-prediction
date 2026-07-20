"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Braces,
  ChevronRight,
  CircleDollarSign,
  LogOut,
  Menu,
  Moon,
  Trophy,
  User,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { toggleTheme, useTheme } from "@/lib/theme-store";
import { usePortfolio } from "@/lib/portfolio-store";
import { positionPrice } from "@/lib/market-lookup";
import { useLiveEvents } from "@/lib/use-live-events";
import { DepositModal } from "./deposit-modal";

/**
 * Right side of the top nav. Signed out: Log In / Sign Up pills.
 * Signed in (Polymarket-style): Portfolio + Cash value stats linking
 * to /portfolio, a Deposit button, and the avatar dropdown.
 * Both states end with the hamburger dropdown.
 */
export function NavActions() {
  const { user, openAuth } = useAuth();
  return (
    <>
      {user ? (
        <SignedInActions />
      ) : (
        <>
          <button
            onClick={openAuth}
            className="h-8 shrink-0 whitespace-nowrap rounded-full border border-border px-3.5 text-sm font-semibold text-primary hover:border-border-hover"
          >
            Log In
          </button>
          <button
            onClick={openAuth}
            className="h-8 shrink-0 whitespace-nowrap rounded-full bg-blue-400 px-3.5 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Sign Up
          </button>
        </>
      )}
      <MenuDropdown />
    </>
  );
}

function SignedInActions() {
  const portfolio = usePortfolio();
  const [depositOpen, setDepositOpen] = useState(false);

  const slugs = useMemo(
    () => [...new Set(portfolio.positions.map((p) => p.eventSlug))],
    [portfolio.positions],
  );
  const { bySlug } = useLiveEvents(slugs);

  const positionsValue = useMemo(
    () =>
      portfolio.positions.reduce((sum, p) => {
        // mark at entry price until the live one lands, so the header
        // doesn't dip to $0 on every page load
        const price = positionPrice(p, bySlug) ?? p.avgPrice;
        return sum + p.shares * price;
      }, 0),
    [portfolio.positions, bySlug],
  );

  return (
    <>
      <div className="hidden items-center sm:flex">
        <NavStat label="Portfolio" value={positionsValue} tone="text-yes" />
        <NavStat label="Cash" value={portfolio.cash} tone="text-primary" />
      </div>
      <button
        onClick={() => setDepositOpen(true)}
        className="h-8 shrink-0 whitespace-nowrap rounded-full bg-blue-400 px-3.5 text-sm font-semibold text-white hover:bg-blue-500"
      >
        Deposit
      </button>
      <AvatarDropdown />
      {depositOpen && <DepositModal onClose={() => setDepositOpen(false)} />}
    </>
  );
}

function NavStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <Link
      href="/portfolio"
      className="flex flex-col items-end rounded-md px-2.5 py-1 leading-tight hover:bg-element-2"
    >
      <span className={`text-sm font-semibold ${tone}`}>
        $
        {value.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </span>
      <span className="text-xs font-medium text-secondary">{label}</span>
    </Link>
  );
}

function AvatarDropdown() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(wrapRef, open, () => setOpen(false));

  if (!user) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex size-8 items-center justify-center rounded-full bg-accent/20 text-sm font-bold uppercase text-accent"
      >
        {user.name[0]}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-xl border border-border bg-surface p-2 shadow-popover">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-xs text-secondary">{user.email}</p>
          </div>
          <div className="my-1 border-t border-border" />
          <Link
            href="/portfolio"
            onClick={() => setOpen(false)}
            className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-[15px] font-medium transition-colors duration-150 ease-in-out hover:bg-element-2"
          >
            <User className="size-4.5 text-secondary" />
            Portfolio
          </Link>
          <Link
            href="/leaderboard"
            onClick={() => setOpen(false)}
            className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-[15px] font-medium transition-colors duration-150 ease-in-out hover:bg-element-2"
          >
            <Trophy className="size-4.5 text-secondary" />
            Leaderboard
          </Link>
          <div className="my-1 border-t border-border" />
          <button
            onClick={() => {
              signOut();
              setOpen(false);
            }}
            className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-[15px] font-medium text-no transition-colors duration-150 ease-in-out hover:bg-element-2"
          >
            <LogOut className="size-4.5" />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

const MENU_LINKS = [
  "Accuracy",
  "Status",
  "Documentation",
  "Help Center",
  "Terms of Use",
];

function MenuDropdown() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const dark = useTheme() === "dark";
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(wrapRef, open, () => setOpen(false));

  return (
    <div ref={wrapRef} className="relative">
      <button
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="p-1.5 text-primary hover:text-secondary"
      >
        <Menu className="size-5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-xl border border-border bg-surface p-2 shadow-popover">
          <MenuItem
            icon={<Trophy className="size-4.5 text-yellow-500" />}
            label="Leaderboard"
            href="/leaderboard"
            onNavigate={() => setOpen(false)}
          />
          <MenuItem
            icon={<CircleDollarSign className="size-4.5 text-yes" />}
            label="Rewards"
          />
          <MenuItem
            icon={<Braces className="size-4.5 text-promo-purple-text" />}
            label="APIs"
          />
          <button
            role="switch"
            aria-checked={dark}
            onClick={toggleTheme}
            className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-[15px] font-medium transition-colors duration-150 ease-in-out hover:bg-element-2"
          >
            <Moon className="size-4.5 text-blue-600" />
            Dark mode
            <span
              className={`ml-auto flex h-5 w-9 rounded-full p-0.5 transition-colors duration-150 ease-in-out ${
                dark ? "bg-accent" : "bg-element-3"
              }`}
            >
              <span
                className={`size-4 rounded-full bg-white transition-transform duration-150 ease-in-out ${
                  dark ? "translate-x-4" : ""
                }`}
              />
            </span>
          </button>

          <div className="my-2 border-t border-border" />

          {MENU_LINKS.map((label) => (
            <MenuItem key={label} label={label} muted />
          ))}
          <MenuItem
            icon={<span className="text-base leading-none">🌐</span>}
            label="Language"
            trailing={<ChevronRight className="size-4 text-tertiary" />}
            muted
          />

          {user && (
            <>
              <div className="my-2 border-t border-border" />
              <button
                onClick={() => {
                  signOut();
                  setOpen(false);
                }}
                className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-[15px] font-medium text-no transition-colors duration-150 ease-in-out hover:bg-element-2"
              >
                <LogOut className="size-4.5" />
                Sign Out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Close a popover on outside click or Escape. */
function useDismiss(
  ref: React.RefObject<HTMLDivElement | null>,
  open: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, onClose]);
}

function MenuItem({
  icon,
  label,
  trailing,
  muted = false,
  href,
  onNavigate,
}: {
  icon?: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  muted?: boolean;
  href?: string;
  onNavigate?: () => void;
}) {
  const className = `flex w-full items-center gap-3 rounded-md px-3 transition-colors duration-150 ease-in-out hover:bg-element-2 ${
    muted
      ? "h-9 text-sm font-medium text-secondary hover:text-primary"
      : "h-10 text-[15px] font-medium text-primary"
  }`;
  if (href) {
    return (
      <Link href={href} onClick={onNavigate} className={className}>
        {icon}
        {label}
        {trailing && <span className="ml-auto">{trailing}</span>}
      </Link>
    );
  }
  return (
    <button className={className}>
      {icon}
      {label}
      {trailing && <span className="ml-auto">{trailing}</span>}
    </button>
  );
}
