"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowPathIcon as RefreshCw,
  CheckCircleIcon as Check,
} from "@heroicons/react/24/outline";
import { ApiError, isApiConfigured } from "@/lib/api-client";
import {
  fetchAlerts,
  fetchSettlementQueue,
  settleAlert,
  voidMarket,
  type AlertItem,
  type AlertKind,
  type AlertPerson,
  type AlertsView,
  type QueueEvent,
  type SettlementQueue,
} from "@/lib/admin-api";
import { useAdminMoney } from "@/lib/admin-money";
import { showToast } from "@/lib/toast-store";
import { AccountControl } from "@/components/admin/account-control";
import { BookOverview } from "@/components/admin/book-overview";
import { BookRiskStrip } from "@/components/admin/book-risk";
import { ATTENTION, MarketRow } from "@/components/admin/local-desk";
import { FLAG_TONE } from "@/components/admin/risk-flags";

/**
 * Today: the desk's one inbox. The owner's headline numbers on top
 * (BookOverview), then what needs doing now as a to-do list, each with the
 * action on the card, then the old alerts that are already over, cleared
 * in one go, then how the book stands (BookRiskStrip).
 *
 *  - Markets to pay out: one card per event (not per alert), with its
 *    unpaid bets and the settle or refund controls right there. Settling
 *    closes the event's alerts. An event whose bets are all paid is old.
 *    The settlement queue's flagged events come in too, alert or not
 *    (resolved but unsettled, overdue, cancelled, unmatched, unreachable),
 *    so nothing that needs settling is missing; every other open market
 *    waits under Markets, All open.
 *  - Customers to check: who, why in one line, and suspend or clear.
 *  - Money at risk: only while it's still happening.
 *  - Old alerts: anything that has stopped and needs no action.
 *
 * The emails carry the same kinds (KIND_NOTE, services/api/src/alerts.ts).
 */

const DAY_MS = 86_400_000;

/** Details shown in their own words on a card, or ids nobody reads. */
const HIDDEN = new Set(["whatToDo", "alsoSeen", "eventId", "marketId"]);

const KIND_LABEL: Record<AlertKind, string> = {
  risk: "Money at risk",
  abuse: "Suspicious customer",
  fault: "System fault",
  settlement: "Market to settle",
  withdrawal: "Withdrawal waiting",
  test: "Test",
  other: "Other",
};

export function TodayDesk() {
  const [showCleared, setShowCleared] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    alerts: AlertsView | null;
    queue: SettlementQueue | null;
    error: string | null;
    errorCode: string | null;
  } | null>(null);
  const configured = isApiConfigured();
  const key = `${showCleared}|${reloads}`;

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    Promise.all([
      fetchAlerts(showCleared ? "resolved" : "open"),
      // which markets still have unpaid bets; the list still works without it
      showCleared ? Promise.resolve(null) : fetchSettlementQueue().catch(() => null),
    ])
      .then(([alerts, queue]) => {
        if (!cancelled) setLoaded({ key, alerts, queue, error: null, errorCode: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoaded({
          key,
          alerts: null,
          queue: null,
          error: err instanceof Error ? err.message : "Request failed",
          errorCode: err instanceof ApiError ? err.code : null,
        });
      });
    return () => {
      cancelled = true;
    };
    // key encodes every input to the requests above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, key]);

  if (!configured) return <Notice>This desk needs the prediction API (NEXT_PUBLIC_API_URL).</Notice>;
  const fresh = loaded?.key === key ? loaded : null;
  if (fresh?.errorCode === "FORBIDDEN") return <Notice>Your account isn&rsquo;t an admin of the Local book.</Notice>;
  if (fresh?.errorCode === "NOT_FOUND") {
    return <Notice>The API answering is older than this page — redeploy the API.</Notice>;
  }
  const data = fresh?.alerts ?? null;
  const queue = fresh?.queue ?? null;
  const reload = () => setReloads((n) => n + 1);

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="mt-1 text-sm text-secondary">
            {showCleared
              ? "Alerts you've already cleared."
              : "What needs you now, with the action on each card, and how the book stands."}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowCleared(!showCleared)}
            className="flex h-9 items-center rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
          >
            {showCleared ? "Back to the to-do list" : "Show cleared alerts"}
          </button>
          <button
            type="button"
            onClick={reload}
            className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
          >
            <RefreshCw className={`size-3.5 ${fresh === null ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      <BookOverview reloadKey={reloads} />

      {fresh?.error && <p className="mt-4 text-sm font-semibold text-no">Couldn&rsquo;t load: {fresh.error}</p>}
      {!data ? (
        <div className="mt-4 flex flex-col gap-2" aria-busy="true" aria-label="Loading alerts">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-element-2" />
          ))}
        </div>
      ) : showCleared ? (
        <ClearedList alerts={data.alerts} />
      ) : (
        <ToDo data={data} queue={queue} reloadKey={reloads} onChanged={reload} />
      )}
    </div>
  );
}

/* ---------- the to-do list ---------- */

interface MarketTask {
  eventId: string;
  title: string;
  alerts: AlertItem[];
  queued: QueueEvent | null;
}

function ToDo({
  data,
  queue,
  reloadKey,
  onChanged,
}: {
  data: AlertsView;
  queue: SettlementQueue | null;
  reloadKey: number;
  onChanged: () => void;
}) {
  // a queue that loaded in full says which events still owe customers money
  const queueComplete = queue !== null && !queue.truncated;
  const queuedById = new Map((queue?.events ?? []).map((e) => [e.eventId, e]));

  const markets = new Map<string, MarketTask>();
  const customers: AlertItem[] = [];
  const risks: AlertItem[] = [];
  const old: AlertItem[] = [];
  for (const a of data.alerts) {
    if (a.kind === "settlement" && a.eventId) {
      const queued = queuedById.get(a.eventId) ?? null;
      if (!queued && queueComplete) {
        old.push(a); // nothing left to pay on it
        continue;
      }
      const task = markets.get(a.eventId) ?? {
        eventId: a.eventId,
        title: queued?.eventTitle || text(a.detail.eventTitle) || a.subject,
        alerts: [],
        queued,
      };
      task.alerts.push(a);
      markets.set(a.eventId, task);
    } else if (a.kind === "abuse" || a.kind === "fault") customers.push(a);
    else if (a.kind === "risk" && a.active) risks.push(a);
    else if (a.kind === "withdrawal" && data.waiting.withdrawals > 0) continue; // the banner below covers them
    else old.push(a);
  }
  // the queue's flagged events with no alert of their own need settling
  // just the same: this list is the old "Needs action" queue too
  for (const e of queue?.events ?? []) {
    if (e.attention !== null && !markets.has(e.eventId)) {
      markets.set(e.eventId, { eventId: e.eventId, title: e.eventTitle || e.eventId, alerts: [], queued: e });
    }
  }
  const marketTasks = [...markets.values()];
  const todo = marketTasks.length + customers.length + risks.length;

  return (
    <>
      <p className="mt-4 text-sm font-semibold">
        {todo === 0
          ? "Nothing needs you right now."
          : [
              marketTasks.length && `${marketTasks.length} market${marketTasks.length === 1 ? "" : "s"} to pay out`,
              customers.length && `${customers.length} customer${customers.length === 1 ? "" : "s"} to check`,
              risks.length && `${risks.length} money risk${risks.length === 1 ? "" : "s"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
        {old.length > 0 && <span className="font-normal text-secondary"> · {old.length} old alerts to clear</span>}
      </p>

      {(data.waiting.support > 0 || data.waiting.withdrawals > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {data.waiting.withdrawals > 0 && (
            <Waiting href="/admin/money" n={data.waiting.withdrawals} what="withdrawal" where="Withdrawals" />
          )}
          {data.waiting.support > 0 && (
            <Waiting href="/admin/customers/support" n={data.waiting.support} what="support request" where="Support" />
          )}
        </div>
      )}

      {marketTasks.length > 0 && (
        <Section title="Pay out these markets" hint="These ended, but their bets haven't been paid yet. Customers are waiting.">
          {marketTasks.map((t) => (
            <MarketCard key={t.eventId} task={t} onChanged={onChanged} />
          ))}
        </Section>
      )}

      {customers.length > 0 && (
        <Section title="Check these customers" hint="While each one is open, that customer's withdrawals wait for your approval.">
          {customers.map((a) => (
            <CustomerCard key={a.id} alert={a} onChanged={onChanged} />
          ))}
        </Section>
      )}

      {risks.length > 0 && (
        <Section title="Money at risk right now" hint="Nobody did anything wrong. We could lose a lot if these bets win.">
          {risks.map((a) => (
            <RiskCard key={a.id} alert={a} onChanged={onChanged} />
          ))}
        </Section>
      )}

      {todo === 0 && (
        <p className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-border bg-surface py-10 text-center text-sm text-secondary shadow-card">
          <Check className="size-6 text-yes" aria-hidden />
          All done. New problems will show up here.
        </p>
      )}

      {old.length > 0 && <OldAlerts alerts={old} onChanged={onChanged} />}

      <h2 className="mt-8 text-base font-semibold">The book right now</h2>
      <BookRiskStrip reloadKey={reloadKey} />
    </>
  );
}

/* ---------- markets ---------- */

function MarketCard({ task, onChanged }: { task: MarketTask; onChanged: () => void }) {
  const money = useAdminMoney();
  // read once, when the card appears, so rendering stays pure
  const [now] = useState(() => Date.now());
  const q = task.queued;
  const ended = endedAt(task);
  const days = ended ? Math.floor((now - ended.getTime()) / DAY_MS) : null;
  const unmatched = task.alerts.find((a) => a.subject.startsWith("Resolved market with unmatchable outcome"));
  const sourceSaid = unmatched ? text(unmatched.detail.resolvedOutcome) : "";
  // the queue's own reason, on every flagged event (the only one when no alert came)
  const flag = q?.attention ? ATTENTION[q.attention] : null;

  const closeAlerts = async () => {
    await Promise.all(task.alerts.map((a) => settleAlert(a.id, "Market settled").catch(() => undefined)));
    onChanged();
  };

  return (
    <li className="rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{task.title}</h3>
        {flag && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${flag.className}`}>{flag.label}</span>
        )}
      </div>
      <p className="mt-0.5 text-sm text-secondary">
        {ended ? `Ended ${day(ended)}` : "Ended"}
        {days !== null && days >= 1 && <b className={days >= 3 ? "text-no" : "text-primary"}> · waiting {days} day{days === 1 ? "" : "s"}</b>}
        {q && ` · ${q.openPositions} bet${q.openPositions === 1 ? "" : "s"} (${money.format(q.openStakeKobo)}) not paid yet`}
      </p>
      {q?.attention === "bayse_unreachable" && (
        <p className={`mt-2 rounded-md px-3 py-2 text-sm font-semibold ${FLAG_TONE.caution.chip}`}>
          We couldn&rsquo;t reach Bayse to check this one. Look up the result on Bayse yourself before settling.
        </p>
      )}
      {sourceSaid && (
        <p className={`mt-2 rounded-md px-3 py-2 text-sm font-semibold ${FLAG_TONE.caution.chip}`}>
          Our data source called it &ldquo;{sourceSaid}&rdquo;, which isn&rsquo;t one of the answers. If there was no clear
          winner, press Void to refund everyone.
        </p>
      )}
      <p className="mt-2 text-sm text-primary">
        <b>What to do:</b> check who really won, pick them and press <b>Settle</b> to pay the winners. Or press{" "}
        <b>Void</b> to refund everyone. Both are final.
      </p>
      {q ? (
        <div className="mt-3 flex flex-col gap-2">
          {q.markets.map((m) => (
            <MarketRow key={m.marketId} eventId={task.eventId} market={m} onDone={() => void closeAlerts()} />
          ))}
        </div>
      ) : (
        <Link
          href="/admin/markets/open"
          className="mt-3 inline-flex h-9 items-center rounded-sm border border-border px-3 text-sm font-semibold text-secondary hover:text-primary"
        >
          Settle it in All open markets
        </Link>
      )}
    </li>
  );
}

/** When the market ended: its resolution date, or when it was first reported. */
function endedAt(task: MarketTask): Date | null {
  const raw =
    task.queued?.resolutionDate ||
    task.alerts.map((a) => text(a.detail.resolutionDate)).find(Boolean) ||
    task.alerts[0]?.firstAt;
  const d = raw ? new Date(raw) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/* ---------- customers ---------- */

function CustomerCard({ alert: a, onChanged }: { alert: AlertItem; onChanged: () => void }) {
  const [suspending, setSuspending] = useState<string | null>(null);
  const people = a.people ?? [];
  const fault = a.kind === "fault";
  const why = [text(a.detail.record), text(a.detail.gap)].filter(Boolean).join(". ");
  const profit = text(a.detail.theirProfit);
  const mostlyOn = text(a.detail.mostlyOn);
  const target: AlertPerson | undefined = people.find((p) => p.authUserId === suspending);

  return (
    <li className={`rounded-xl border p-4 shadow-card sm:p-5 ${fault ? "border-border bg-surface" : FLAG_TONE.danger.banner}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold">
          {people.length > 0 ? people.map((p) => p.displayName || p.username).join(" and ") : a.subject}
        </h3>
        <span className="text-xs text-tertiary">Flagged {day(new Date(a.firstAt))}</span>
      </div>
      <p className="mt-1 text-sm font-semibold text-primary">{plainWhy(a)}</p>
      {(why || profit) && (
        <p className="mt-0.5 text-sm text-secondary">
          {why}
          {profit && `${why ? ". " : ""}Their profit: ${profit}.`}
        </p>
      )}
      {mostlyOn && <p className="mt-0.5 text-xs text-tertiary">Mostly on: {mostlyOn}</p>}

      <p className="mt-2 text-sm text-primary">
        <b>What to do:</b>{" "}
        {fault
          ? "tell the developers. It isn't the customer's doing, so don't suspend them. Clear it once it's fixed."
          : "check their bets. If they bet on results already known, lock their withdrawals (they can keep betting) or suspend them fully. If they're fine, clear it, which releases their withdrawals."}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {!fault &&
          people.map((p) =>
            p.suspendedAt ? (
              <span
                key={p.authUserId}
                className={`inline-flex h-9 items-center rounded-sm px-3 text-xs font-bold uppercase ${FLAG_TONE.danger.chip}`}
              >
                @{p.username} is suspended
              </span>
            ) : (
              <button
                key={p.authUserId}
                type="button"
                onClick={() => setSuspending(suspending === p.authUserId ? null : p.authUserId)}
                className="inline-flex h-9 items-center rounded-sm border border-no/40 px-3 text-sm font-semibold text-no hover:bg-no-tint"
              >
                {p.withdrawalsLockedAt
                  ? `@${p.username}'s withdrawals are locked…`
                  : people.length > 1
                    ? `Lock or suspend @${p.username}…`
                    : "Lock withdrawals or suspend…"}
              </button>
            ),
          )}
        {people.map((p) => (
          <Link
            key={p.authUserId}
            href={`/admin/customers?search=${encodeURIComponent(p.username)}`}
            className="inline-flex h-9 items-center rounded-sm border border-border px-3 text-sm font-semibold text-secondary hover:text-primary"
          >
            {people.length > 1 ? `See @${p.username}'s bets` : "See their bets"}
          </Link>
        ))}
        <ClearButton alert={a} label={fault ? "Fixed, clear it" : "They're fine, clear it"} onChanged={onChanged} />
      </div>
      {target && (
        <div className="mt-3">
          <AccountControl trader={target} actions={undefined} onChanged={onChanged} />
        </div>
      )}
    </li>
  );
}

/** One plain sentence: what the system thinks happened. */
function plainWhy(a: AlertItem): string {
  if (a.kind === "fault") return "Their balance doesn't match our records. This is a fault on our side.";
  if (a.subject.startsWith("Winning more than the odds")) return "They're winning far more often than luck allows.";
  if (a.subject.startsWith("Buying near-certain")) return "They keep buying results that were already nearly decided.";
  if (a.subject.startsWith("Accounts moving in a pair")) return "These accounts bet the same way at the same time, possibly one person.";
  return a.subject;
}

/* ---------- money at risk ---------- */

function RiskCard({ alert: a, onChanged }: { alert: AlertItem; onChanged: () => void }) {
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const fields = Object.entries(a.detail).filter(([k]) => !HIDDEN.has(k));
  const canVoid = a.eventId !== "" && a.marketId !== "";

  const voidIt = async () => {
    setBusy(true);
    try {
      const res = await voidMarket({ eventId: a.eventId, marketId: a.marketId, reason: reason.trim() });
      showToast(`Market voided, ${res.positionsSettled ?? 0} bets refunded`, "success");
      await settleAlert(a.id, "Market voided").catch(() => undefined);
      onChanged();
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : "Request failed. Try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`rounded-xl border p-4 shadow-card sm:p-5 ${FLAG_TONE.danger.banner}`}>
      <h3 className="text-base font-semibold">{a.subject}</h3>
      {fields.length > 0 && (
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[max-content_1fr]">
          {fields.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-tertiary">{label(k)}</dt>
              <dd className="min-w-0 break-words text-primary">{show(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-2 text-sm text-primary">
        <b>What to do:</b> {text(a.detail.whatToDo) || "look at the riskiest markets under The book right now, below."}
      </p>
      {voiding ? (
        <div className="mt-3 rounded-md border border-border bg-surface p-3">
          <p className="text-sm font-semibold">Void this market? Every open bet on it is refunded. This can&rsquo;t be undone.</p>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Reason, e.g. too much money on one side"
            className="mt-2 h-9 w-full rounded-md border border-border bg-sunken px-3 text-sm outline-none placeholder:text-tertiary focus:border-accent"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={voidIt}
              disabled={busy || reason.trim().length < 3}
              className="pressable h-9 rounded-sm bg-no-solid px-4 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Voiding…" : "Yes, void it"}
            </button>
            <button
              type="button"
              onClick={() => setVoiding(false)}
              className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {canVoid && (
            <button
              type="button"
              onClick={() => setVoiding(true)}
              className="inline-flex h-9 items-center rounded-sm border border-no/40 px-3 text-sm font-semibold text-no hover:bg-no-tint"
            >
              Void this market…
            </button>
          )}
          <Link
            href="/admin/settings"
            className="inline-flex h-9 items-center rounded-sm border border-border px-3 text-sm font-semibold text-secondary hover:text-primary"
          >
            Loss limits in Settings
          </Link>
          <ClearButton alert={a} label="Dealt with, clear it" onChanged={onChanged} />
        </div>
      )}
    </li>
  );
}

/* ---------- old alerts ---------- */

function OldAlerts({ alerts, onChanged }: { alerts: AlertItem[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const clearAll = async () => {
    setBusy(true);
    let cleared = 0;
    for (const a of alerts) {
      try {
        await settleAlert(a.id, "Cleared with the other old alerts");
        cleared += 1;
      } catch {
        // already cleared elsewhere, or failed: the refresh shows what's left
      }
    }
    showToast(`${cleared} old alert${cleared === 1 ? "" : "s"} cleared`, "success");
    setBusy(false);
    setConfirming(false);
    onChanged();
  };

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Old alerts, already over</h2>
          <p className="mt-0.5 text-sm text-secondary">Nothing to do on these. Clearing them only tidies this list and moves no money.</p>
        </div>
        {confirming ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={clearAll}
              disabled={busy}
              className="pressable h-9 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? "Clearing…" : `Yes, clear all ${alerts.length}`}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-secondary"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="pressable h-9 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover"
          >
            Clear all {alerts.length}
          </button>
        )}
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-border">
        {alerts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0">
              <span className="text-xs font-semibold uppercase tracking-wide text-tertiary">{KIND_LABEL[a.kind] ?? "Other"}</span>
              <span className="block">{text(a.detail.eventTitle) || a.subject}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="text-xs text-tertiary">last {day(new Date(a.lastAt))}</span>
              <ClearButton alert={a} label="Clear" onChanged={onChanged} small />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClearedList({ alerts }: { alerts: AlertItem[] }) {
  if (alerts.length === 0) {
    return (
      <p className="mt-4 rounded-xl border border-border bg-surface py-10 text-center text-sm text-secondary shadow-card">
        Nothing cleared yet.
      </p>
    );
  }
  return (
    <ul className="mt-4 flex flex-col divide-y divide-border rounded-xl border border-border bg-surface px-4 shadow-card">
      {alerts.map((a) => (
        <li key={a.id} className="py-3 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-tertiary">{KIND_LABEL[a.kind] ?? "Other"}</span>
          <span className="block font-semibold">{text(a.detail.eventTitle) || a.subject}</span>
          <span className="text-xs text-tertiary">
            Cleared by {a.resolvedBy || "—"}
            {a.resolvedAt ? ` · ${day(new Date(a.resolvedAt))}` : ""}
            {a.note ? ` · ${a.note}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- bits ---------- */

function ClearButton({
  alert: a,
  label: text,
  onChanged,
  small,
}: {
  alert: AlertItem;
  label: string;
  onChanged: () => void;
  small?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const clear = async () => {
    setBusy(true);
    try {
      await settleAlert(a.id, "");
      showToast("Cleared", "success");
      onChanged();
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : "Request failed. Try again.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={clear}
      disabled={busy}
      className={`inline-flex items-center rounded-sm border border-border font-semibold text-secondary hover:border-border-hover hover:text-primary disabled:opacity-40 ${
        small ? "h-8 px-3 text-xs" : "h-9 px-3 text-sm"
      }`}
    >
      {busy ? "Clearing…" : text}
    </button>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-0.5 text-sm text-secondary">{hint}</p>
      <ul className="mt-3 flex flex-col gap-3">{children}</ul>
    </section>
  );
}

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

function text(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
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

function day(d: Date): string {
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
