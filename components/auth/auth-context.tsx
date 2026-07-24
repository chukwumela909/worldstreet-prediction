"use client";

import { createContext, useContext, useMemo } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import { CLERK_ENABLED, CLERK_SIGN_IN_URL } from "@/lib/auth-config";
import { clearNairaWallet } from "@/lib/naira-wallet";

export interface SessionUser {
  email: string;
  /** Display name (Clerk full name / username, falling back to the email local part). */
  name: string;
}

interface AuthState {
  user: SessionUser | null;
  /** Sends the visitor to the central WorldStreet login. */
  openAuth: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

/** Send the visitor to the central WorldStreet login and back here after. */
function redirectToCentralLogin() {
  const url = new URL(CLERK_SIGN_IN_URL);
  url.searchParams.set("redirect_url", window.location.href);
  window.location.href = url.toString();
}

/**
 * Clerk provider: session comes from the central worldstreetgold.com Clerk
 * application (this app is a satellite domain).
 */
function ClerkAuthProvider({ children }: { children: React.ReactNode }) {
  const { user: clerkUser, isLoaded } = useUser();
  const clerk = useClerk();

  const value = useMemo<AuthState>(() => {
    const email = clerkUser?.primaryEmailAddress?.emailAddress ?? "";
    const user: SessionUser | null =
      isLoaded && clerkUser
        ? {
            email,
            name:
              clerkUser.fullName ||
              clerkUser.username ||
              email.split("@")[0] ||
              "trader",
          }
        : null;

    return {
      user,
      signOut: () => {
        // the naira balance is per-user; drop it before the next one lands
        clearNairaWallet();
        void clerk.signOut();
      },
      openAuth: redirectToCentralLogin,
    };
  }, [clerkUser, isLoaded, clerk]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * No Clerk keys (local dev): always signed out. Sign-in buttons still
 * redirect to the central login, but without satellite keys the session
 * can't come back — set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY to sign in.
 */
function SignedOutProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<AuthState>(
    () => ({
      user: null,
      signOut: () => {},
      openAuth: redirectToCentralLogin,
    }),
    [],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// CLERK_ENABLED is a build-time constant, so the choice is stable for the
// lifetime of the bundle — each variant keeps its own hook order.
export const AuthProvider = CLERK_ENABLED ? ClerkAuthProvider : SignedOutProvider;

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
