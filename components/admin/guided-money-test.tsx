"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowPathIcon as RefreshCw,
  CheckCircleIcon as Check,
  XCircleIcon as Cross,
} from "@heroicons/react/24/outline";
import { fetchTestAccount, type TestAccount } from "@/lib/admin-api";
import { FLAG_TONE } from "@/components/admin/risk-flags";

/**
 * The full money test of deposits and withdrawals: an admin does the real thing
 * on the customer site, and this page reads the balances before and after
 * each step and says pass or fail, so nobody does the sums by hand. It moves
 * no money itself and only reads (GET /admin/wallet-check/account). Results
 * live on this page until it's reloaded.
 */

/** `pending`: nothing has moved yet, so it hasn't failed, it just isn't done. */
type Result = { ok: boolean; pending?: boolean; lines: string[] };
type StepKey = "deposit" | "bet" | "withdraw";

const money = {
  usd: (minor: number) => `${minor < 0 ? "−" : ""}$${(Math.abs(minor) / 100).toFixed(2)}`,
  ngn: (kobo: number) =>
    `${kobo < 0 ? "−" : ""}₦${(Math.abs(kobo) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`,
};

/** What the step should have done, worked out with the same rounding the API uses. */
function expected(step: StepKey, amount: number, before: TestAccount): { dollars: number; credit: number } | null {
  if (step === "deposit") {
    if (!before.usdToNgn) return null;
    const minor = Math.round(amount * 100);
    return { dollars: -minor, credit: Math.floor(minor * before.usdToNgn) };
  }
  const kobo = Math.round(amount * 100);
  if (step === "bet") return { dollars: 0, credit: -kobo };
  if (!before.ngnToUsd) return null;
  return { dollars: Math.floor(kobo / before.ngnToUsd), credit: -kobo };
}

function compare(step: StepKey, amount: number, before: TestAccount, after: TestAccount): Result {
  if (before.dollarsMinor === null || after.dollarsMinor === null) {
    return { ok: false, lines: [`Couldn't read the dollar wallet: ${after.walletError || before.walletError}`] };
  }
  const want = expected(step, amount, before);
  if (!want) return { ok: false, lines: ["No exchange rate is set. Set one in Settings."] };
  const dollars = after.dollarsMinor - before.dollarsMinor;
  const credit = after.balanceKobo - before.balanceKobo;
  const lines = [
    `Dollar wallet: changed by ${money.usd(dollars)}, should be ${money.usd(want.dollars)}.`,
    `Predict balance: changed by ${money.ngn(credit)}, should be ${money.ngn(want.credit)}.`,
  ];
  const ok = dollars === want.dollars && credit === want.credit;
  if (!ok && dollars === 0 && credit === 0) {
    return { ok, pending: true, lines: ["Nothing has moved yet. Finish the step on the customer site, then check again."] };
  }
  if (!ok && step === "withdraw" && dollars === 0 && credit === want.credit) {
    lines.push(
      "The balance went down but no dollars arrived. Stop here. Look in Withdrawals: if it's there, it's waiting for approval. If not, send this to the developers.",
    );
  }
  return { ok, lines };
}

export function GuidedTest() {
  const [accountInput, setAccountInput] = useState("");
  const account = accountInput.trim();
  const [before, setBefore] = useState<TestAccount | null>(null);
  const [now, setNow] = useState<TestAccount | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<StepKey, string>>({ deposit: "5", bet: "200", withdraw: "2000" });
  const [results, setResults] = useState<Partial<Record<StepKey, Result>>>({});
  const [bank, setBank] = useState<"yes" | "no" | null>(null);
  const [approval, setApproval] = useState<"yes" | "no" | null>(null);

  const read = async (label: string, name = now?.username ?? account) => {
    setBusy(label);
    setError(null);
    try {
      return await fetchTestAccount(name);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Request failed. Try again.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    const seen = await read("start", account);
    if (!seen) return;
    setBefore(seen);
    setNow(seen);
    setResults({});
    setBank(null);
    setApproval(null);
  };

  const checkStep = async (step: StepKey) => {
    if (!before) return;
    const after = await read(step);
    if (!after) return;
    const result = compare(step, Number(amounts[step]), before, after);
    setNow(after);
    setResults((r) => ({ ...r, [step]: result }));
    // the next step measures from here
    if (result.ok) setBefore(after);
  };

  const refresh = async () => {
    const seen = await read("refresh");
    if (seen) setNow(seen);
  };

  const blocker = now?.suspended
    ? "This account is suspended, so it can't deposit or withdraw. Use another one."
    : now?.flagged
      ? "This account is flagged, so its withdrawal will wait for approval. Use another one."
      : null;
  const passed = (step: StepKey) => results[step]?.ok === true;
  const failed = Object.values(results).some((r) => !r.ok && !r.pending) || bank === "no" || approval === "no";
  const done = passed("deposit") && passed("bet") && passed("withdraw") && bank === "yes" && approval === "yes";

  return (
    <section id="full-money-test" className="mt-10 scroll-mt-6">
      <h2 className="text-xl font-semibold tracking-tight">2. Full money test</h2>
      <p className="mt-1 text-sm text-secondary">
        Do each step yourself on the customer site, logged in as your own account, in another tab, using a small amount
        of real money. Then click the check button here, and this page tells you if the money moved correctly. This page
        only reads balances and never moves money.
      </p>

      {!now ? (
        <section className="mt-4 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
          <label className="block">
            <span className="text-sm font-semibold">Your account</span>
            <input
              value={accountInput}
              onChange={(e) => setAccountInput(e.target.value)}
              placeholder="Username or email"
              className="mt-1 h-10 w-full rounded-md border border-border bg-sunken px-3 text-sm outline-none placeholder:text-tertiary focus:border-accent"
            />
          </label>
          <button
            type="button"
            onClick={start}
            disabled={account.length < 2 || busy !== null}
            className="pressable mt-3 h-9 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
          >
            {busy === "start" ? "Reading…" : "Start the test"}
          </button>
          {error && <p className="mt-3 text-sm font-semibold text-no">{error}</p>}
        </section>
      ) : (
        <>
          <div className="mt-3 rounded-md bg-element-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">@{now.username} right now</p>
              <button
                type="button"
                onClick={refresh}
                disabled={busy !== null}
                className="flex h-8 items-center gap-1.5 rounded-sm border border-border px-3 text-xs font-semibold text-secondary hover:text-primary disabled:opacity-40"
              >
                <RefreshCw className={`size-3.5 ${busy === "refresh" ? "animate-spin" : ""}`} aria-hidden />
                Refresh
              </button>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              <Figure label="Dollar wallet" value={now.dollarsMinor === null ? "Unknown" : money.usd(now.dollarsMinor)} />
              <Figure label="Locked dollars" value={now.lockedMinor === null ? "Unknown" : money.usd(now.lockedMinor)} />
              <Figure label="Predict balance" value={money.ngn(now.balanceKobo)} />
              <Figure label="Rate" value={now.usdToNgn ? `$1 buys ₦${now.usdToNgn.toFixed(2)}` : "Not set"} />
            </dl>
            {now.walletError && <p className="mt-2 text-sm font-semibold text-no">The wallet answered {now.walletError}</p>}
          </div>

          {blocker && (
            <p className={`mt-3 rounded-md px-3 py-2 text-sm font-semibold ${FLAG_TONE.danger.chip}`}>{blocker}</p>
          )}

          <ol className="mt-3 flex flex-col gap-2">
            <MoneyStep
              n={1}
              title="Deposit"
              how="On the customer site: click Deposit, choose Add credit, and convert this many dollars."
              unit="$"
              value={amounts.deposit}
              onChange={(v) => setAmounts((a) => ({ ...a, deposit: v }))}
              onCheck={() => checkStep("deposit")}
              busy={busy === "deposit"}
              disabled={busy !== null}
              result={results.deposit}
            />
            <MoneyStep
              n={2}
              title="Place a small bet"
              how="On the customer site: pick any open market and bet this much."
              unit="₦"
              value={amounts.bet}
              onChange={(v) => setAmounts((a) => ({ ...a, bet: v }))}
              onCheck={() => checkStep("bet")}
              busy={busy === "bet"}
              disabled={busy !== null || !passed("deposit")}
              result={results.bet}
            />
            <MoneyStep
              n={3}
              title="Withdraw to dollars"
              how={`On the customer site: click Deposit, choose Withdraw, and withdraw this much. Keep the day's total under ${money.ngn(
                now.reviewKobo,
              )}, or it will wait for approval.`}
              unit="₦"
              value={amounts.withdraw}
              onChange={(v) => setAmounts((a) => ({ ...a, withdraw: v }))}
              onCheck={() => checkStep("withdraw")}
              busy={busy === "withdraw"}
              disabled={busy !== null || !passed("bet")}
              result={results.withdraw}
            />
            <AskStep
              n={4}
              title="Send to a bank or OPay"
              how="On WorldStreet Gold: send $1 or $2 from the dollar wallet to your bank or OPay. Only the wallet team's system does this, so this page can't check it for you. Did the money arrive, and did Locked dollars above go back down? Click Refresh to see."
              answer={bank}
              onAnswer={setBank}
              disabled={!passed("withdraw")}
            />
            <AskStep
              n={5}
              title="Approve one real withdrawal"
              how="Go to the Withdrawals tab and approve one customer who has nothing against them. Did it say the wallet confirmed the dollars, and did it leave the list?"
              answer={approval}
              onAnswer={setApproval}
              disabled={bank !== "yes"}
              link
            />
          </ol>

          {error && <p className="mt-3 text-sm font-semibold text-no">{error}</p>}
          {done && (
            <p className="mt-3 rounded-md bg-yes-tint px-3 py-2 text-sm font-semibold text-yes">
              All 5 passed. Deposits and withdrawals work end to end. You can approve the rest and tell customers.
            </p>
          )}
          {failed && !done && (
            <p className={`mt-3 rounded-md px-3 py-2 text-sm font-semibold ${FLAG_TONE.danger.chip}`}>
              A step failed. Stop here, don&rsquo;t approve any more withdrawals, and send what it says to the developers
              or the wallet team.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ---------- steps ---------- */

function MoneyStep({
  n,
  title,
  how,
  unit,
  value,
  onChange,
  onCheck,
  busy,
  disabled,
  result,
}: {
  n: number;
  title: string;
  how: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  onCheck: () => void;
  busy: boolean;
  disabled: boolean;
  result?: Result;
}) {
  const valid = Number(value) > 0;
  return (
    <li className="rounded-md border border-border bg-page p-3">
      <StepTitle n={n} title={title} state={!result || result.pending ? null : result.ok ? "pass" : "fail"} />
      <p className="mt-1 text-sm text-secondary">{how}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex h-9 items-center gap-1 rounded-md border border-border bg-sunken px-3 text-sm">
          <span className="text-secondary">{unit}</span>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            inputMode="decimal"
            aria-label={`${title} amount`}
            className="w-20 bg-transparent outline-none"
          />
        </label>
        <button
          type="button"
          onClick={onCheck}
          disabled={disabled || !valid}
          className="pressable h-9 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
        >
          {busy ? "Checking…" : "I've done it, check it"}
        </button>
      </div>
      {result && (
        <ul className={`mt-2 text-[13px] ${result.ok ? "text-secondary" : "text-primary"}`}>
          {result.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function AskStep({
  n,
  title,
  how,
  answer,
  onAnswer,
  disabled,
  link,
}: {
  n: number;
  title: string;
  how: string;
  answer: "yes" | "no" | null;
  onAnswer: (a: "yes" | "no") => void;
  disabled: boolean;
  link?: boolean;
}) {
  return (
    <li className="rounded-md border border-border bg-page p-3">
      <StepTitle n={n} title={title} state={answer === "yes" ? "pass" : answer === "no" ? "fail" : null} />
      <p className="mt-1 text-sm text-secondary">{how}</p>
      {link && (
        <Link href="/admin/money" target="_blank" className="mt-1 inline-block text-xs font-semibold text-accent-ink hover:underline">
          Open Withdrawals in a new tab
        </Link>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onAnswer("yes")}
          disabled={disabled}
          className="pressable h-9 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
        >
          Yes, it worked
        </button>
        <button
          type="button"
          onClick={() => onAnswer("no")}
          disabled={disabled}
          className="h-9 rounded-sm border border-no/40 px-4 text-sm font-semibold text-no hover:bg-no-tint disabled:opacity-40"
        >
          No, it failed
        </button>
      </div>
    </li>
  );
}

function StepTitle({ n, title, state }: { n: number; title: string; state: "pass" | "fail" | null }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
      Step {n}: {title}
      {state === "pass" && (
        <span className="inline-flex items-center gap-1 text-yes">
          <Check className="size-4" aria-hidden />
          Passed
        </span>
      )}
      {state === "fail" && (
        <span className="inline-flex items-center gap-1 text-no">
          <Cross className="size-4" aria-hidden />
          Failed
        </span>
      )}
    </p>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-secondary">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
