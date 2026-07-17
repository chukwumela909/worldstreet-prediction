"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { deposit } from "@/lib/portfolio-store";

const PRESETS = [100, 250, 1000];

/**
 * Mock deposit modal — credits demo cash to the portfolio store.
 * No payment details anywhere; this is a UI clone with play money.
 */
export function DepositModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState(100);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-popover">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Deposit</h2>
          <button
            aria-label="Close"
            onClick={onClose}
            className="p-1 text-secondary hover:text-primary"
          >
            <X className="size-5" />
          </button>
        </div>
        <p className="mt-1 text-sm text-secondary">
          Add demo funds to your balance. This is a preview build — no real
          money is involved.
        </p>

        <div className="mt-5 flex items-center justify-between">
          <span className="text-base font-semibold">Amount</span>
          <input
            inputMode="decimal"
            value={`$${amount}`}
            onChange={(e) => {
              const n = parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
              setAmount(Number.isNaN(n) ? 0 : Math.min(n, 100000));
            }}
            className={`w-36 bg-transparent text-right text-3xl font-semibold outline-none ${
              amount === 0 ? "text-border-active" : "text-primary"
            }`}
            aria-label="Deposit amount in dollars"
          />
        </div>

        <div className="mt-3 flex justify-end gap-1.5">
          {PRESETS.map((v) => (
            <button
              key={v}
              onClick={() => setAmount(v)}
              className="h-[30px] rounded-md bg-element-2 px-2.5 text-xs font-semibold text-secondary hover:bg-element-3"
            >
              ${v}
            </button>
          ))}
        </div>

        <button
          disabled={amount === 0}
          onClick={() => {
            deposit(amount);
            onClose();
          }}
          className="mt-5 h-11 w-full rounded-md bg-accent text-base font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          Deposit ${amount.toLocaleString("en-US")}
        </button>
      </div>
    </div>
  );
}
