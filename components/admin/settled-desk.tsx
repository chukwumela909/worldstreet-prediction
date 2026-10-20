"use client";

import { useEffect, useState } from "react";
import { ArrowPathIcon as RefreshCw } from "@heroicons/react/24/outline";
import { ApiError, isApiConfigured } from "@/lib/api-client";
import { useAdminMoney } from "@/lib/admin-money";
import {
  fetchTopicBets,
  type SettledStatus,
  type TopicBetsReport,
  type TopicCustomer,
} from "@/lib/admin-api";

/**
 * Settled bets: every bet on a topic's markets that finished in a window
 * — won, lost or refunded — and who placed it. Opens on the paused topics
 * (Bitcoin), so after a pause it answers "who won, who lost, who got
 * their money back, and how much". Amounts follow the desk's ₦/$ switch.
 */

const WINDOWS = [
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
] as const;

type Filter = "all" | SettledStatus;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "voided", label: "Refunded" },
];

const STATUS_CHIP: Record<SettledStatus, { label: string; className: string }> = {
  won: { label: "Won", className: "bg-yes-tint text-yes" },
  lost: { label: "Lost", className: "bg-no-tint text-no" },
  voided: { label: "Refunded", className: "bg-element-2 text-secondary" },
};

export function SettledDesk() {
  const money = useAdminMoney();
  // what's typed vs what's been asked for: null = the paused topics
  const [typed, setTyped] = useState<string | null>(null);
  const [asked, setAsked] = useState<{ topics: string[] | null; hours: number; n: number }>({
    topics: null,
    hours: 72,
    n: 0,
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [loaded, setLoaded] = useState<{
    key: string;
    data: TopicBetsReport | null;
    error: string | null;
    errorCode: string | null;
  } | null>(null);

  const configured = isApiConfigured();
  const key = `${asked.topics?.join(",") ?? ""}|${asked.hours}|${asked.n}`;

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    fetchTopicBets({ topics: asked.topics ?? undefined, hours: asked.hours })
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

  const fresh = loaded?.key === key ? loaded : null;
  // the last answer stays on screen while a new one loads
  const report = fresh?.data ?? loaded?.data ?? null;
  const loading = fresh === null;

  if (!configured) {
    return <Notice>This desk needs the prediction API (NEXT_PUBLIC_API_URL).</Notice>;
  }
  if (fresh?.errorCode === "FORBIDDEN") {
    return <Notice>Your account isn&rsquo;t an admin of the Local book.</Notice>;
  }

  const topicsText = typed ?? report?.topics.join(", ") ?? "";
  const show = () => {
    const topics = topicsText
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    setAsked((a) => ({ topics: topics.length > 0 ? topics : null, hours: a.hours, n: a.n + 1 }));
  };

  const customers = (report?.customers ?? []).filter((c) => matches(c, filter));
  const bets = (report?.bets ?? []).filter((b) => filter === "all" || b.status === filter);
  const t = report?.totals;

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Settled bets</h1>
          <p className="mt-1 text-sm text-secondary">
            Every bet on a topic that finished — won, lost or refunded — and who placed it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAsked((a) => ({ ...a, n: a.n + 1 }))}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-56">
          <span className="block text-xs font-medium text-secondary">Topics (comma-separated)</span>
          <input
            value={topicsText}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && show()}
            placeholder="bitcoin, btc"
            className="mt-1 h-10 w-full rounded-md border border-border bg-sunken px-3 text-sm outline-none focus:border-accent"
          />
        </label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              type="button"
              aria-pressed={asked.hours === w.hours}
              onClick={() => setAsked((a) => ({ ...a, hours: w.hours, n: a.n + 1 }))}
              className={`h-10 rounded-md px-3 text-sm font-semibold ${
                asked.hours === w.hours
                  ? "bg-accent text-on-accent"
                  : "border border-border text-secondary hover:text-primary"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={show}
          className="pressable h-10 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover"
        >
          Show
        </button>
      </div>

      {fresh?.error && <p className="mt-3 text-sm font-semibold text-no">{fresh.error}</p>}

      {!report ? (
        <p className="mt-8 text-center text-sm text-secondary">{loading ? "Loading…" : ""}</p>
      ) : (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Customers" value={String(t!.customers)} />
            <Stat label="Bets settled" value={String(t!.bets)} note={`${t!.won} won · ${t!.lost} lost · ${t!.refunded} refunded`} />
            <Stat label="Total staked" value={money.formatHeadline(t!.stakedKobo)} />
            <Stat label="Paid to winners" value={money.formatHeadline(t!.paidKobo)} />
            <Stat label="Refunded" value={money.formatHeadline(t!.refundedKobo)} />
            <Stat
              label="Result for us"
              value={money.formatHeadline(t!.houseResultKobo, { signed: true })}
              valueClass={t!.houseResultKobo > 0 ? "text-yes" : t!.houseResultKobo < 0 ? "text-no" : ""}
            />
          </dl>
          <p className="mt-2 text-xs text-secondary">
            {report.topics.join(", ")} · last {WINDOWS.find((w) => w.hours === report.hours)?.label ?? `${report.hours} hours`}
            {report.open.bets > 0 &&
              ` · ${report.open.bets} bet${report.open.bets === 1 ? "" : "s"} (${money.format(report.open.stakeKobo)}) still open`}
            {report.truncated && " · only the newest 5,000 bets are counted"}
          </p>

          <div className="mt-5 flex flex-wrap gap-1" role="group" aria-label="Filter by result">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`h-8 rounded-full px-3 text-sm font-semibold ${
                  filter === f.key ? "bg-element-3 text-primary" : "text-secondary hover:text-primary"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {t!.bets === 0 ? (
            <p className="mt-6 rounded-xl border border-border bg-surface p-6 text-center text-sm text-secondary shadow-card">
              No bets on these topics finished in this window.
            </p>
          ) : (
            <>
              <section className="mt-3 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
                <h2 className="text-lg font-semibold">Customers</h2>
                <p className="text-xs text-secondary">Biggest winners first.</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="text-xs text-secondary">
                      <tr className="border-b border-border">
                        <th className="py-2 pr-3 font-medium">Customer</th>
                        <th className="py-2 pr-3 font-medium">Bets</th>
                        <th className="py-2 pr-3 text-right font-medium">Staked</th>
                        <th className="py-2 pr-3 text-right font-medium">Paid out</th>
                        <th className="py-2 pr-3 text-right font-medium">Refunded</th>
                        <th className="py-2 text-right font-medium">Their result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.map((c) => (
                        <tr key={c.authUserId} className="border-b border-border align-top last:border-0">
                          <td className="py-2 pr-3">
                            <p className="font-semibold">{c.username || "—"}</p>
                            <p className="break-all text-xs text-secondary">{c.email}</p>
                          </td>
                          <td className="whitespace-nowrap py-2 pr-3 text-secondary">
                            {c.won} won · {c.lost} lost · {c.refunded} refunded
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">{money.format(c.stakedKobo)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{money.format(c.paidKobo)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{money.format(c.refundedKobo)}</td>
                          <td
                            className={`whitespace-nowrap py-2 text-right font-semibold tabular-nums ${
                              c.resultKobo > 0 ? "text-yes" : c.resultKobo < 0 ? "text-no" : "text-secondary"
                            }`}
                          >
                            {c.resultKobo > 0
                              ? `Up ${money.format(c.resultKobo)}`
                              : c.resultKobo < 0
                                ? `Down ${money.format(-c.resultKobo)}`
                                : "Even"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="mt-4 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
                <h2 className="text-lg font-semibold">Bets</h2>
                <p className="text-xs text-secondary">Newest first.</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="text-xs text-secondary">
                      <tr className="border-b border-border">
                        <th className="py-2 pr-3 font-medium">Settled</th>
                        <th className="py-2 pr-3 font-medium">Customer</th>
                        <th className="py-2 pr-3 font-medium">Market</th>
                        <th className="py-2 pr-3 text-right font-medium">Stake</th>
                        <th className="py-2 pr-3 font-medium">Result</th>
                        <th className="py-2 text-right font-medium">Paid / refunded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bets.map((b) => (
                        <tr key={b.id} className="border-b border-border align-top last:border-0">
                          <td className="whitespace-nowrap py-2 pr-3 text-secondary">
                            {b.settledAt ? fmtDateTime(b.settledAt) : "—"}
                          </td>
                          <td className="py-2 pr-3 font-semibold">{b.username || "—"}</td>
                          <td className="py-2 pr-3">
                            <p>{b.eventTitle}</p>
                            <p className="text-xs text-secondary">
                              {b.marketTitle &&
                              b.marketTitle !== b.eventTitle &&
                              b.marketTitle !== b.outcomeLabel
                                ? `${b.marketTitle} · `
                                : ""}
                              {b.outcomeLabel} at {money.format(b.priceKobo)}
                            </p>
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">{money.format(b.stakeKobo)}</td>
                          <td className="py-2 pr-3">
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_CHIP[b.status].className}`}
                            >
                              {STATUS_CHIP[b.status].label}
                            </span>
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {b.status === "won"
                              ? money.format(b.payoutKobo)
                              : b.status === "voided"
                                ? money.format(b.stakeKobo)
                                : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** A customer shows under a filter when they have at least one bet of that result. */
function matches(c: TopicCustomer, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "won") return c.won > 0;
  if (filter === "lost") return c.lost > 0;
  return c.refunded > 0;
}

function Stat({
  label,
  value,
  note,
  valueClass = "",
}: {
  label: string;
  value: string;
  note?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 shadow-card">
      <dt className="text-xs font-medium text-secondary">{label}</dt>
      <dd className={`mt-0.5 text-base font-semibold tabular-nums ${valueClass}`}>{value}</dd>
      {note && <dd className="text-[11px] text-tertiary">{note}</dd>}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl rounded-xl border border-border bg-surface p-6 text-sm leading-6 text-secondary shadow-card">
      {children}
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
