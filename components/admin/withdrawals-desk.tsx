"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowPathIcon as RefreshCw,
  CheckCircleIcon as Check,
} from "@heroicons/react/24/outline";
import { ApiError, isApiConfigured } from "@/lib/api-client";
import {
  fetchWithdrawalDesk,
  resolveWithdrawal,
  type WithdrawalCheckRow,
  type WithdrawalDesk,
  type WithdrawalPerson,
} from "@/lib/admin-api";
import { useAdminMoney, type AdminMoney } from "@/lib/admin-money";
import { showToast } from "@/lib/toast-store";
import { FLAG_TONE } from "@/components/admin/risk-flags";
import { blockedNotice, when } from "@/components/admin/watch-parts";

/**
 * Withdrawals: one decision per customer. Their requests are stacked under
 * them, with what they want to take out, what they had, where the money
 * came from, and whether anything is held against them. Sending money takes
 * a confirmation, and "Approve all" stops at the first one that doesn't
 * go through (trading/withdrawals.ts).
 */

const NEUTRAL = "bg-element-2 text-secondary";

const VERDICT: Record<WithdrawalPerson["verdict"], { label: string; chip: string }> = {
  clear: { label: "Not suspicious", chip: "bg-yes-tint text-yes" },
  suspicious: { label: "Suspicious", chip: FLAG_TONE.danger.chip },
  fault: { label: "System fault", chip: FLAG_TONE.caution.chip },
  suspended: { label: "Suspended", chip: FLAG_TONE.danger.chip },
};

const isReview = (r: WithdrawalCheckRow) => r.status === "review";

export function WithdrawalsDesk() {
  const money = useAdminMoney();
  const [reloads, setReloads] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: number;
    data: WithdrawalDesk | null;
    error: string | null;
    errorCode: string | null;
  } | null>(null);
  const configured = isApiConfigured();

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    fetchWithdrawalDesk()
      .then((data) => {
        if (!cancelled) setLoaded({ key: reloads, data, error: null, errorCode: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoaded({
          key: reloads,
          data: null,
          error: err instanceof Error ? err.message : "Request failed",
          errorCode: err instanceof ApiError ? err.code : null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [configured, reloads]);

  const fresh = loaded?.key === reloads ? loaded : null;
  const blocked = blockedNotice(configured, fresh?.errorCode ?? null);
  if (blocked) return blocked;
  const desk = fresh?.data ?? loaded?.data ?? null;
  const reload = () => setReloads((n) => n + 1);
  const people = desk?.people ?? [];
  const totalKobo = people.reduce((s, p) => s + p.heldKobo, 0);

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Withdrawals</h1>
          <p className="mt-1 text-sm text-secondary">
            Money waiting on your decision. Approving sends the dollars to the customer&rsquo;s WorldStreet wallet;
            rejecting puts the money back in their Predict balance. They&rsquo;re emailed either way.
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
        >
          <RefreshCw className={`size-3.5 ${fresh === null ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {fresh?.error && <p className="mt-4 text-sm font-semibold text-no">Couldn&rsquo;t load: {fresh.error}</p>}
      {!desk ? (
        <div className="mt-4 flex flex-col gap-3" aria-busy="true" aria-label="Loading withdrawals">
          {[0, 1].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-element-2" />
          ))}
        </div>
      ) : (
        <>
          {people.length === 0 ? (
            <p className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-border bg-surface py-12 text-center text-sm text-secondary shadow-card">
              <Check className="size-6 text-yes" aria-hidden />
              No withdrawals are waiting.
            </p>
          ) : (
            <>
              <p className="mt-4 text-sm font-semibold">
                {people.length} customer{people.length === 1 ? "" : "s"} waiting · {money.format(totalKobo)} in all
              </p>
              <ul className="mt-2 flex flex-col gap-3">
                {people.map((p) => (
                  <PersonCard key={p.authUserId} person={p} money={money} onDone={reload} />
                ))}
              </ul>
            </>
          )}

          {desk.settled.length > 0 && (
            <section className="mt-6 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
              <h2 className="text-base font-semibold">Recently settled</h2>
              <ul className="mt-2 flex flex-col divide-y divide-border">
                {desk.settled.map((r) => (
                  <li key={r.refKey} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0">
                      @{r.username || r.authUserId} · {money.format(r.amountKobo)} → ${(r.amountUsdMinor / 100).toFixed(2)}
                    </span>
                    <span className="text-xs text-tertiary">
                      <span className={r.status === "paid" ? "font-semibold text-yes" : "font-semibold text-secondary"}>
                        {r.status === "paid" ? "Paid" : "Money returned"}
                      </span>
                      {r.resolvedBy ? ` · ${r.resolvedBy}` : ""}
                      {r.resolvedAt ? ` · ${when(r.resolvedAt)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- one customer ---------- */

function PersonCard({ person: p, money, onDone }: { person: WithdrawalPerson; money: AdminMoney; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const verdict = VERDICT[p.verdict];
  const toApprove = p.requests.filter(isReview);
  const canApprove = p.verdict !== "suspended";
  const outKobo = p.paidOutKobo + p.heldKobo;
  const usd = (p.heldUsdMinor / 100).toFixed(2);

  const approveAll = async () => {
    setBusy(true);
    setConfirmAll(false);
    let paid = 0;
    try {
      for (const r of toApprove) {
        const res = await resolveWithdrawal(r.refKey, "retry");
        if (res.status !== "paid") {
          showToast(`Stopped after ${paid} sent. ${res.message}`, "error");
          return;
        }
        paid += 1;
      }
      showToast(`All ${paid} sent to @${p.username}`, "success");
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "Request failed. Try again.";
      showToast(`Stopped after ${paid} sent. ${message}`, "error");
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <li
      className={`rounded-xl border p-4 shadow-card sm:p-5 ${
        p.verdict === "clear" ? "border-border bg-surface" : FLAG_TONE.danger.banner
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{p.displayName || p.username || p.authUserId}</p>
          <p className="truncate text-xs text-tertiary">
            @{p.username}
            {p.email ? ` · ${p.email}` : ""}
          </p>
        </div>
        <span className={`shrink-0 rounded-sm px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${verdict.chip}`}>
          {verdict.label}
        </span>
      </div>

      <VerdictNote person={p} />

      <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Figure label="Wants to withdraw" value={money.format(p.heldKobo)} sub={`$${usd}`} strong />
        <Figure label="Had in balance" value={money.format(p.balanceKobo + p.heldKobo)} />
        <Figure label="Left after this" value={money.format(p.balanceKobo)} />
      </dl>

      <div className="mt-3 rounded-md bg-element-2 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-secondary">Where the money came from, all time</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <Plain label="Put in" value={money.format(p.addedKobo)} />
          <Plain label="Already taken out" value={money.format(p.paidOutKobo)} />
          <Plain
            label="Won or lost on bets"
            value={money.formatSigned(p.betProfitKobo)}
            tone={p.betProfitKobo >= 0 ? "text-yes" : "text-no"}
          />
          <Plain label="Winnings reversed" value={money.format(p.reversedKobo)} />
        </dl>
        {outKobo > p.addedKobo && (
          <p className="mt-2 text-xs text-secondary">
            With this withdrawal they&rsquo;ll have taken out {money.format(outKobo - p.addedKobo)} more than they put
            in. That&rsquo;s normal for a winner, as long as the bets above explain it.
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {p.requests.length} request{p.requests.length === 1 ? "" : "s"}
        </p>
        <Link href={`/admin/traders?search=${encodeURIComponent(p.username)}`} className="text-xs font-semibold text-accent-ink hover:underline">
          See their bets in Traders
        </Link>
      </div>
      <ol className="mt-2 flex flex-col gap-2">
        {p.requests.map((r) => (
          <Request key={r.refKey} request={r} person={p} money={money} onDone={onDone} disabled={busy} />
        ))}
      </ol>

      {toApprove.length > 1 && canApprove && (
        <div className="mt-3 border-t border-border pt-3">
          {confirmAll ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="w-full text-sm font-semibold">
                Send all {toApprove.length} requests to @{p.username}&rsquo;s wallet?
                {p.verdict !== "clear" && " This customer has an open alert."}
              </p>
              <button
                type="button"
                onClick={approveAll}
                className="pressable h-9 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover"
              >
                Yes, send all {toApprove.length}
              </button>
              <button
                type="button"
                onClick={() => setConfirmAll(false)}
                className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-secondary hover:text-primary"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmAll(true)}
              disabled={busy}
              className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-primary hover:border-border-hover disabled:opacity-40"
            >
              {busy ? "Sending…" : `Approve all ${toApprove.length}…`}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** In one line: what's going on with this customer, and what to do. */
function VerdictNote({ person: p }: { person: WithdrawalPerson }) {
  if (p.verdict === "suspended") {
    return (
      <p className="mt-2 text-sm font-semibold text-primary">
        Their account is suspended, so this can&rsquo;t be approved. Reject it, or lift the suspension first.
        {p.suspendedReason && <span className="mt-1 block font-normal text-secondary">Reason: {p.suspendedReason}</span>}
      </p>
    );
  }
  if (p.verdict === "suspicious" || p.verdict === "fault") {
    return (
      <div className="mt-2 text-sm">
        <p className="font-semibold text-primary">
          {p.verdict === "suspicious"
            ? "Don't approve until you've checked them."
            : "Their balance doesn't match our records. It's not their doing, but ask the developers before approving."}
        </p>
        <ul className="mt-1 text-secondary">
          {p.flags.map((f) => (
            <li key={f.id}>{f.subject}</li>
          ))}
        </ul>
        <Link href="/admin/alerts" className="mt-1 inline-block text-xs font-semibold text-accent-ink hover:underline">
          Clear them in Alerts if they&rsquo;re fine
        </Link>
      </div>
    );
  }
  const unconfirmedOnly = p.requests.every((r) => !isReview(r));
  const wasFlagged = p.requests.some((r) => (r.reason ?? "").startsWith("Flagged"));
  return (
    <p className="mt-2 text-sm font-semibold text-primary">
      {unconfirmedOnly
        ? "Nothing against them. The wallet never answered, so we don't know if the dollars arrived."
        : wasFlagged
          ? "Nothing against them now. They were flagged when they asked, and that alert has since been cleared."
          : "Nothing against them. It's only waiting because of the amount. If the money below makes sense, approve it."}
    </p>
  );
}

/* ---------- one request ---------- */

function Request({
  request: r,
  person: p,
  money,
  onDone,
  disabled,
}: {
  request: WithdrawalCheckRow;
  person: WithdrawalPerson;
  money: AdminMoney;
  onDone: () => void;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState<"retry" | "paid" | "return" | null>(null);
  const [confirm, setConfirm] = useState<"send" | "return" | null>(null);
  const review = isReview(r);
  const unconfirmed = r.status === "unconfirmed";
  const locked = disabled || busy !== null;
  const usd = `$${(r.amountUsdMinor / 100).toFixed(2)}`;

  const act = async (action: "retry" | "paid" | "return") => {
    setBusy(action);
    try {
      const res = await resolveWithdrawal(r.refKey, action);
      // asked to send, but it didn't go: still held, or the wallet said no
      const failed = res.status === "unconfirmed" || (action === "retry" && res.status === "returned");
      showToast(res.message, failed ? "error" : "success");
      onDone();
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : "Request failed. Try again.", "error");
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  return (
    <li className="rounded-md border border-border bg-page p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">
            {money.format(r.amountKobo)} → {usd}
          </p>
          <p className="text-xs text-tertiary">{r.createdAt ? `Asked ${when(r.createdAt)}` : ""}</p>
        </div>
        <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${unconfirmed ? FLAG_TONE.caution.chip : NEUTRAL}`}>
          {review ? "Needs your approval" : unconfirmed ? "Wallet didn't answer" : "Being checked"}
        </span>
      </div>
      {review && r.reason && <p className="mt-1 text-xs text-secondary">Why it&rsquo;s waiting: {r.reason}</p>}
      {unconfirmed && (
        <p className="mt-1 text-xs text-secondary">
          The money is held, not returned, because the dollars may have arrived. Ask the wallet again first, and only
          return it once you&rsquo;re sure they didn&rsquo;t.
          {r.lastCode ? ` The wallet said ${r.lastCode}${r.lastMessage ? `: ${r.lastMessage}` : ""}.` : ""}
        </p>
      )}

      {confirm ? (
        <div className="mt-2 rounded-md border border-border bg-surface p-3">
          <p className="font-semibold">
            {confirm === "send"
              ? `Send ${usd} to @${p.username}'s wallet? This can't be undone.`
              : `Return ${money.format(r.amountKobo)} to @${p.username}'s Predict balance?`}
            {confirm === "send" && p.verdict !== "clear" && " This customer has an open alert."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => act(confirm === "send" ? "retry" : "return")}
              disabled={locked}
              className={`pressable h-8 rounded-sm px-3 text-xs font-semibold disabled:opacity-40 ${
                confirm === "send" ? "bg-accent text-on-accent hover:bg-accent-hover" : "bg-no-solid text-white"
              }`}
            >
              {busy ? "Working…" : confirm === "send" ? `Yes, send ${usd}` : "Yes, return it"}
            </button>
            <button
              type="button"
              onClick={() => setConfirm(null)}
              disabled={busy !== null}
              className="h-8 rounded-sm border border-border px-3 text-xs font-semibold text-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {review && p.verdict !== "suspended" && (
            <button
              type="button"
              onClick={() => setConfirm("send")}
              disabled={locked}
              className="pressable h-8 rounded-sm bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
            >
              Approve…
            </button>
          )}
          {unconfirmed && (
            <>
              <button
                type="button"
                onClick={() => act("retry")}
                disabled={locked}
                className="pressable h-8 rounded-sm bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
              >
                {busy === "retry" ? "Asking…" : "Ask the wallet again"}
              </button>
              <button
                type="button"
                onClick={() => act("paid")}
                disabled={locked}
                className="h-8 rounded-sm border border-border px-3 text-xs font-semibold text-secondary hover:text-primary disabled:opacity-40"
              >
                The dollars arrived
              </button>
            </>
          )}
          {(review || unconfirmed) && (
            <button
              type="button"
              onClick={() => setConfirm("return")}
              disabled={locked}
              className="h-8 rounded-sm border border-no/40 px-3 text-xs font-semibold text-no hover:bg-no-tint disabled:opacity-40"
            >
              {review ? "Reject…" : "Return the money…"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/* ---------- bits ---------- */

function Figure({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={`rounded-md border border-border px-3 py-2 ${strong ? "bg-page" : "bg-surface"}`}>
      <dt className="text-xs font-medium text-secondary">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">
        {value}
        {sub && <span className="ml-1.5 text-sm font-medium text-secondary">{sub}</span>}
      </dd>
    </div>
  );
}

function Plain({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-secondary">{label}</dt>
      <dd className={`text-sm font-semibold tabular-nums ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}
