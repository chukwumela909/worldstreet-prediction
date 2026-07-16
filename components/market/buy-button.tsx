"use client";

import { useAuth } from "@/components/auth/auth-context";

/**
 * Buy button state model (recon §7):
 * rest = colored text on 15% tint · hover/selected = white on solid -400.
 * Signed out, any click opens the auth modal (like the real site).
 */
export function BuyButton({
  side,
  label,
  outcome,
  mini = false,
}: {
  side: "yes" | "no";
  label: string;
  outcome?: string;
  mini?: boolean;
}) {
  const { user, openAuth } = useAuth();
  const palette =
    side === "yes"
      ? "bg-yes-tint text-yes hover:bg-yes-solid"
      : "bg-no-tint text-no hover:bg-no-solid";
  const size = mini
    ? "h-6 rounded-xs px-2 text-xs"
    : "h-10 flex-1 rounded-sm text-sm";
  return (
    <button
      aria-label={outcome ? `Buy ${side} on ${outcome}` : undefined}
      onClick={() => {
        if (!user) openAuth();
      }}
      className={`${size} ${palette} font-semibold transition-colors hover:text-white`}
    >
      {label}
    </button>
  );
}
