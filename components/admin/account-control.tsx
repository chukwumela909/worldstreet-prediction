"use client";

import { useState } from "react";
import { LockClosedIcon as Lock, NoSymbolIcon as Ban } from "@heroicons/react/24/outline";
import {
  fetchBookSettings,
  lockWithdrawals,
  reinstateAccount,
  setStakeLevel,
  suspendAccount,
  unlockWithdrawals,
  useAdminResource,
  type AccountAction,
  type StakeLevel,
  type TraderRow,
} from "@/lib/admin-api";
import { formatNaira } from "@/lib/format";
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
  "authUserId" | "displayName" | "username" | "email" | "suspendedAt" | "suspendedReason" | "withdrawalsLockedAt"
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

      {!suspended && <WithdrawalLock trader={trader} onChanged={onChanged} />}

      {actions && actions.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-secondary">
            Account history ({actions.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-1 text-xs text-secondary">
            {actions.map((a) => (
              <li key={`${a.action}-${a.at}`}>
                <span
                  className={`font-semibold ${
                    a.action === "suspend" || a.action === "lock_withdrawals"
                      ? "text-no"
                      : a.action === "stake_level" && !a.reason.startsWith("Normal")
                        ? "text-warning"
                        : "text-yes"
                  }`}
                >
                  {ACTION_LABEL[a.action] ?? a.action}
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

const ACTION_LABEL: Record<string, string> = {
  suspend: "Suspended",
  reinstate: "Lifted",
  lock_withdrawals: "Withdrawals locked",
  unlock_withdrawals: "Withdrawals unlocked",
  stake_level: "Stake level",
};

/* ---------------- stake level ---------------- */

export const STAKE_LEVEL: Record<StakeLevel, { label: string; chip: string }> = {
  normal: { label: "Normal", chip: "bg-element-2 text-secondary" },
  reduced: { label: "Reduced", chip: FLAG_TONE.caution.chip },
  restricted: { label: "Restricted", chip: FLAG_TONE.danger.chip },
};

/** A small chip naming a limited customer's level; nothing for normal. */
export function StakeLevelChip({ level }: { level: StakeLevel | undefined }) {
  if (!level || level === "normal") return null;
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STAKE_LEVEL[level].chip}`}
    >
      {STAKE_LEVEL[level].label}
    </span>
  );
}

const LEVELS: StakeLevel[] = ["normal", "reduced", "restricted"];

/**
 * How much of the stake limits this customer gets, and changing it: pick a
 * level, say why (for the account's history, never shown to them), save.
 * The abuse checks restrict a flagged customer on their own; clearing the
 * alert on Today puts them back. Shows what each level means in naira,
 * from the limits in Settings.
 */
export function StakeLevelControl({ trader, onChanged }: { trader: TraderRow; onChanged: () => void }) {
  const current: StakeLevel = trader.stakeLevel ?? "normal";
  const name = trader.displayName || trader.username || "this account";
  const book = useAdminResource(fetchBookSettings, true);
  const [picked, setPicked] = useState<StakeLevel | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // an API older than stake levels sends no level: nothing to show
  if (trader.stakeLevel === undefined) return null;

  const s = book.data?.settings;
  /** What a level allows, in naira, as the API works it out; null until Settings load. */
  const limits = (level: StakeLevel) => {
    if (!s || s.reducedStakePct === undefined) return null;
    const pct = level === "restricted" ? s.restrictedStakePct : level === "reduced" ? s.reducedStakePct : 100;
    const scale = (kobo: number) =>
      pct >= 100 ? kobo : Math.max(Math.floor((kobo * pct) / 100 / 100) * 100, s.minStakeKobo);
    const perBet = scale(s.maxStakeKobo);
    const perMarket = s.maxStakePerMarketKobo > 0 ? scale(s.maxStakePerMarketKobo) : pct < 100 ? perBet * 4 : 0;
    return `up to ${formatNaira(perBet)} a bet${perMarket > 0 ? ` and ${formatNaira(perMarket)} a market` : ""}${
      pct < 100 ? ` (${pct}% of the limits)` : ""
    }`;
  };
  const auto = trader.stakeLevelBy === "system:abuse";
  const returnsOn =
    auto && trader.stakeLevelAt ? new Date(new Date(trader.stakeLevelAt).getTime() + 7 * 86_400_000).toISOString() : null;

  const save = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await setStakeLevel(trader.authUserId, picked, reason.trim());
      showToast(`${name} is on ${STAKE_LEVEL[picked].label} now`, "success");
      setPicked(null);
      setReason("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Request failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-md border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          Stake level: <span className={current === "normal" ? "" : current === "reduced" ? "text-warning" : "text-no"}>
            {STAKE_LEVEL[current].label}
          </span>
          {limits(current) && <span className="font-normal text-secondary"> · {limits(current)}</span>}
        </p>
        <div role="group" aria-label="Stake level" className="flex rounded-md bg-element-2 p-0.5">
          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={(picked ?? current) === level}
              onClick={() => {
                setPicked(level === current ? null : level);
                setError(null);
              }}
              className={`h-8 rounded-sm px-3 text-xs font-semibold ${
                (picked ?? current) === level ? "bg-surface text-primary shadow-card" : "text-secondary hover:text-primary"
              }`}
            >
              {STAKE_LEVEL[level].label}
            </button>
          ))}
        </div>
      </div>
      {current !== "normal" && trader.stakeLevelAt && (
        <p className="mt-1 text-xs text-secondary">
          {auto ? "Set automatically by the abuse checks" : `Set by ${trader.stakeLevelBy}`} on {when(trader.stakeLevelAt)}
          {trader.stakeLevelReason && <>: &ldquo;{trader.stakeLevelReason}&rdquo;</>}
          {returnsOn &&
            `. Back to Normal on its own from ${when(returnsOn)} once the checks stop flagging them, or when you clear their alert on Today.`}
        </p>
      )}
      {picked && (
        <div className="mt-2 border-t border-border pt-2">
          <p className="text-secondary">
            Move {name} to <b className="text-primary">{STAKE_LEVEL[picked].label}</b>
            {`${limits(picked) ? `: ${limits(picked)}.` : "."} Bets already placed aren’t touched. They aren’t told; a bet over their limit is refused with the limit it allows.`}
          </p>
          <label className="mt-2 block">
            <span className="text-xs font-medium text-secondary">Why (for the account&rsquo;s history; the customer never sees it)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              autoFocus
              placeholder={picked === "normal" ? "e.g. Checked their bets, all fine" : "e.g. Buying X post counts late in the day"}
              className="mt-1 h-9 w-full rounded-md border border-border bg-sunken px-3 text-sm outline-none placeholder:text-tertiary focus:border-accent"
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || reason.trim().length < MIN_REASON}
              className="pressable h-9 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? "Saving…" : `Set to ${STAKE_LEVEL[picked].label}`}
            </button>
            <button
              type="button"
              onClick={() => {
                setPicked(null);
                setReason("");
                setError(null);
              }}
              disabled={busy}
              className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-secondary hover:text-primary"
            >
              Cancel
            </button>
            {reason.trim().length < MIN_REASON && (
              <span className="text-xs text-tertiary">Write at least {MIN_REASON} characters.</span>
            )}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-no">{error}</p>}
    </div>
  );
}

/**
 * The lighter stop: lock withdrawals and leave betting alone. The customer
 * isn't emailed; they only see that their account is being checked when
 * they try to withdraw. The note is for the desk.
 */
function WithdrawalLock({ trader, onChanged }: { trader: AccountRef; onChanged: () => void }) {
  const locked = Boolean(trader.withdrawalsLockedAt);
  const name = trader.displayName || trader.username || "this account";
  const [step, setStep] = useState<"idle" | "confirm">("idle");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      if (locked) await unlockWithdrawals(trader.authUserId, note.trim());
      else await lockWithdrawals(trader.authUserId, note.trim());
      showToast(locked ? `${name} can withdraw again` : `${name}'s withdrawals are locked`, "success");
      setStep("idle");
      setNote("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Request failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      {locked && (
        <div className={`rounded-md border px-3 py-2.5 text-sm ${FLAG_TONE.caution.banner}`}>
          <p className="flex items-center gap-1.5 font-semibold text-warning">
            <Lock className="size-4 shrink-0" aria-hidden />
            Withdrawals locked since {when(trader.withdrawalsLockedAt)}
          </p>
          <p className="mt-1 text-xs text-secondary">
            They can still bet and add money. If they try to withdraw, they&rsquo;re told their account is going through
            checks.
          </p>
        </div>
      )}
      {step === "idle" ? (
        <button
          type="button"
          onClick={() => setStep("confirm")}
          className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-sm border border-border px-3 text-sm font-semibold text-primary hover:border-border-hover"
        >
          {!locked && <Lock className="size-4" aria-hidden />}
          {locked ? "Unlock withdrawals…" : "Lock withdrawals only…"}
        </button>
      ) : (
        <div className="mt-2 rounded-md border border-border bg-surface p-3 text-sm">
          <p className="font-semibold">
            {locked
              ? `Let ${name} withdraw again?`
              : `Lock ${name}'s withdrawals? They can keep betting. If they try to withdraw, they'll see that their account is going through checks because we found some suspicious activity. No email is sent.`}
          </p>
          <label className="mt-2 block">
            <span className="text-xs font-medium text-secondary">Note for the team (optional, the customer never sees it)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder={locked ? "e.g. Checked, all fine" : "e.g. Checking their X post bets"}
              className="mt-1 h-9 w-full rounded-md border border-border bg-sunken px-3 text-sm outline-none placeholder:text-tertiary focus:border-accent"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={go}
              disabled={busy}
              className="pressable h-9 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? "Saving…" : locked ? "Yes, unlock" : "Yes, lock withdrawals"}
            </button>
            <button
              type="button"
              onClick={() => setStep("idle")}
              disabled={busy}
              className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-secondary hover:text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-no">{error}</p>}
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
