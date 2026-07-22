"use client";

import { useEffect, useState } from "react";
import { apiFetch, isApiConfigured } from "@/lib/api-client";

interface BalanceResponse {
  success: boolean;
  data: { availableUsdMinor: number; lockedUsdMinor: number; currency: string };
}

const REFRESH_MS = 30_000;

/**
 * Spendable USD balance from the central WorldStreet wallet, in dollars.
 * Returns null while loading, when signed out, or when NEXT_PUBLIC_API_URL
 * is unset — callers fall back to the mock portfolio cash in that case.
 */
export function useWalletBalance(enabled: boolean): number | null {
  const [balance, setBalance] = useState<number | null>(null);

  const active = enabled && isApiConfigured();

  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    const refresh = async () => {
      try {
        const res = await apiFetch<BalanceResponse>("/v1/wallet/balance");
        if (!cancelled) setBalance(res.data.availableUsdMinor / 100);
      } catch {
        // Keep the last known value; the wallet may be briefly unreachable.
      }
    };

    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [active]);

  return active ? balance : null;
}
