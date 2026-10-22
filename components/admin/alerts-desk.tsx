"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowPathIcon as RefreshCw,
  BellAlertIcon as Bell,
  CheckCircleIcon as Check,
} from "@heroicons/react/24/outline";
import { ApiError, isApiConfigured } from "@/lib/api-client";
import {
  fetchAlerts,
  settleAlert,
  voidMarket,
  type AlertItem,
  type AlertKind,
  type AlertsView,
} from "@/lib/admin-api";
import { showToast } from "@/lib/toast-store";
import { BookRiskStrip } from "@/components/admin/book-risk";
import { FLAG_TONE } from "@/components/admin/risk-flags";

/**
 * Alerts: everything the API has warned the admins about by email — a
 * market at or near its loss limit, the book's possible loss past its
 * line, a market settlement couldn't finish, a withdrawal the wallet
 * never confirmed — one card per condition, with how often it fired and
 * whether it's still happening, and the fix next to it: void a market
 * that's too one-sided (refunding its bets), or the page where the fix
 * lives. "Mark settled" closes it; a condition that fires again opens it
 * back up. The live risk sits on top, and what's waiting in Support and
 * Abuse watch is counted alongside.
 */

type View = "open" | "resolved" | "all";

const KIND: Record<AlertKind, { label: string; chip: string }> = {
  risk: { label: "Risk", chip: FLAG_TONE.danger.chip },
  abuse: { label: "Abuse", chip: FLAG_TONE.danger.chip },
  settlement: { label: "Settlement", chip: FLAG_TONE.caution.chip },
  withdrawal: { label: "Withdrawal", chip: FLAG_TONE.caution.chip },
  test: { label: "Test", chip: "bg-element-2 text-secondary" },
  other: { label: "Other", chip: "bg-element-2 text-secondary" },
};

/** Details the card shows on its own, or ids nobody reads, not in the list of fields. */
const HIDDEN = new Set(["whatToDo", "alsoSeen", "eventId", "marketId"]);

export function AlertsDesk() {
  const [view, setView] = useState<View>("open");
  const [reloads, setReloads] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    data: AlertsView | null;
    error: string | null;
    errorCode: string | null;
  } | null>(null);
  const configured = isApiConfigured();
  const key = `${view}|${reloads}`;

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    fetchAlerts(view)
      .then((data) => {
        if (!cancelled) setLoaded({ key, data, error: null, errorCode: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoaded({
          key,
          data: null,
          error: err instanceof Error ? err.message : "Request failed",
          errorCode: err instanceof ApiError ? err.code : null,
        });
      });
    return () => {
      cancelled = true;
    };
    // key encodes every input to the request above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, key]);

  if (!configured) return <Notice>This desk needs the prediction API (NEXT_PUBLIC_API_URL).</Notice>;
  const fresh = loaded?.key === key ? loaded : null;
  if (fresh?.errorCode === "FORBIDDEN") return <Notice>Your account isn&rsquo;t an admin of the Local book.</Notice>;
  if (fresh?.errorCode === "NOT_FOUND") {
    return <Notice>The API answering is older than this page — redeploy the API.</Notice>;
  }
  const data = fresh?.data ?? loaded?.data ?? null;
  const loading = fresh === null;
  const reload = () => setReloads((n) => n + 1);

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
          <p className="mt-1 text-sm text-secondary">
            Everything the system has warned about, and the fix for each. Mark one settled once
            it&rsquo;s dealt with — it comes back if the problem does.
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {data && (data.waiting.support > 0 || data.waiting.withdrawals > 0) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {data.waiting.support > 0 && (
            <Waiting href="/admin/support" n={data.waiting.support} what="support request" where="Support" />
          )}
          {data.waiting.withdrawals > 0 && (
            <Waiting href="/admin/abuse" n={data.waiting.withdrawals} what="withdrawal to confirm" where="Abuse watch" />
          )}
        </div>
      )}

      {/* the book's risk right now — what most alerts are about */}
      <BookRiskStrip reloadKey={reloads} />

      <div role="group" aria-label="Which alerts" className="mt-5 inline-flex rounded-md bg-element-2 p-1">
        {(
          [
            ["open", "Open", data?.counts.open],
            ["resolved", "Settled", data?.counts.resolved],
            ["all", "All", undefined],
          ] as const
        ).map(([k, label, n]) => (
          <button
            key={k}
            type="button"
            aria-pressed={view === k}
            onClick={() => setView(k)}
            className={`flex h-9 items-center gap-1.5 rounded-sm px-3 text-sm font-semibold ${
              view === k ? "bg-surface text-primary shadow-card" : "text-secondary hover:text-primary"
            }`}
          >
            {label}
            {n !== undefined && (
              <span
                className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                  k === "open" && n > 0 ? FLAG_TONE.danger.chip : "bg-element text-tertiary"
                }`}
              >
                {n}
              </span>
            )}
          </button>
        ))}
      </div>

      <section className="mt-4">
        {fresh?.error && <p className="mb-3 text-sm font-semibold text-no">Couldn&rsquo;t load: {fresh.error}</p>}
        {!data ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading alerts">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-element-2" />
            ))}
          </div>
        ) : data.alerts.length === 0 ? (
          <p className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface py-12 text-center text-sm text-secondary shadow-card">
            {view === "open" ? <Check className="size-6 text-yes" /> : <Bell className="size-6 text-tertiary" />}
            {view === "open" ? "Nothing open — every alert has been dealt with." : "No alerts here."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.alerts.map((a) => (
              <AlertCard key={a.id} alert={a} onChanged={reload} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------- one alert ---------- */

function AlertCard({ alert: a, onChanged }: { alert: AlertItem; onChanged: () => void }) {
  const kind = KIND[a.kind] ?? KIND.other;
  const whatToDo = typeof a.detail.whatToDo === "string" ? a.detail.whatToDo : null;
  const fields = Object.entries(a.detail).filter(([k]) => !HIDDEN.has(k));
  const cameBack = a.status === "open" && a.resolvedAt !== null && a.resolvedAt < a.lastAt;

  return (
    <li
      className={`rounded-xl border p-4 shadow-card sm:p-5 ${
        a.status === "open" && a.active ? FLAG_TONE.danger.banner : "border-border bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${kind.chip}`}>
              {kind.label}
            </span>
            {a.status === "open" && a.active && (
              <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${FLAG_TONE.danger.chip}`}>
                Happening now
              </span>
            )}
            {a.status === "resolved" && (
              <span className="rounded-sm bg-yes-tint px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-yes">
                Settled
              </span>
            )}
          </p>
          <h2 className="mt-1.5 text-base font-semibold">{a.subject}</h2>
          <p className="mt-0.5 text-xs text-tertiary">
            Seen {a.count.toLocaleString("en-US")} time{a.count === 1 ? "" : "s"} · first {when(a.firstAt)} · last{" "}
            {when(a.lastAt)}
          </p>
        </div>
      </div>

      {cameBack && (
        <p className={`mt-2 rounded-md px-2.5 py-1.5 text-xs font-semibold ${FLAG_TONE.caution.chip}`}>
          Came back after {a.resolvedBy || "someone"} settled it on {when(a.resolvedAt!)}
          {a.note ? ` (“${a.note}”)` : ""}.
        </p>
      )}

      {fields.length > 0 && (
        <dl className="mt-3 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[max-content_1fr]">
          {fields.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-tertiary">{label(k)}</dt>
              <dd className="min-w-0 break-words text-primary">{show(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      {whatToDo && (
        <p className="mt-3 rounded-md bg-element-2 px-3 py-2 text-[13px] text-primary">
          <span className="font-semibold">What to do: </span>
          {whatToDo}
        </p>
      )}

      {a.status === "open" ? (
        <Fixes alert={a} onChanged={onChanged} />
      ) : (
        <p className="mt-3 text-xs text-tertiary">
          Settled by {a.resolvedBy || "—"}
          {a.resolvedAt ? ` · ${when(a.resolvedAt)}` : ""}
          {a.note ? ` · “${a.note}”` : ""}
        </p>
      )}
    </li>
  );
}

/** The fix for this kind of alert, then "Mark settled". */
function Fixes({ alert: a, onChanged }: { alert: AlertItem; onChanged: () => void }) {
  const [step, setStep] = useState<"idle" | "void" | "settle">("idle");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canVoid = a.kind === "risk" && a.eventId !== "" && a.marketId !== "";

  const close = () => {
    setStep("idle");
    setText("");
    setError(null);
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (step === "void") {
        const res = await voidMarket({ eventId: a.eventId, marketId: a.marketId, reason: text.trim() });
        showToast(
          `Market voided — ${res.positionsSettled} bet${res.positionsSettled === 1 ? "" : "s"} refunded`,
          "success",
        );
      } else {
        await settleAlert(a.id, text.trim());
        showToast("Alert settled", "success");
      }
      close();
      onChanged();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Request failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const link = (href: string, label: string) => (
    <Link
      href={href}
      className="inline-flex h-9 items-center rounded-sm border border-border px-3 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
    >
      {label}
    </Link>
  );

  if (step !== "idle") {
    const voiding = step === "void";
    return (
      <div className="mt-3 rounded-md border border-border bg-surface p-3">
        <p className="text-sm font-semibold">
          {voiding
            ? "Void this market? Every open bet on it is refunded and it takes no more bets. This can't be undone."
            : "Mark this alert settled? It opens again if the problem comes back."}
        </p>
        <label className="mt-2 block">
          <span className="text-xs font-medium text-secondary">
            {voiding ? "Reason (kept on the settlement record)" : "Note (optional) — what you did"}
          </span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={voiding ? 500 : 500}
            placeholder={voiding ? "e.g. Too much money on one side; result visible before close" : "e.g. Repriced the market"}
            className="mt-1 h-9 w-full rounded-md border border-border bg-sunken px-3 text-sm outline-none placeholder:text-tertiary focus:border-accent"
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={run}
            disabled={busy || (voiding && text.trim().length < 3)}
            className={`pressable h-9 rounded-sm px-4 text-sm font-semibold disabled:opacity-40 ${
              voiding ? "bg-no-solid text-white" : "bg-accent text-on-accent hover:bg-accent-hover"
            }`}
          >
            {busy ? "Saving…" : voiding ? "Yes, void it" : "Mark settled"}
          </button>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-secondary hover:text-primary"
          >
            Cancel
          </button>
        </div>
        {error && <p className="mt-2 text-sm font-semibold text-no">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {canVoid && (
        <button
          type="button"
          onClick={() => setStep("void")}
          className="inline-flex h-9 items-center rounded-sm border border-no/40 px-3 text-sm font-semibold text-no hover:bg-no-tint"
        >
          Void this market…
        </button>
      )}
      {a.kind === "risk" && link("/admin", "Risk on the Local book")}
      {a.kind === "risk" && link("/admin/settings", "Loss limits in Settings")}
      {a.kind === "settlement" && link("/admin", "Settle it on the Local book")}
      {a.kind === "withdrawal" && link("/admin/abuse", "Withdrawals to confirm")}
      {a.kind === "abuse" && link("/admin/abuse", "Review on Abuse watch")}
      <button
        type="button"
        onClick={() => setStep("settle")}
        className="pressable inline-flex h-9 items-center rounded-sm bg-accent px-3 text-sm font-semibold text-on-accent hover:bg-accent-hover"
      >
        Mark settled…
      </button>
    </div>
  );
}

/* ---------- bits ---------- */

function Waiting({ href, n, what, where }: { href: string; n: number; what: string; where: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${FLAG_TONE.caution.banner}`}
    >
      {n} {what}
      {n === 1 ? "" : "s"} waiting
      <span className="text-secondary">→ {where}</span>
    </Link>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl rounded-xl border border-border bg-surface p-6 text-sm leading-6 text-secondary shadow-card">
      {children}
    </div>
  );
}

/** "worstCase" → "Worst case", "profitLast7Days" → "Profit last 7 days". */
function label(key: string): string {
  const spaced = key
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
