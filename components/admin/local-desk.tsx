"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ExclamationTriangleIcon as AlertTriangle,
  CheckCircleIcon as CheckCircle2,
  SignalSlashIcon as CloudOff,
  ArrowPathIcon as Loader2,
  EnvelopeIcon as Mail,
  ArrowPathIcon as RefreshCw,
  ChevronDownIcon as ChevronDown,
} from "@heroicons/react/24/outline";
import { bookHref } from "@/lib/book";
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
  type QueueEvent,
  type QueueMarket,
  type SettlementQueue as SettlementQueueData,
  type SettlementRecord,
} from "@/lib/admin-api";
import {
  publishAdminFx,
  refreshAdminFx,
  useAdminFx,
  useAdminMoney,
} from "@/lib/admin-money";
import { BookRiskStrip } from "@/components/admin/book-risk";
import { BookOverview } from "@/components/admin/book-overview";

/**
 * The Local (naira) book's operating desk. It opens on the owner's
 * headline numbers (BookOverview: profit or loss, money staked, paid
 * out, in play), then the open book's risk, then its two jobs:
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
 *
 * Amounts follow the desk's naira/dollar switch (useAdminMoney).
 */
export function LocalDesk() {
  const queue = useAdminResource(fetchSettlementQueue, true);
  const settlements = useAdminResource(fetchSettlements, true);
  // The overview and the risk strip read their own endpoints; settling
  // here empties part of the book, so they re-read with the rest of the desk.
  const [bookVersion, setBookVersion] = useState(0);
  const refresh = () => {
    queue.refresh();
    settlements.refresh();
    setBookVersion((v) => v + 1);
    void refreshAdminFx();
  };

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
            onClick={refresh}
            className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
          >
            <RefreshCw
              className={`size-3.5 ${queue.loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>
      </div>

      <BookOverview reloadKey={bookVersion} />

      <BookRiskStrip reloadKey={bookVersion} />

      <FxCard />

      <SettlementQueue
        queue={queue.data}
        loading={queue.loading}
        error={queue.error}
        onDone={refresh}
      />

      <RecentSettlements items={settlements.data} />
    </>
  );
}

/* ---------- settlement queue ---------- */

/** How many folded cards "All open" shows before "Show more". */
const QUEUE_PAGE = 20;

/**
 * Every event that still has open bets — most of them just waiting for
 * their result. The desk only has to act on the ones the API flags
 * (resolved but unsettled, overdue, cancelled, unmatched, unreachable),
 * so those come first under "Needs action" with their settle controls
 * open; everything else sits folded under "All open", searchable.
 */
function SettlementQueue({
  queue,
  loading,
  error,
  onDone,
}: {
  queue: SettlementQueueData | null;
  loading: boolean;
  error: string | null;
  onDone: () => void;
}) {
  const [view, setView] = useState<"action" | "all">("action");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(QUEUE_PAGE);

  const events = queue?.events ?? [];
  const needsAction = events.filter((e) => e.attention !== null);
  const term = search.trim().toLowerCase();
  // flagged first, then the order the API gives (soonest to resolve)
  const all = [...needsAction, ...events.filter((e) => e.attention === null)].filter(
    (e) => !term || (e.eventTitle || e.eventId).toLowerCase().includes(term),
  );
  const list = view === "action" ? needsAction : all.slice(0, shown);

  const tab = (key: "action" | "all", label: string, count: number) => (
    <button
      type="button"
      aria-pressed={view === key}
      onClick={() => {
        setView(key);
        setShown(QUEUE_PAGE);
      }}
      className={`h-8 rounded-sm px-3 text-[13px] font-semibold transition-colors ${
        view === key ? "bg-surface text-primary shadow-card" : "text-secondary hover:text-primary"
      }`}
    >
      {label}
      <span className="ml-1.5 tabular-nums text-tertiary">{count}</span>
    </button>
  );

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Settlement queue</h2>
          <p className="mt-0.5 text-[13px] text-secondary">
            Markets with open bets. Only the flagged ones need you.
          </p>
        </div>
        {queue && (
          <div role="group" aria-label="Queue view" className="flex rounded-md bg-element-2 p-0.5">
            {tab("action", "Needs action", needsAction.length)}
            {tab("all", "All open", events.length)}
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm font-semibold text-no">{error}</p>}
      {loading && !queue && (
        <p className="py-8 text-center text-sm text-secondary">Loading…</p>
      )}

      {queue && events.length === 0 && (
        <p className="py-8 text-center text-sm text-secondary">
          Nothing open. Every stake has been settled.
        </p>
      )}

      {queue && events.length > 0 && view === "action" && needsAction.length === 0 && (
        <div className="mt-3 flex flex-col items-start gap-2 rounded-xl border border-border bg-surface px-4 py-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm font-medium text-secondary">
            <CheckCircle2 className="size-4 shrink-0 text-yes" />
            Nothing needs you right now — {events.length} event
            {events.length === 1 ? " is" : "s are"} waiting for {events.length === 1 ? "its" : "their"} result.
          </p>
          <button
            type="button"
            onClick={() => setView("all")}
            className="shrink-0 text-sm font-semibold text-accent-ink hover:underline"
          >
            See all open
          </button>
        </div>
      )}

      {view === "all" && events.length > 0 && (
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setShown(QUEUE_PAGE);
          }}
          placeholder="Search events"
          aria-label="Search the settlement queue"
          className="mt-3 h-10 w-full rounded-md border border-border bg-surface px-3 text-sm font-medium outline-none placeholder:text-tertiary focus:border-accent sm:max-w-sm"
        />
      )}

      {/* the list scrolls inside its own box, under a screen tall, so the
          page itself stays short however many events are open */}
      <div className="mt-3 flex max-h-[70dvh] flex-col gap-3 overflow-y-auto overscroll-contain">
        {list.map((event) => (
          <QueueCard
            key={event.eventId}
            event={event}
            overdueHours={queue!.overdueHours}
            onDone={onDone}
            startOpen={view === "action"}
          />
        ))}
      </div>

      {view === "all" && term && all.length === 0 && (
        <p className="py-6 text-center text-sm text-secondary">No event matches &ldquo;{search.trim()}&rdquo;.</p>
      )}
      {view === "all" && all.length > shown && (
        <button
          type="button"
          onClick={() => setShown((n) => n + QUEUE_PAGE)}
          className="mt-3 h-10 w-full rounded-md border border-border bg-surface text-sm font-semibold text-secondary transition-colors hover:border-border-hover hover:text-primary"
        >
          Show more ({all.length - shown} left)
        </button>
      )}
      {queue?.truncated && (
        <p className="mt-2 text-[13px] font-medium text-tertiary">
          The queue is capped — the oldest events beyond the cap aren&rsquo;t listed.
        </p>
      )}
    </section>
  );
}

/* ---------- recent settlements ---------- */

const SETTLED_PAGE = 10;

function RecentSettlements({ items }: { items: SettlementRecord[] | null }) {
  const money = useAdminMoney();
  const [shown, setShown] = useState(SETTLED_PAGE);
  if (!items) return null;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Recent settlements</h2>
      {items.length === 0 && (
        <p className="py-8 text-center text-sm text-secondary">Nothing settled yet.</p>
      )}
      <ul className="mt-1 flex max-h-[60dvh] flex-col overflow-y-auto overscroll-contain">
        {items.slice(0, shown).map((s) => {
          const title = [s.eventTitle, s.marketTitle && s.marketTitle !== s.eventTitle ? s.marketTitle : null]
            .filter(Boolean)
            .join(" — ");
          return (
            <li
              key={s.id}
              className="flex items-center gap-3 border-b border-border py-3 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {title && s.eventSlug ? (
                    <Link href={bookHref(s.eventSlug, s.eventId)} className="hover:underline">
                      {title}
                    </Link>
                  ) : (
                    title || <span className="font-mono text-[13px] text-secondary">{s.marketId.slice(0, 8)}</span>
                  )}
                </p>
                <p className="mt-0.5 text-[13px] font-medium text-tertiary">
                  {s.voided
                    ? "Voided — stakes refunded"
                    : s.winningOutcomeLabel
                      ? `Won: ${s.winningOutcomeLabel}`
                      : "Settled"}{" "}
                  · {s.source === "admin" ? `by ${s.actor}` : "automatically"} ·{" "}
                  {s.positionsSettled} bet{s.positionsSettled === 1 ? "" : "s"}
                  {s.createdAt && ` · ${fmtDateTime(s.createdAt)}`}
                </p>
              </div>
              <p className="shrink-0 text-right text-sm font-semibold">
                <span className="block">{money.format(s.payoutTotalKobo)}</span>
                <span className="block text-[11px] font-medium text-tertiary">
                  {s.voided ? "refunded" : "paid out"}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
      {items.length > shown && (
        <button
          type="button"
          onClick={() => setShown((n) => n + SETTLED_PAGE)}
          className="mt-3 h-10 w-full rounded-md border border-border bg-surface text-sm font-semibold text-secondary transition-colors hover:border-border-hover hover:text-primary"
        >
          Show more ({items.length - shown} older)
        </button>
      )}
    </section>
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
  // the admin endpoint, not the user wallet's: a desk unlocked with an
  // access key has no user session to read the wallet with
  const { fx: current, status, error: loadError } = useAdminFx();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseFloat(draft);
  const valid = Number.isFinite(parsed) && parsed >= 1;

  const save = async () => {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      // show the new rate at once, then re-read it so every amount on
      // the desk (the $ view included) moves to the rate the API holds
      publishAdminFx(await setFxRate(parsed));
      void refreshAdminFx();
      setSaved(true);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set the rate");
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      id="conversion-rate"
      className="mt-6 scroll-mt-6 rounded-xl border border-border bg-surface p-4 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Conversion rate</h2>
          <p className="mt-0.5 text-sm text-secondary">
            How many naira one dollar buys, for funding credit balances. Until a
            rate is set nobody can fund a balance, and the desk can&rsquo;t show
            amounts in dollars.
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
          <Stat label="Mid rate" value={`${nairaRate(current.mid)} per $1`} />
          <Stat label="Users buy credit at" value={`${nairaRate(current.usdToNgn)} per $1`} />
          <Stat label="Users cash out at" value={`${nairaRate(current.ngnToUsd)} per $1`} />
        </div>
      ) : status === "idle" || status === "loading" ? (
        <div className="mt-4 h-[62px] animate-pulse rounded-md bg-element-2" />
      ) : status === "failed" ? (
        <p className="mt-4 flex items-center gap-2 rounded-md bg-warning-tint px-3 py-2.5 text-sm font-semibold text-warning">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0">
            Couldn&rsquo;t load the current rate{loadError ? ` (${loadError})` : ""}.{" "}
            <button
              type="button"
              onClick={() => void refreshAdminFx()}
              className="underline"
            >
              Try again
            </button>
          </span>
        </p>
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
          <span className="text-sm font-semibold text-tertiary">₦</span>
          <input
            id="fx-rate"
            inputMode="decimal"
            value={draft}
            placeholder={current ? current.mid.toFixed(2) : "1500"}
            onChange={(e) => {
              setDraft(e.target.value.replace(/[^0-9.]/g, "").slice(0, 10));
              setError(null);
              setSaved(false);
            }}
            className="w-28 bg-transparent text-sm font-semibold outline-none placeholder:text-tertiary"
          />
          <span className="text-sm font-medium text-tertiary">per $1</span>
        </div>
        <button
          disabled={!valid || pending}
          onClick={() => void save()}
          className="pressable flex h-10 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
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

/** 1532.5 → "₦1,532.50" — a rate, so always to the kobo. */
function nairaRate(n: number): string {
  return `₦${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  // caution, not the gold accent — gold is the brand and the buy action
  overdue: { label: "Overdue", className: "bg-warning-tint text-warning" },
  bayse_unreachable: {
    label: "Bayse unreachable",
    className: "bg-element-2 text-secondary",
  },
};

function QueueCard({
  event,
  overdueHours,
  onDone,
  startOpen,
}: {
  event: QueueEvent;
  overdueHours: number;
  onDone: () => void;
  /** Settle controls showing from the start (the "Needs action" view). */
  startOpen: boolean;
}) {
  const flag = event.attention ? ATTENTION[event.attention] : null;
  const money = useAdminMoney();
  const [open, setOpen] = useState(startOpen);

  return (
    <article className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={bookHref(event.eventSlug, event.eventId)}
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
            {money.format(event.openStakeKobo)} staked · pays up to{" "}
            {money.format(event.maxPayoutKobo)}
            {event.resolutionDate && ` · resolves ${fmtDateTime(event.resolutionDate)}`}
            {event.attention === "overdue" && ` (over ${overdueHours}h ago)`}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 shrink-0 items-center gap-1 rounded-sm px-2.5 text-[13px] font-semibold text-secondary transition-colors hover:bg-element-2 hover:text-primary"
        >
          {open ? "Hide" : `Settle (${event.markets.length} market${event.markets.length === 1 ? "" : "s"})`}
          <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
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
      )}
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
  const money = useAdminMoney();

  const run = async (action: "settle" | "void") => {
    if (pending) return;
    const stake = money.format(market.openStakeKobo);
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
          res.payoutTotalKobo ? `, paid ${money.format(res.payoutTotalKobo)}` : ""
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
          {market.openPositions} open · {money.format(market.openStakeKobo)} staked
          · pays up to {money.format(market.maxPayoutKobo)}
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
    <div className="min-w-0 rounded-md border border-border bg-page px-3 py-2">
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
