"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import { CLERK_ENABLED, CLERK_SIGN_IN_URL } from "@/lib/auth-config";
import {
  signInAs,
  signOutUser,
  useSessionUser,
  type SessionUser,
} from "@/lib/session-store";
import { AuthModal } from "./auth-modal";

interface AuthState {
  user: SessionUser | null;
  openAuth: () => void;
  closeAuth: () => void;
  /** Mock mode: derives a username from the email. Clerk mode: redirects to the central login. */
  signIn: (email: string) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Mock provider (no Clerk keys): the demo email modal + localStorage session.
 */
function MockAuthProvider({ children }: { children: React.ReactNode }) {
  const user = useSessionUser();
  const [open, setOpen] = useState(false);

  const value = useMemo<AuthState>(
    () => ({
      user,
      signIn: (email: string) => {
        signInAs(email);
        setOpen(false);
      },
      signOut: signOutUser,
      openAuth: () => setOpen(true),
      closeAuth: () => setOpen(false),
    }),
    [user],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {open && <AuthModal />}
    </AuthContext.Provider>
  );
}

/** Send the visitor to the central WorldStreet login and back here after. */
function redirectToCentralLogin() {
  const url = new URL(CLERK_SIGN_IN_URL);
  url.searchParams.set("redirect_url", window.location.href);
  window.location.href = url.toString();
}

/**
 * Clerk provider: session comes from the central worldstreetgold.com Clerk
 * application (this app is a satellite domain). Same AuthState surface as
 * the mock, so consumers never know the difference.
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
      signIn: redirectToCentralLogin,
      signOut: () => void clerk.signOut(),
      openAuth: redirectToCentralLogin,
      closeAuth: () => {},
    };
  }, [clerkUser, isLoaded, clerk]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// CLERK_ENABLED is a build-time constant, so the choice is stable for the
// lifetime of the bundle — each variant keeps its own hook order.
export const AuthProvider = CLERK_ENABLED ? ClerkAuthProvider : MockAuthProvider;

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
