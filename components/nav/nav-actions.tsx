"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownTrayIcon as ArrowDownToLine,
  ArrowRightEndOnRectangleIcon as LogIn,
  ArrowRightStartOnRectangleIcon as LogOut,
  Bars3Icon as Menu,
  ChatBubbleLeftRightIcon as Chat,
  MoonIcon as Moon,
  SunIcon as Sun,
  TrophyIcon as Trophy,
  WalletIcon as Wallet,
} from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/auth-context";
import { FundNairaModal } from "@/components/local/fund-naira-modal";
import { toggleTheme, useTheme } from "@/lib/theme-store";
import { useWalletBalance } from "@/lib/use-wallet-balance";
import { useNairaWallet } from "@/lib/naira-wallet";
import { useLocalPortfolio } from "@/lib/local-trades";
import { formatNaira } from "@/lib/format";

/** Dollars with the cents the nav always shows. */
const usd = (n: number) =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const BUTTON =
  "flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm px-4 text-sm font-medium transition-colors";
const PRIMARY = `${BUTTON} pressable bg-accent text-on-accent hover:bg-accent-hover`;
const SECONDARY = `${BUTTON} border border-border bg-surface text-primary hover:border-border-active hover:bg-element-2`;

/**
 * Right side of the top nav.
 *
 * Signed in, the reference's account strip: Portfolio and Cash stats, a
 * gold Deposit, then the menu. Both stats are real: Portfolio is what's
 * staked in open Local positions (held to settlement, so valued at cost —
 * they have no live price), Cash is the central dollar wallet; the naira
 * credit balance lives in the menu. Deposit opens the funding dialog the
 * portfolio's "Manage credit" uses.
 *
 * Signed out there is no account to show, so it's Log in / Sign up.
 */
export function NavActions() {
  const { user, openAuth } = useAuth();
  return (
    <>
      {user ? (
        <SignedInActions />
      ) : (
        <>
          <button onClick={openAuth} className={SECONDARY}>
            Log in
          </button>
          <button onClick={openAuth} className={PRIMARY}>
            Sign up
          </button>
        </>
      )}
      <MenuDropdown />
    </>
  );
}

function SignedInActions() {
  const walletCash = useWalletBalance(true);
  const { positions, loading } = useLocalPortfolio(true);
  const [funding, setFunding] = useState(false);
  const openStakeKobo = positions
    .filter((p) => p.status === "open")
    .reduce((sum, p) => sum + p.stakeKobo, 0);

  return (
    <>
      <div className="hidden items-center sm:flex">
        <NavStat label="Portfolio" value={loading ? "—" : formatNaira(openStakeKobo)} />
        <NavStat label="Cash" value={walletCash === null ? "—" : usd(walletCash)} />
      </div>
      <button onClick={() => setFunding(true)} className={PRIMARY}>
        <ArrowDownToLine className="size-4" />
        Deposit
      </button>
      <FundNairaModal open={funding} onClose={() => setFunding(false)} />
    </>
  );
}

function NavStat({
  label,
  value,
}: {
  label: string;
  /** Pre-formatted — these stats aren't all the same currency. */
  value: string;
}) {
  return (
    <Link
      href="/portfolio"
      className="grid gap-0.5 rounded-md px-2 py-1 text-right text-xs text-primary hover:bg-element-2"
    >
      {label}
      <strong className="text-base font-semibold tabular-nums text-yes">{value}</strong>
    </Link>
  );
}

/**
 * The account menu: who's signed in, where their things live, the theme
 * switch, and sign out.
 */
function MenuDropdown() {
  const { user, signOut, openAuth } = useAuth();
  const [open, setOpen] = useState(false);
  const dark = useTheme() === "dark";
  const { balanceKobo } = useNairaWallet(Boolean(user));
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(wrapRef, open, () => setOpen(false));
  const close = () => setOpen(false);

  return (
    <div ref={wrapRef} className="relative">
      <button
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex size-9 items-center justify-center rounded-sm text-secondary transition-colors hover:bg-surface hover:text-primary"
      >
        <Menu className="size-5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-lg border border-border bg-surface p-1.5 shadow-popover">
          {user ? (
            <>
              <div className="px-3 py-2">
                <p className="truncate text-sm font-semibold">{user.name}</p>
                <p className="truncate text-xs text-secondary">{user.email}</p>
                {balanceKobo !== null && (
                  <p className="mt-1.5 flex items-center justify-between text-xs text-secondary">
                    Credit
                    <span className="font-semibold tabular-nums text-yes">
                      {formatNaira(balanceKobo)}
                    </span>
                  </p>
                )}
              </div>
              <div className="my-1 border-t border-border" />
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  close();
                  openAuth();
                }}
                className={MENU_ITEM}
              >
                <LogIn className="size-4 text-secondary" />
                Log in
              </button>
              <div className="my-1 border-t border-border" />
            </>
          )}
          <MenuLink href="/portfolio" icon={<Wallet className="size-4" />} onNavigate={close}>
            Portfolio
          </MenuLink>
          <MenuLink href="/leaderboard" icon={<Trophy className="size-4" />} onNavigate={close}>
            Leaderboard
          </MenuLink>
          <MenuLink href="/support" icon={<Chat className="size-4" />} onNavigate={close}>
            Help &amp; support
          </MenuLink>
          <button onClick={toggleTheme} className={MENU_ITEM}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {dark ? "Light theme" : "Dark theme"}
          </button>

          {user && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                onClick={() => {
                  signOut();
                  close();
                }}
                className={`${MENU_ITEM} text-no`}
              >
                <LogOut className="size-4" />
                Sign out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const MENU_ITEM =
  "flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-primary transition-colors hover:bg-element-2";

function MenuLink({
  href,
  icon,
  children,
  onNavigate,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Link href={href} onClick={onNavigate} className={MENU_ITEM}>
      <span className="text-secondary">{icon}</span>
      {children}
    </Link>
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
