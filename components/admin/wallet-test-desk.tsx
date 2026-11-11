"use client";

import { WalletCheckDesk } from "@/components/admin/wallet-check-desk";
import { GuidedTest } from "@/components/admin/guided-money-test";

/**
 * Wallet test: is the live WorldStreet wallet really working for Predict?
 * One page, two steps, in the order they're done: 1) the quick check, one
 * button that adds 1 cent to a dollar wallet and takes it back
 * (wallet-check-desk.tsx); 2) the full money test, a real deposit, bet and
 * withdrawal on the customer site, checked against the balances here
 * (guided-money-test.tsx).
 */
export function WalletTestDesk() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Wallet test</h1>
      <p className="mt-1 text-sm text-secondary">
        Check that adding and taking out money works with the WorldStreet wallet. Start with the quick check; if it
        says Working, do the full money test below.
      </p>
      <WalletCheckDesk />
      <GuidedTest />
    </div>
  );
}
