"use client";

import { Fragment, useEffect, useState } from "react";
import {
  ArrowPathIcon as RefreshCw,
  ChevronDownIcon as ChevronDown,
  ChevronRightIcon as ChevronRight,
} from "@heroicons/react/24/outline";
import { ApiError, isApiConfigured } from "@/lib/api-client";
import { useAdminMoney, type AdminMoney } from "@/lib/admin-money";
import {
  fetchTopicBets,
  type SettledStatus,
  type TopicBet,
  type TopicBetsReport,
  type TopicCustomer,
} from "@/lib/admin-api";
import { FLAG_TONE } from "@/components/admin/risk-flags";

/**
 * Who bet on a type of market: every bet on its markets that finished,
 * won, lost or refunded, and who placed it. Take action shows it under
 * its card, for the same markets and date.
 *
 * Built to be read at a glance, not scrolled: one line says what
 * happened (who won, at what prices, what it cost us), then three tabs:
 * Customers (one row each, with win rate, average price, balance and a
 * way to act on them), Rounds (one row per market, expanding to its bets)
 * and All bets (paged). Amounts follow the desk's ₦/$ switch.
 *
 * The window: bets placed from the card's date (the bets a take-back
 * from that date would touch), or the ones settled in the last 24 hours,
 * 7 or 30 days.
 */

/** The furthest back the API reads by settling time: 90 days. */
const MAX_HOURS = 2_160;
const WINDOWS = [
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
] as const;
const PLACED = "placed";

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });

type Tab = "customers" | "rounds" | "bets";
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

const CUSTOMERS_PAGE = 20;
const ROUNDS_PAGE = 20;
const BETS_PAGE = 25;

/** A ₦100 share bought at this price or more was already nearly decided. */
const NEAR_CERTAIN_KOBO = 8_500;

export function BetsReport({
  topics,
  sinceAt,
  busy = false,
  reloadKey = 0,
  onPick,
}: {
  topics: string[];
  /** Bets placed from this moment (ISO); null = as far back as the API reads. */
  sinceAt: string | null;
  busy?: boolean;
  /** Bump to re-read, after something on the page moved these bets. */
  reloadKey?: number;
  /** "Act on them": fills the card above with this customer. */
  onPick?: (username: string) => void;
}) {
  const money = useAdminMoney();
  const [windowKey, setWindowKey] = useState<string>(PLACED);
  const [n, setN] = useState(0);
  const [tab, setTab] = useState<Tab>("customers");
  const [filter, setFilter] = useState<Filter>("all");
  const [loaded, setLoaded] = useState<{
    key: string;
    data: TopicBetsReport | null;
    error: string | null;
    errorCode: string | null;
  } | null>(null);

  const configured = isApiConfigured();
  const placed = windowKey === PLACED;
  const hours = placed ? MAX_HOURS : Number(windowKey);
  const placedFrom = placed ? sinceAt : null;
  const key = `${topics.join(",")}|${windowKey}|${placedFrom ?? ""}|${n}|${reloadKey}`;

  useEffect(() => {
    if (!configured || topics.length === 0) return;
    let cancelled = false;
    fetchTopicBets({ topics, hours, sinceAt: placedFrom })
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

  if (!configured || topics.length === 0) return null;

  const fresh = loaded?.key === key ? loaded : null;
  // the last answer stays on screen while a new one loads
  const report = fresh?.data ?? loaded?.data ?? null;
  const loading = fresh === null;
  // an API older than sinceAt answers with the last 90 days by settling time
  const olderApi = Boolean(placedFrom) && report !== null && report.sinceAt === undefined;
  const span = !placed
    ? `settled in the last ${windowLabel(hours)}`
    : placedFrom && !olderApi
      ? `placed from ${dayLabel(placedFrom)}`
      : "settled in the last 90 days";

  return (
    <section className="mt-5 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Who bet on these markets</h2>
          <p className="mt-0.5 text-sm text-secondary">
            Finished bets on &ldquo;{topics.join(", ")}&rdquo; markets, {span}.
            {onPick && " Press “Act on them” to fill in the card above."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Which bets"
            small
            options={[
              { key: PLACED, label: sinceAt ? `From ${dayLabel(sinceAt)}` : "All time" },
              ...WINDOWS.map((w) => ({ key: String(w.hours), label: w.label })),
            ]}
            value={windowKey}
            onChange={setWindowKey}
          />
          <button
            type="button"
            onClick={() => setN((x) => x + 1)}
            aria-label="Refresh who bet"
            className="flex h-8 items-center rounded-sm border border-border px-2.5 text-secondary hover:text-primary"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {olderApi && (
        <p className={`mt-3 rounded-md px-3 py-2 text-xs font-semibold ${FLAG_TONE.caution.chip}`}>
          The API is older than this page, so this counts bets settled in the last 90 days, not placed from the date.
          Deploy the API.
        </p>
      )}
      {fresh?.error && <p className="mt-3 text-sm font-semibold text-no">{fresh.error}</p>}

      {!report ? (
        <p className="mt-6 text-center text-sm text-secondary">{loading ? "Loading…" : ""}</p>
      ) : report.totals.bets === 0 ? (
        <p className="mt-4 rounded-md bg-element-2 px-3 py-3 text-sm text-secondary">
          No finished bets on {report.topics.join(", ")}, {span}.
          {report.open.bets > 0 &&
            ` ${report.open.bets} bet${report.open.bets === 1 ? " is" : "s are"} still open (${money.format(report.open.stakeKobo)}).`}
        </p>
      ) : (
        <>
          <Insight report={report} money={money} />
          <Totals report={report} money={money} span={span} />

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-b border-border">
            <div className="flex gap-1" role="tablist">
              {(
                [
                  ["customers", `Customers · ${report.totals.customers}`],
                  ["rounds", `Rounds · ${report.totals.rounds}`],
                  ["bets", `All bets · ${report.totals.bets}`],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                    tab === k ? "border-accent text-primary" : "border-transparent text-secondary hover:text-primary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab !== "rounds" && (
              <Segmented
                label="Filter by result"
                small
                options={FILTERS}
                value={filter}
                onChange={(f) => setFilter(f as Filter)}
              />
            )}
          </div>

          {tab === "customers" && (
            <CustomersTab
              key={`${key}|${filter}`}
              report={report}
              filter={filter}
              money={money}
              busy={busy}
              onPick={onPick}
            />
          )}
          {tab === "rounds" && <RoundsTab key={key} report={report} money={money} />}
          {tab === "bets" && <BetsTab key={`${key}|${filter}`} report={report} filter={filter} money={money} />}

          {report.truncated && (
            <p className="mt-3 text-xs text-tertiary">Only the newest 5,000 bets are counted.</p>
          )}
        </>
      )}
    </section>
  );
}

/* ---------- the one line that says what happened ---------- */

function Insight({ report, money }: { report: TopicBetsReport; money: AdminMoney }) {
  const t = report.totals;
  const decided = t.won + t.lost;
  const wonPct = decided > 0 ? Math.round((t.won / decided) * 100) : 0;
  const nearCertain = t.avgPriceKobo >= NEAR_CERTAIN_KOBO && wonPct >= 75;
  const losing = t.houseResultKobo < 0;
  const tone = FLAG_TONE[losing ? "danger" : "caution"];
  return (
    <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${losing ? tone.banner : "border-border bg-surface"}`}>
      <p className="font-semibold">
        {decided > 0 ? (
          <>
            Customers won <span className={losing ? tone.text : ""}>{wonPct}%</span> of {decided} bet
            {decided === 1 ? "" : "s"}, paying {money.format(t.avgPriceKobo)} on average for a share
            that pays {money.format(10_000)}.
          </>
        ) : (
          <>Every bet here was refunded.</>
        )}{" "}
        Result for us:{" "}
        <span className={t.houseResultKobo < 0 ? "text-no" : t.houseResultKobo > 0 ? "text-yes" : ""}>
          {money.formatSigned(t.houseResultKobo)}
        </span>
        .
      </p>
      {nearCertain && (
        <p className="mt-1 text-secondary">
          Paying around {money.format(t.avgPriceKobo)} for a {money.format(10_000)} share means buying the
          side that was already almost certain, near the end of the market, before the price we copy
          caught up.
        </p>
      )}
    </div>
  );
}

function Totals({ report, money, span }: { report: TopicBetsReport; money: AdminMoney; span: string }) {
  const t = report.totals;
  return (
    <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat
        label="Bets settled"
        value={String(t.bets)}
        note={`${t.won} won · ${t.lost} lost · ${t.refunded} refunded · ${t.customers} customers`}
      />
      <Stat label="Total staked" value={money.formatHeadline(t.stakedKobo)} note={`avg price ${money.format(t.avgPriceKobo)}`} />
      <Stat
        label="Paid out"
        value={money.formatHeadline(t.paidKobo)}
        note={t.refundedKobo > 0 ? `+ ${money.format(t.refundedKobo)} refunded` : "to winners"}
      />
      <Stat
        label="Result for us"
        value={money.formatHeadline(t.houseResultKobo, { signed: true })}
        valueClass={t.houseResultKobo > 0 ? "text-yes" : t.houseResultKobo < 0 ? "text-no" : ""}
        note={
          report.open.bets > 0
            ? `${report.open.bets} still open (${money.format(report.open.stakeKobo)})`
            : span
        }
      />
    </dl>
  );
}

/* ---------- tabs ---------- */

function CustomersTab({
  report,
  filter,
  money,
  busy,
  onPick,
}: {
  report: TopicBetsReport;
  filter: Filter;
  money: AdminMoney;
  busy: boolean;
  onPick?: (username: string) => void;
}) {
  const [shown, setShown] = useState(CUSTOMERS_PAGE);
  const rows = report.customers.filter((c) => matches(c, filter));
  return (
    <TableCard>
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="text-xs text-secondary">
          <tr className="border-b border-border">
            <th className="py-2 pr-3 font-medium">Customer</th>
            <th className="py-2 pr-3 font-medium">Bets</th>
            <th className="py-2 pr-3 text-right font-medium">Win rate</th>
            <th className="py-2 pr-3 text-right font-medium">Avg price</th>
            <th className="py-2 pr-3 text-right font-medium">Staked</th>
            <th className="py-2 pr-3 text-right font-medium">Refunded</th>
            <th className="py-2 pr-3 text-right font-medium">Their result</th>
            <th className="py-2 pr-3 text-right font-medium">Balance</th>
            {onPick && (
              <th className="py-2 font-medium">
                <span className="sr-only">Action</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, shown).map((c) => {
            const decided = c.won + c.lost;
            return (
              <tr key={c.authUserId} className="border-b border-border last:border-0">
                <td className="py-2 pr-3">
                  <p className="font-semibold">
                    {c.username || "—"}
                    {c.suspended && (
                      <span className={`ml-2 rounded-sm px-1.5 text-xs font-semibold ${FLAG_TONE.danger.chip}`}>
                        Suspended
                      </span>
                    )}
                    {!c.suspended && c.withdrawalsLocked && (
                      <span className={`ml-2 rounded-sm px-1.5 text-xs font-semibold ${FLAG_TONE.caution.chip}`}>
                        Withdrawals locked
                      </span>
                    )}
                  </p>
                  <p className="break-all text-xs text-secondary">{c.email}</p>
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-secondary">
                  {c.bets}
                  <span className="text-xs text-tertiary">
                    {" "}
                    ({[c.won && `${c.won} won`, c.lost && `${c.lost} lost`, c.refunded && `${c.refunded} refunded`]
                      .filter(Boolean)
                      .join(" · ")})
                  </span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {decided > 0 ? `${Math.round((c.won / decided) * 100)}%` : "—"}
                </td>
                <td
                  className={`py-2 pr-3 text-right tabular-nums ${
                    c.avgPriceKobo >= NEAR_CERTAIN_KOBO ? "font-semibold text-warning" : ""
                  }`}
                >
                  {money.format(c.avgPriceKobo)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{money.format(c.stakedKobo)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-secondary">
                  {c.refundedKobo > 0 ? money.format(c.refundedKobo) : "—"}
                </td>
                <td className={`whitespace-nowrap py-2 pr-3 text-right font-semibold tabular-nums ${resultTone(c.resultKobo)}`}>
                  {resultText(c.resultKobo, money)}
                </td>
                <td
                  className={`whitespace-nowrap py-2 pr-3 text-right tabular-nums ${
                    (c.balanceKobo ?? 0) < 0 ? "font-semibold text-no" : ""
                  }`}
                >
                  {c.balanceKobo === undefined
                    ? "—"
                    : c.balanceKobo < 0
                      ? `owes ${money.format(-c.balanceKobo)}`
                      : money.format(c.balanceKobo)}
                </td>
                {onPick && (
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onPick(c.username)}
                      disabled={busy || !c.username}
                      className="h-8 whitespace-nowrap rounded-sm border border-border px-3 text-xs font-semibold text-secondary hover:text-primary disabled:opacity-40"
                    >
                      Act on them
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <More shown={shown} total={rows.length} step={CUSTOMERS_PAGE} onMore={setShown} noun="customers" />
    </TableCard>
  );
}

function RoundsTab({ report, money }: { report: TopicBetsReport; money: AdminMoney }) {
  const [shown, setShown] = useState(ROUNDS_PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const oneEvent = new Set(report.rounds.map((r) => r.eventTitle)).size === 1;
  return (
    <TableCard>
      {oneEvent && report.rounds[0] && (
        <p className="pb-2 text-xs text-secondary">{report.rounds[0].eventTitle}</p>
      )}
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="text-xs text-secondary">
          <tr className="border-b border-border">
            <th className="py-2 pr-3 font-medium">Settled</th>
            {!oneEvent && <th className="py-2 pr-3 font-medium">Market</th>}
            <th className="py-2 pr-3 font-medium">Won</th>
            <th className="py-2 pr-3 text-right font-medium">Bets</th>
            <th className="py-2 pr-3 text-right font-medium">Avg price</th>
            <th className="py-2 pr-3 text-right font-medium">Staked</th>
            <th className="py-2 text-right font-medium">Result for us</th>
          </tr>
        </thead>
        <tbody>
          {report.rounds.slice(0, shown).map((r) => {
            const expanded = open === r.marketId;
            const bets = expanded ? report.bets.filter((b) => b.marketId === r.marketId) : [];
            return (
              <Fragment key={r.marketId}>
                <tr
                  className="cursor-pointer border-b border-border hover:bg-element-2"
                  onClick={() => setOpen(expanded ? null : r.marketId)}
                  aria-expanded={expanded}
                >
                  <td className="whitespace-nowrap py-2 pr-3">
                    <span className="inline-flex items-center gap-1">
                      {expanded ? (
                        <ChevronDown className="size-3.5 text-secondary" aria-hidden />
                      ) : (
                        <ChevronRight className="size-3.5 text-secondary" aria-hidden />
                      )}
                      {r.settledAt ? fmtDateTime(r.settledAt) : "—"}
                    </span>
                  </td>
                  {!oneEvent && <td className="py-2 pr-3">{r.eventTitle}</td>}
                  <td className="py-2 pr-3 font-semibold">{r.winning.join(", ") || "Refunded"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {r.bets}
                    <span className="text-xs text-tertiary"> · {r.customers} ppl</span>
                  </td>
                  <td
                    className={`py-2 pr-3 text-right tabular-nums ${
                      r.avgPriceKobo >= NEAR_CERTAIN_KOBO ? "font-semibold text-warning" : ""
                    }`}
                  >
                    {money.format(r.avgPriceKobo)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money.format(r.stakedKobo)}</td>
                  <td className={`py-2 text-right font-semibold tabular-nums ${houseTone(r.houseResultKobo)}`}>
                    {money.formatSigned(r.houseResultKobo)}
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-b border-border bg-sunken">
                    <td colSpan={oneEvent ? 6 : 7} className="px-3 py-2">
                      {bets.length === 0 ? (
                        <p className="text-xs text-secondary">These bets are older than the list goes back.</p>
                      ) : (
                        <ul className="divide-y divide-border">
                          {bets.map((b) => (
                            <BetLine key={b.id} bet={b} money={money} />
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <More shown={shown} total={report.rounds.length} step={ROUNDS_PAGE} onMore={setShown} noun="rounds" />
    </TableCard>
  );
}

function BetsTab({
  report,
  filter,
  money,
}: {
  report: TopicBetsReport;
  filter: Filter;
  money: AdminMoney;
}) {
  const [shown, setShown] = useState(BETS_PAGE);
  const rows = report.bets.filter((b) => filter === "all" || b.status === filter);
  const oneEvent = new Set(report.bets.map((b) => b.eventTitle)).size === 1;
  return (
    <TableCard>
      {oneEvent && report.bets[0] && <p className="pb-2 text-xs text-secondary">{report.bets[0].eventTitle}</p>}
      <ul className="divide-y divide-border">
        {rows.slice(0, shown).map((b) => (
          <BetLine key={b.id} bet={b} money={money} withEvent={!oneEvent} withTime />
        ))}
      </ul>
      <More shown={shown} total={rows.length} step={BETS_PAGE} onMore={setShown} noun="bets" />
    </TableCard>
  );
}

/** One bet on one line: who, which side at what price, stake, result, what came back. */
function BetLine({
  bet,
  money,
  withEvent = false,
  withTime = false,
}: {
  bet: TopicBet;
  money: AdminMoney;
  withEvent?: boolean;
  withTime?: boolean;
}) {
  const back = bet.status === "won" ? bet.payoutKobo : bet.status === "voided" ? bet.stakeKobo : 0;
  // reversed by Recovery after it settled: say so, and what it was
  const chip = bet.reversedFrom
    ? { label: `Reversed (${bet.reversedFrom})`, className: "bg-warning-tint text-warning" }
    : STATUS_CHIP[bet.status];
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-sm">
      {withTime && (
        <span className="w-28 shrink-0 tabular-nums text-xs text-secondary">
          {bet.settledAt ? fmtDateTime(bet.settledAt) : "—"}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate font-semibold">{bet.username || "—"}</span>
      <span className="whitespace-nowrap text-secondary">
        {withEvent && <span className="text-tertiary">{bet.eventTitle} · </span>}
        {bet.outcomeLabel} at{" "}
        <span className={bet.priceKobo >= NEAR_CERTAIN_KOBO ? "font-semibold text-warning" : ""}>
          {money.format(bet.priceKobo)}
        </span>
      </span>
      <span className="w-24 text-right tabular-nums">{money.format(bet.stakeKobo)}</span>
      <span
        className={`w-24 rounded-md px-1.5 py-0.5 text-center text-[11px] font-semibold ${chip.className}`}
      >
        {chip.label}
      </span>
      <span className="w-24 text-right tabular-nums">{back > 0 ? money.format(back) : "—"}</span>
    </li>
  );
}

/* ---------- small pieces ---------- */

function Segmented({
  label,
  options,
  value,
  onChange,
  small = false,
}: {
  label: string;
  options: readonly { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  small?: boolean;
}) {
  return (
    <div className="flex rounded-md bg-element-2 p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-sm px-2.5 font-semibold ${small ? "h-7 text-xs" : "h-8 text-sm"} ${
            value === o.key ? "bg-surface text-primary shadow-card" : "text-secondary hover:text-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TableCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface p-3 shadow-card sm:p-4">
      {children}
    </section>
  );
}

function More({
  shown,
  total,
  step,
  onMore,
  noun,
}: {
  shown: number;
  total: number;
  step: number;
  onMore: (n: number) => void;
  noun: string;
}) {
  if (total === 0) return <p className="py-4 text-center text-sm text-secondary">Nothing here.</p>;
  if (shown >= total) return null;
  return (
    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-secondary">
      <span>
        Showing {shown} of {total} {noun}
      </span>
      <button
        type="button"
        onClick={() => onMore(shown + step)}
        className="h-8 rounded-sm border border-border px-3 font-semibold text-primary hover:border-border-hover"
      >
        Show {Math.min(step, total - shown)} more
      </button>
    </div>
  );
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
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${valueClass}`}>{value}</dd>
      {note && <dd className="text-[11px] leading-4 text-tertiary">{note}</dd>}
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

const resultTone = (kobo: number) => (kobo > 0 ? "text-yes" : kobo < 0 ? "text-no" : "text-secondary");
const houseTone = resultTone;

function resultText(kobo: number, money: AdminMoney): string {
  if (kobo > 0) return `Up ${money.format(kobo)}`;
  if (kobo < 0) return `Down ${money.format(-kobo)}`;
  return "Even";
}

function windowLabel(hours: number): string {
  return WINDOWS.find((w) => w.hours === hours)?.label ?? `${hours} hours`;
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
