"use client";

import { useState } from "react";
import { NoSymbolIcon as Ban } from "@heroicons/react/24/outline";
import {
  reinstateAccount,
  suspendAccount,
  type AccountAction,
  type TraderRow,
} from "@/lib/admin-api";
import { showToast } from "@/lib/toast-store";
import { FLAG_TONE } from "@/components/admin/risk-flags";

/**
 * Suspending one account, or lifting it, from the opened trader. Two
 * steps either way: write the reason, then confirm with what it does in
 * plain words. The reason is the customer's to read — the email and the
 * site's suspended notice both quote it — so it's written for them.
 *
 * Suspended means no new bets and no money in or out; bets already open
 * still settle. Every suspend and lift is kept on the account's history.
 */

const MIN_REASON = 5;

/** What the control needs to know about the account — any desk's row will do. */
export type AccountRef = Pick<
  TraderRow,
  "authUserId" | "displayName" | "username" | "email" | "suspendedAt" | "suspendedReason"
>;

export function AccountControl({
  trader,
  actions,
  onChanged,
}: {
  trader: AccountRef;
  /** Newest first; undefined until the person's detail loads. */
  actions: AccountAction[] | undefined;
  onChanged: () => void;
}) {
  const suspended = Boolean(trader.suspendedAt);
  const name = trader.displayName || trader.username || "this account";
  const [step, setStep] = useState<"idle" | "write" | "confirm">("idle");
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep("idle");
    setReason("");
    setNotify(true);
    setError(null);
  };
  const ready = suspended || reason.trim().length >= MIN_REASON;

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { reason: reason.trim(), notify: notify && Boolean(trader.email) };
      const result = suspended
        ? await reinstateAccount(trader.authUserId, body)
        : await suspendAccount(trader.authUserId, body);
      const told =
        result.emailed === true
          ? " — they've been emailed"
          : result.emailed === false
            ? " — but the email didn't go out"
            : "";
      showToast(
        `${suspended ? `${name} can bet again` : `${name} is suspended`}${told}`,
        result.emailed === false ? "error" : "success",
      );
      reset();
      onChanged();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Request failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3">
      {suspended ? (
        <div className={`rounded-md border px-3 py-2.5 text-sm ${FLAG_TONE.danger.banner}`}>
          <p className="flex items-center gap-1.5 font-semibold text-no">
            <Ban className="size-4 shrink-0" aria-hidden />
            Suspended since {when(trader.suspendedAt)}
          </p>
          {trader.suspendedReason && (
            <p className="mt-1 text-secondary">
              <span className="font-semibold text-primary">Reason:</span> {trader.suspendedReason}
            </p>
          )}
          <p className="mt-1 text-xs text-secondary">
            They can&rsquo;t place bets or move money in or out. Open bets still settle.
          </p>
        </div>
      ) : null}

      {step === "idle" && (
        <button
          type="button"
          onClick={() => setStep("write")}
          className={`mt-2 inline-flex h-9 items-center gap-1.5 rounded-sm border px-3 text-sm font-semibold ${
            suspended
              ? "border-border text-primary hover:border-border-hover"
              : "border-no/40 text-no hover:bg-no-tint"
          }`}
        >
          {!suspended && <Ban className="size-4" aria-hidden />}
          {suspended ? "Lift suspension…" : "Suspend account…"}
        </button>
      )}

      {step === "write" && (
        <div className="mt-2 rounded-md border border-border bg-surface p-3">
          <label className="block">
            <span className="text-xs font-medium text-secondary">
              {suspended
                ? "Note to the customer (optional)"
                : "Reason — the customer will see this"}
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              autoFocus
              placeholder={
                suspended
                  ? "e.g. Thanks for your patience — your account is open again."
                  : "e.g. Repeated bets on results that were already public, against our terms."
              }
              className="mt-1 w-full resize-y rounded-md border border-border bg-sunken px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
          <label
            className={`mt-2 flex items-center gap-2 text-sm ${trader.email ? "" : "opacity-50"}`}
          >
            <input
              type="checkbox"
              checked={notify && Boolean(trader.email)}
              disabled={!trader.email}
              onChange={(e) => setNotify(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            {trader.email ? `Email ${trader.email} about it` : "No email on this account"}
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStep("confirm")}
              disabled={!ready}
              className="pressable h-9 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
            >
              Continue
            </button>
            <button
              type="button"
              onClick={reset}
              className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-secondary hover:text-primary"
            >
              Cancel
            </button>
            {!ready && (
              <span className="self-center text-xs text-tertiary">
                Write at least {MIN_REASON} characters.
              </span>
            )}
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="mt-2 rounded-md border border-border bg-surface p-3 text-sm">
          <p className="font-semibold">
            {suspended
              ? `Lift ${name}'s suspension? They'll be able to bet and move money again.`
              : `Suspend ${name}? They won't be able to place bets or move money in or out until you lift it. Bets they already have open still settle.`}
          </p>
          {reason.trim() && (
            <p className="mt-2 rounded-md bg-element-2 px-3 py-2 text-secondary">
              &ldquo;{reason.trim()}&rdquo;
            </p>
          )}
          <p className="mt-2 text-xs text-secondary">
            {notify && trader.email
              ? `${trader.email} will get an email${reason.trim() ? " with this" : ""}.`
              : "No email will be sent."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={go}
              disabled={busy}
              className={`pressable h-9 rounded-sm px-4 text-sm font-semibold disabled:opacity-40 ${
                suspended
                  ? "bg-accent text-on-accent hover:bg-accent-hover"
                  : "bg-no-solid text-white"
              }`}
            >
              {busy ? "Saving…" : suspended ? "Yes, lift it" : `Yes, suspend ${name}`}
            </button>
            <button
              type="button"
              onClick={() => setStep("write")}
              disabled={busy}
              className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-secondary hover:text-primary"
            >
              Back
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-no">{error}</p>}

      {actions && actions.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-secondary">
            Account history ({actions.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-1 text-xs text-secondary">
            {actions.map((a) => (
              <li key={`${a.action}-${a.at}`}>
                <span className={`font-semibold ${a.action === "suspend" ? "text-no" : "text-yes"}`}>
                  {a.action === "suspend" ? "Suspended" : "Lifted"}
                </span>{" "}
                · {when(a.at)} · by {a.by}
                {a.reason && <> — &ldquo;{a.reason}&rdquo;</>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
