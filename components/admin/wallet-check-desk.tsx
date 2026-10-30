"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircleIcon as Check,
  MinusCircleIcon as Skipped,
  XCircleIcon as Cross,
} from "@heroicons/react/24/outline";
import { ApiError, isApiConfigured } from "@/lib/api-client";
import { fetchWalletChecks, runWalletCheck, type WalletCheckRun, type WalletCheckStep } from "@/lib/admin-api";
import { FLAG_TONE } from "@/components/admin/risk-flags";

/**
 * The quick wallet check: is the live WorldStreet wallet really working for
 * Predict? One button adds 1 cent to the dollar wallet of an account the admin
 * picks, takes it back, and repeats each request to prove nothing pays
 * twice, reading the balance every time (trading/wallet-check.ts). The
 * answer is a plain working or not working, with the wallet's own words
 * for each step to pass to the wallet team. The full money test is the next
 * tab (guided-money-test.tsx).
 */

export function WalletCheckDesk() {
  const [runs, setRuns] = useState<WalletCheckRun[] | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; code: string | null } | null>(null);
  const [account, setAccount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const configured = isApiConfigured();

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    fetchWalletChecks()
      .then((list) => {
        if (!cancelled) setRuns(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError({
          message: err instanceof Error ? err.message : "Request failed",
          code: err instanceof ApiError ? err.code : null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [configured]);

  if (!configured) return <Notice>This desk needs the prediction API (NEXT_PUBLIC_API_URL).</Notice>;
  if (loadError?.code === "FORBIDDEN") return <Notice>Your account isn&rsquo;t an admin of the Local book.</Notice>;
  if (loadError?.code === "NOT_FOUND") {
    return <Notice>The API answering is older than this page — redeploy the API.</Notice>;
  }

  const run = async () => {
    setBusy(true);
    setRunError(null);
    try {
      const result = await runWalletCheck(account.trim());
      setRuns((list) => [result, ...(list ?? [])].slice(0, 10));
      setConfirming(false);
    } catch (err) {
      setRunError(err instanceof Error && err.message ? err.message : "Request failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const [latest, ...earlier] = runs ?? [];

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Quick wallet check</h1>
      <p className="mt-1 text-sm text-secondary">
        One button, a few seconds. It tests adding and taking dollars, and that nothing pays or charges twice. If it
        says Working, go on to the{" "}
        <Link href="/admin/money-test" className="font-semibold text-accent-ink hover:underline">
          full money test
        </Link>
        .
      </p>

      <section className="mt-4 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
        <label className="block">
          <span className="text-sm font-semibold">Account to test on</span>
          <input
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setConfirming(false);
            }}
            placeholder="Username or email"
            className="mt-1 h-10 w-full rounded-md border border-border bg-sunken px-3 text-sm outline-none placeholder:text-tertiary focus:border-accent"
          />
        </label>
        <p className="mt-2 text-xs text-secondary">
          Use your own account, not a customer&rsquo;s. This moves real money: it adds $0.01 to that dollar wallet
          and takes it back, and both may show in its history. The Predict balance isn&rsquo;t touched.
        </p>

        {confirming ? (
          <div className="mt-3 rounded-md border border-border bg-page p-3">
            <p className="text-sm font-semibold">
              Add $0.01 to @{account.trim().replace(/^@/, "")}&rsquo;s dollar wallet and take it back?
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={run}
                disabled={busy}
                className="pressable h-9 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
              >
                {busy ? "Checking… this takes a few seconds" : "Yes, run the check"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-secondary hover:text-primary"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setRunError(null);
              setConfirming(true);
            }}
            disabled={account.trim().length < 2}
            className="pressable mt-3 h-9 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
          >
            Run the check…
          </button>
        )}
        {runError && <p className="mt-2 text-sm font-semibold text-no">{runError}</p>}
      </section>

      {loadError && <p className="mt-4 text-sm font-semibold text-no">Couldn&rsquo;t load: {loadError.message}</p>}
      {latest && <Result run={latest} />}

      {earlier.length > 0 && (
        <section className="mt-4 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
          <h2 className="text-base font-semibold">Earlier checks</h2>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {earlier.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className={`font-semibold ${r.verdict === "working" ? "text-yes" : "text-no"}`}>
                  {r.verdict === "working" ? "Working" : "Not working"}
                </span>
                <span className="text-xs text-tertiary">
                  @{r.account} · {r.ranBy} · {when(r.ranAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Result({ run }: { run: WalletCheckRun }) {
  const working = run.verdict === "working";
  return (
    <section
      className={`mt-4 rounded-xl border p-4 shadow-card sm:p-5 ${
        working ? "border-border bg-yes-tint" : FLAG_TONE.danger.banner
      }`}
    >
      <h2 className={`text-xl font-semibold ${working ? "text-yes" : "text-no"}`}>
        {working ? "Working" : "Not working"}
      </h2>
      <p className="mt-1 text-sm font-semibold text-primary">{run.summary}</p>
      <p className="mt-1 text-xs text-secondary">
        Tested on @{run.account} by {run.ranBy} · {when(run.ranAt)}
      </p>
      {run.leftoverMinor > 0 && (
        <p className={`mt-2 rounded-md px-2.5 py-1.5 text-xs font-semibold ${FLAG_TONE.caution.chip}`}>
          ${(run.leftoverMinor / 100).toFixed(2)} from this check is still in that dollar wallet.
        </p>
      )}
      <ol className="mt-3 flex flex-col gap-2">
        {run.steps.map((s) => (
          <Step key={s.key} step={s} />
        ))}
      </ol>
    </section>
  );
}

function Step({ step }: { step: WalletCheckStep }) {
  const Icon = step.status === "pass" ? Check : step.status === "fail" ? Cross : Skipped;
  const tone = step.status === "pass" ? "text-yes" : step.status === "fail" ? "text-no" : "text-tertiary";
  return (
    <li className="flex gap-2 rounded-md border border-border bg-surface p-3">
      <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{step.label}</p>
        <p className="mt-0.5 break-words text-[13px] text-secondary">{step.detail}</p>
      </div>
    </li>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl rounded-xl border border-border bg-surface p-6 text-sm leading-6 text-secondary shadow-card">
      {children}
    </div>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
