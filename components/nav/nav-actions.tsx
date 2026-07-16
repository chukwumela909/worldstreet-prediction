"use client";

import { useEffect, useRef, useState } from "react";
import {
  Braces,
  ChevronRight,
  CircleDollarSign,
  LogOut,
  Menu,
  Moon,
  Trophy,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { toggleTheme, useTheme } from "@/lib/theme-store";

/**
 * Right side of the top nav: Log In / Sign Up (signed out) or avatar chip
 * (signed in), plus the hamburger dropdown with the measured menu items
 * and a functional dark-mode toggle.
 */
export function NavActions() {
  const { user, openAuth } = useAuth();
  return (
    <>
      {user ? (
        <span className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-accent/20 text-sm font-bold uppercase text-accent">
            {user.name[0]}
          </span>
          <span className="hidden max-w-28 truncate text-sm font-semibold sm:block">
            {user.name}
          </span>
        </span>
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

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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

function MenuItem({
  icon,
  label,
  trailing,
  muted = false,
}: {
  icon?: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <button
      className={`flex w-full items-center gap-3 rounded-md px-3 transition-colors duration-150 ease-in-out hover:bg-element-2 ${
        muted
          ? "h-9 text-sm font-medium text-secondary hover:text-primary"
          : "h-10 text-[15px] font-medium text-primary"
      }`}
    >
      {icon}
      {label}
      {trailing && <span className="ml-auto">{trailing}</span>}
    </button>
  );
}
