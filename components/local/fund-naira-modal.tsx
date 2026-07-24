"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, X } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { formatNaira } from "@/lib/format";
import {
  convertCurrency,
  newIdempotencyKey,
  refreshNairaWallet,
  useNairaWallet,
  type ConvertDirection,
} from "@/lib/naira-wallet";
import { useWalletBalance } from "@/lib/use-wallet-balance";

/**
 * Funding for the Local book: moves money between the central
 * WorldStreet dollar wallet and this platform's naira ledger. Naira is
 * the only currency Local markets trade in, so this is the on-ramp the
 * trade panel sends people to when their balance is short.
 *
 * The idempotency key is minted once per attempt and reused while the
 * amount and direction hold, so a retry after a network timeout can't
 * convert twice.
 */

const QUICK_USD = [10, 25, 50, 100];

export function FundNairaModal({
  open,
  onClose,
  /** Kobo the trade panel needs — preselects a dollar amount that covers it. */
  neededKobo,
}: {
  open: boolean;
  onClose: () => void;
  neededKobo?: number;
}) {
  if (!open) return null;
  return <FundDialog onClose={onClose} neededKobo={neededKobo} />;
}

function FundDialog({
  onClose,
  neededKobo,
}: {
  onClose: () => void;
  neededKobo?: number;
}) {
  const { balanceKobo, fx, error: walletError } = useNairaWallet(true);
  const usdBalance = useWalletBalance(true);
  const [direction, setDirection] = useState<ConvertDirection>("usd_to_ngn");
  // null = untouched, so the shortfall suggestion can still fill in once
  // the FX quote lands; any keystroke pins it to what was typed
  const [typed, setTyped] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const keyRef = useRef(newIdempotencyKey());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toNaira = direction === "usd_to_ngn";

  // Whole dollars covering the shortfall the trade panel reported, once
  // there's a rate to price it with.
  const suggested =
    neededKobo && fx && toNaira
      ? String(Math.ceil(neededKobo / fx.usdToNgn / 100))
      : "";
  const amount = typed ?? suggested;
  const setAmount = (next: string) => setTyped(next);
  const parsed = parseFloat(amount);
  const amountMinor =
    Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;

  // Same floors the server applies, so the preview never promises more
  // than the conversion delivers.
  const receives = !fx
    ? null
    : toNaira
      ? Math.floor(amountMinor * fx.usdToNgn)
      : Math.floor(amountMinor / fx.ngnToUsd);

  const overBalance = toNaira
    ? usdBalance !== null && amountMinor > Math.round(usdBalance * 100)
    : balanceKobo !== null && amountMinor > balanceKobo;

  const submit = async () => {
    if (amountMinor <= 0 || pending) return;
    setPending(true);
    setError(null);
    try {
      await convertCurrency({
        direction,
        amountMinor,
        idempotencyKey: keyRef.current,
      });
      setDone(
        toNaira
          ? `Added ${formatNaira(receives ?? 0)} to your naira balance`
          : `Withdrew $${((receives ?? 0) / 100).toFixed(2)} to your dollar wallet`,
      );
      setAmount("");
      keyRef.current = newIdempotencyKey();
    } catch (err) {
      setError(convertMessage(err));
    } finally {
      setPending(false);
    }
  };

  const switchTo = (next: ConvertDirection) => {
    setDirection(next);
    setAmount("");
    setError(null);
    setDone(null);
    keyRef.current = newIdempotencyKey();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Naira wallet"
        className="w-full max-w-[420px] rounded-xl border border-border bg-surface p-5 shadow-popover"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Naira wallet</h2>
            <p className="mt-0.5 text-sm text-secondary">
              Local markets settle in naira. Move funds from your
              WorldStreet dollar balance.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-md p-1.5 text-secondary hover:bg-element-2 hover:text-primary"
          >
            <X className="size-4.5" />
          </button>
        </div>

        {/* balances */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Balance
            label="Dollar wallet"
            value={usdBalance === null ? "—" : `$${usdBalance.toFixed(2)}`}
          />
          <Balance
            label="Naira balance"
            value={balanceKobo === null ? "—" : formatNaira(balanceKobo)}
          />
        </div>

        {/* direction */}
        <div className="mt-4 flex gap-6 border-b border-border">
          {(
            [
              ["usd_to_ngn", "Add naira"],
              ["ngn_to_usd", "Withdraw"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => switchTo(value)}
              className={`border-b-2 pb-2 text-[15px] font-semibold transition-colors ${
                direction === value
                  ? "border-primary text-primary"
                  : "border-transparent text-secondary hover:text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {fx ? (
          <>
            <div className="mt-4 flex items-center justify-between">
              <label
                htmlFor="convert-amount"
                className="text-base font-semibold"
              >
                {toNaira ? "Dollars" : "Naira"}
              </label>
              <div className="flex items-center gap-1">
                <span className="text-2xl font-semibold text-tertiary">
                  {toNaira ? "$" : "₦"}
                </span>
                <input
                  id="convert-amount"
                  ref={inputRef}
                  inputMode="decimal"
                  value={amount}
                  placeholder="0"
                  onChange={(e) => {
                    setAmount(e.target.value.replace(/[^0-9.]/g, "").slice(0, 12));
                    setError(null);
                    setDone(null);
                  }}
                  className={`w-36 bg-transparent text-right text-3xl font-semibold outline-none placeholder:text-border-active ${
                    amountMinor === 0 ? "text-border-active" : "text-primary"
                  }`}
                />
              </div>
            </div>

            {toNaira && (
              <div className="mt-3 flex justify-end gap-1.5">
                {QUICK_USD.map((v) => (
                  <button
                    key={v}
                    onClick={() => {
                      setAmount(String(v));
                      setDone(null);
                    }}
                    className="h-[30px] rounded-md bg-element-2 px-2.5 text-xs font-semibold text-secondary hover:bg-element-3"
                  >
                    ${v}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center justify-center gap-2 rounded-md bg-element-2 px-3 py-2.5 text-sm font-semibold">
              <span className="text-secondary">
                {toNaira ? `$${(amountMinor / 100).toFixed(2)}` : formatNaira(amountMinor)}
              </span>
              <ArrowRight className="size-4 text-tertiary" />
              <span>
                {receives === null
                  ? "—"
                  : toNaira
                    ? formatNaira(receives)
                    : `$${(receives / 100).toFixed(2)}`}
              </span>
            </div>
            <p className="mt-2 text-center text-xs text-tertiary">
              ₦
              {(toNaira ? fx.usdToNgn : fx.ngnToUsd).toLocaleString("en-US", {
                maximumFractionDigits: 2,
              })}{" "}
              per $1 · includes a {(fx.spreadBps / 100).toFixed(2)}% spread
            </p>

            <button
              disabled={amountMinor <= 0 || pending || overBalance}
              onClick={() => void submit()}
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-accent text-base font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {overBalance
                ? toNaira
                  ? "Not enough dollars"
                  : "Not enough naira"
                : toNaira
                  ? "Convert to naira"
                  : "Withdraw to dollars"}
            </button>
          </>
        ) : (
          <p className="mt-5 text-center text-sm text-secondary">
            {walletError ??
              "Currency conversion is not available right now. Try again shortly."}
          </p>
        )}

        {error && (
          <p className="mt-3 text-center text-sm font-semibold text-no">{error}</p>
        )}
        {done && (
          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-sm font-semibold text-yes">
            <CheckCircle2 className="size-4" />
            {done}
          </p>
        )}
      </div>
    </div>
  );
}

function Balance({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-element-2 px-3 py-2">
      <p className="text-xs font-medium text-secondary">{label}</p>
      <p className="mt-0.5 text-base font-semibold">{value}</p>
    </div>
  );
}

/** Conversion failures the user can act on; anything else keeps its message. */
function convertMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "INSUFFICIENT_FUNDS":
        return "Not enough balance for that amount.";
      case "FX_UNAVAILABLE":
        return "Conversion is unavailable right now — no rate is set.";
      case "WALLET_UNAVAILABLE":
        // the money never moved, but re-read in case it half-did
        void refreshNairaWallet();
        return "The wallet service is unreachable. Nothing was converted.";
      default:
        return err.message;
    }
  }
  return "Conversion failed. Please try again.";
}
