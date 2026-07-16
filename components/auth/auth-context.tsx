"use client";

import { createContext, useContext, useMemo, useState } from "react";
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
  /** Mock sign-in — no backend; derives a username from the email. */
  signIn: (email: string) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
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

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
