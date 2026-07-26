"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Loader2,
  Mail,
  RefreshCw,
} from "lucide-react";
import { CREDIT, formatNaira } from "@/lib/format";
import { ApiError, isApiConfigured } from "@/lib/api-client";
import {
  fetchSettlementQueue,
  fetchSettlements,
  sendTestAlert,
  setFxRate,
  settleMarket,
  useAdminResource,
  voidMarket,
  type AlertTestResult,
  type Attention,
  type FxQuote,
  type QueueEvent,
  type QueueMarket,
} from "@/lib/admin-api";
import { useNairaWallet } from "@/lib/naira-wallet";

/**
 * The Local (naira) book's operating desk. Two jobs:
 *
 *  - the FX rate, which nothing else can set and without which the
 *    whole book is inert (no rate → conversions 503 → nobody can fund)
 *  - settlement, for both origins of market. On the Bayse half the
 *    poller has already handled the easy cases and what's left is
 *    exceptions: resolved-but-unsettled, a winning label Bayse's own
 *    outcomes don't match, overdue, or unreachable. On our own markets
 *    there is no poller to defer to — this desk IS the oracle, and
 *    every one of them ends up here.
 *
 * Writing those markets is the Markets desk next door; this one only
 * ever finishes them.
 *
 * Settling pays out every open position on the market, so both actions
 * ask for confirmation and neither is undoable.
 */
export function LocalDesk() {
  const queue = useAdminResource(fetchSettlementQueue, true);
  const settlements = useAdminResource(fetchSettlements, true);

  if (!isApiConfigured()) {
    return (
      <Notice>
        This desk needs the prediction API. Set{" "}
        <code className="font-mono text-[13px]">NEXT_PUBLIC_API_URL</code> and
        rebuild.
      </Notice>
    );
  }

  // 403 means a signed-in non-admin, not a broken page.
  if (queue.errorCode === "FORBIDDEN" || settlements.errorCode === "FORBIDDEN") {
    return (
      <Notice>
        Your account isn&rsquo;t an admin of the Local book. Ask for the{" "}
        <code className="font-mono text-[13px]">admin</code> role on your
        central WorldStreet account.
      </Notice>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Local book</h1>
          <p className="mt-1 text-sm text-secondary">
            Credit markets, ours and Bayse&rsquo;s, settled by us.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TestAlertButton />
          <button
            onClick={() => {
              queue.refresh();
              settlements.refresh();
            }}
            className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
          >
            <RefreshCw
              className={`size-3.5 ${queue.loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>
      </div>

      <FxCard />

      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold">Settlement queue</h2>
          {queue.data && (
            <p className="text-[13px] font-medium text-tertiary">
              {queue.data.events.length} event
              {queue.data.events.length === 1 ? "" : "s"} with open positions
              {queue.data.truncated && " (capped)"}
            </p>
          )}
        </div>

        {queue.error && (
          <p className="mt-3 text-sm font-semibold text-no">{queue.error}</p>
        )}
        {queue.loading && !queue.data && (
          <p className="py-8 text-center text-sm text-secondary">Loading…</p>
        )}
        {queue.data?.events.length === 0 && (
          <p className="py-8 text-center text-sm text-secondary">
            Nothing open. Every stake has been settled.
          </p>
        )}

        <div className="mt-3 flex flex-col gap-3">
          {queue.data?.events.map((event) => (
            <QueueCard
              key={event.eventId}
              event={event}
              overdueHours={queue.data!.overdueHours}
              onDone={() => {
                queue.refresh();
                settlements.refresh();
              }}
            />
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Recent settlements</h2>
        {settlements.data?.length === 0 && (
          <p className="py-8 text-center text-sm text-secondary">
            Nothing settled yet.
          </p>
        )}
        <ul className="mt-1 flex flex-col">
          {settlements.data?.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 border-b border-border py-3 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {s.voided ? "Voided" : "Settled"} ·{" "}
                  <span className="font-mono text-[13px] text-secondary">
                    {s.marketId.slice(0, 8)}
                  </span>
                </p>
                <p className="mt-0.5 text-[13px] font-medium text-tertiary">
                  {s.source === "admin" ? `By ${s.actor}` : "Auto"} ·{" "}
                  {s.positionsSettled} position
                  {s.positionsSettled === 1 ? "" : "s"}
                  {s.createdAt && ` · ${fmtDateTime(s.createdAt)}`}
                </p>
              </div>
              <p className="text-sm font-semibold text-yes">
                {formatNaira(s.payoutTotalKobo)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/* ---------- alert delivery check ---------- */

/**
 * Alerts only fire when a market is stuck, so the mail configuration
 * would otherwise go untested until the moment it's needed. This sends
 * one through the real path and says exactly what came back — including
 * Resend's own reason when it refuses.
 */
function TestAlertButton() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AlertTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      setResult(await sendTestAlert());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {result && (
        <p
          className={`max-w-[420px] text-[13px] font-semibold ${
            result.email === "sent" ? "text-yes" : "text-no"
          }`}
        >
          {describeAlertResult(result)}
        </p>
      )}
      {error && <p className="text-[13px] font-semibold text-no">{error}</p>}
      <button
        onClick={() => void run()}
        disabled={pending}
        title="Send a test alert to the configured recipients"
        className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary disabled:opacity-40"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Mail className="size-3.5" />
        )}
        Test alert
      </button>
    </div>
  );
}

function describeAlertResult(r: AlertTestResult): string {
  if (r.email === "sent") {
    return `Sent to ${r.recipients} recipient${r.recipients === 1 ? "" : "s"} — check the inbox.`;
  }
  if (r.email === "not_configured") {
    return "No email configured on the API (RESEND_API_KEY, ALERT_EMAIL_FROM, ALERT_EMAIL_TO).";
  }
  return `Resend refused it — ${r.emailError ?? "see the API logs"}`;
}

/* ---------- FX rate ---------- */

function FxCard() {
  // the public wallet endpoint carries the quote, and the desk needs no
  // more privilege than a user to read it
  const { fx } = useNairaWallet(true);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<FxQuote | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = saved ?? fx;
  const parsed = parseFloat(draft);
  const valid = Number.isFinite(parsed) && parsed >= 1;

  const save = async () => {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      setSaved(await setFxRate(parsed));
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set the rate");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Conversion rate</h2>
          <p className="mt-0.5 text-sm text-secondary">
            The mid rate for dollar↔credit funding. Until one is set, nobody
            can fund a credit balance.
          </p>
        </div>
        {current && (
          <p className="text-[13px] font-medium text-tertiary">
            Set {fmtDateTime(current.asOf)}
          </p>
        )}
      </div>

      {current ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Mid" value={`${CREDIT}${current.mid.toFixed(2)}`} />
          <Stat
            label="Users buy credit at"
            value={`${CREDIT}${current.usdToNgn.toFixed(2)}`}
          />
          <Stat
            label="Users sell credit at"
            value={`${CREDIT}${current.ngnToUsd.toFixed(2)}`}
          />
        </div>
      ) : (
        <p className="mt-4 flex items-center gap-2 rounded-md bg-no-tint px-3 py-2.5 text-sm font-semibold text-no">
          <AlertTriangle className="size-4 shrink-0" />
          No rate set — the Local book can&rsquo;t be funded.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor="fx-rate" className="text-sm font-semibold">
          New mid rate
        </label>
        <div className="flex h-10 items-center gap-1 rounded-md border border-border bg-page px-3">
          <span className="text-sm font-semibold text-tertiary">{CREDIT}</span>
          <input
            id="fx-rate"
            inputMode="decimal"
            value={draft}
            placeholder={current ? current.mid.toFixed(2) : "1500"}
            onChange={(e) => {
              setDraft(e.target.value.replace(/[^0-9.]/g, "").slice(0, 10));
              setError(null);
            }}
            className="w-28 bg-transparent text-sm font-semibold outline-none placeholder:text-tertiary"
          />
          <span className="text-sm font-medium text-tertiary">per $1</span>
        </div>
        <button
          disabled={!valid || pending}
          onClick={() => void save()}
          className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Set rate
        </button>
        {current && (
          <p className="text-[13px] font-medium text-tertiary">
            {(current.spreadBps / 100).toFixed(2)}% spread each way
          </p>
        )}
      </div>

      {error && <p className="mt-3 text-sm font-semibold text-no">{error}</p>}
      {saved && !error && (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-yes">
          <CheckCircle2 className="size-4" />
          Rate updated.
        </p>
      )}
    </section>
  );
}

/* ---------- settlement queue ---------- */

const ATTENTION: Record<
  NonNullable<Attention>,
  { label: string; className: string }
> = {
  resolved_unsettled: {
    label: "Resolved upstream — settle",
    className: "bg-yes-tint text-yes",
  },
  unmatched_outcome: {
    label: "Winner doesn't match an outcome",
    className: "bg-no-tint text-no",
  },
  cancelled: { label: "Cancelled — void", className: "bg-no-tint text-no" },
  overdue: { label: "Overdue", className: "bg-accent/10 text-accent" },
  bayse_unreachable: {
    label: "Bayse unreachable",
    className: "bg-element-2 text-secondary",
  },
};

function QueueCard({
  event,
  overdueHours,
  onDone,
}: {
  event: QueueEvent;
  overdueHours: number;
  onDone: () => void;
}) {
  const flag = event.attention ? ATTENTION[event.attention] : null;

  return (
    <article className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/local/${event.eventSlug}`}
              className="truncate text-[15px] font-semibold hover:underline"
            >
              {event.eventTitle || event.eventId}
            </Link>
            {event.origin && (
              <span className="shrink-0 rounded-full bg-element-2 px-2 py-0.5 text-[11px] font-semibold text-secondary">
                {event.origin === "worldstreet" ? "Ours" : "Bayse"}
              </span>
            )}
            {flag && (
              <span
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${flag.className}`}
              >
                {event.attention === "bayse_unreachable" && (
                  <CloudOff className="size-3" />
                )}
                {flag.label}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[13px] font-medium text-tertiary">
            {event.openPositions} open position
            {event.openPositions === 1 ? "" : "s"} ·{" "}
            {formatNaira(event.openStakeKobo)} staked · pays up to{" "}
            {formatNaira(event.maxPayoutKobo)}
            {event.resolutionDate && ` · resolves ${fmtDateTime(event.resolutionDate)}`}
            {event.attention === "overdue" && ` (over ${overdueHours}h ago)`}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
        {event.markets.map((market) => (
          <MarketRow
            key={market.marketId}
            eventId={event.eventId}
            market={market}
            onDone={onDone}
          />
        ))}
      </div>
    </article>
  );
}

function MarketRow({
  eventId,
  market,
  onDone,
}: {
  eventId: string;
  market: QueueMarket;
  onDone: () => void;
}) {
  // The source's own winner is preselected when it matched an outcome;
  // the desk can override it, which is the whole point of manual
  // settlement. On our own markets there is nothing to preselect.
  const [choice, setChoice] = useState(market.winnerOutcomeId ?? "");
  const [pending, setPending] = useState<"settle" | "void" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const run = async (action: "settle" | "void") => {
    if (pending) return;
    const stake = formatNaira(market.openStakeKobo);
    const confirmed = window.confirm(
      action === "settle"
        ? `Settle "${market.marketTitle}" as ${
            market.outcomes.find((o) => o.id === choice)?.label ?? "?"
          }?\n\nThis pays out all ${market.openPositions} open position(s) and can't be undone.`
        : `Void "${market.marketTitle}"?\n\nAll ${market.openPositions} open position(s) are refunded (${stake}) and this can't be undone.`,
    );
    if (!confirmed) return;

    let reason = "";
    if (action === "void") {
      reason = window.prompt("Reason for voiding (kept in the audit trail):") ?? "";
      if (reason.trim().length < 3) {
        setError("A reason of at least 3 characters is required to void.");
        return;
      }
    }

    setPending(action);
    setError(null);
    try {
      const res =
        action === "settle"
          ? await settleMarket({ eventId, marketId: market.marketId, winningOutcomeId: choice })
          : await voidMarket({ eventId, marketId: market.marketId, reason: reason.trim() });
      setResult(
        `${action === "settle" ? "Settled" : "Voided"} ${
          res.positionsSettled ?? 0
        } position(s)${
          res.payoutTotalKobo ? `, paid ${formatNaira(res.payoutTotalKobo)}` : ""
        }`,
      );
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "ALREADY_SETTLED"
          ? "Already settled — the poller likely got there first."
          : err instanceof Error
            ? err.message
            : "Action failed",
      );
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-element-2 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{market.marketTitle}</p>
        <p className="mt-0.5 text-[13px] font-medium text-tertiary">
          {market.openPositions} open · {formatNaira(market.openStakeKobo)} staked
          · pays up to {formatNaira(market.maxPayoutKobo)}
          {market.upstreamStatus && ` · ${market.upstreamStatus}`}
          {market.resolvedOutcomeLabel && ` → ${market.resolvedOutcomeLabel}`}
        </p>
      </div>

      {market.outcomes.length > 0 ? (
        <>
          <select
            aria-label={`Winning outcome for ${market.marketTitle}`}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className="h-9 rounded-md border border-border bg-page px-2 text-sm font-semibold"
          >
            <option value="">Winning outcome…</option>
            {market.outcomes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            disabled={!choice || pending !== null}
            onClick={() => void run("settle")}
            className="flex h-9 items-center gap-1.5 rounded-sm bg-yes-solid px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending === "settle" && <Loader2 className="size-3.5 animate-spin" />}
            Settle
          </button>
        </>
      ) : (
        <p className="text-[13px] font-medium text-tertiary">
          Outcomes unavailable — refresh once Bayse is reachable.
        </p>
      )}

      <button
        disabled={pending !== null}
        onClick={() => void run("void")}
        className="flex h-9 items-center gap-1.5 rounded-sm bg-element-3 px-3 text-sm font-semibold text-secondary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending === "void" && <Loader2 className="size-3.5 animate-spin" />}
        Void
      </button>

      {error && (
        <p className="w-full text-[13px] font-semibold text-no">{error}</p>
      )}
      {result && (
        <p className="w-full text-[13px] font-semibold text-yes">{result}</p>
      )}
    </div>
  );
}

/* ---------- bits ---------- */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-page px-3 py-2">
      <p className="text-xs font-medium text-secondary">{label}</p>
      <p className="mt-0.5 text-base font-semibold">{value}</p>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-card">
      <h1 className="text-lg font-semibold">Local book</h1>
      <p className="mt-2 text-sm text-secondary">{children}</p>
    </div>
  );
}

function fmtDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
