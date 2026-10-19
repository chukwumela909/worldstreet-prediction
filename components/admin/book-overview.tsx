"use client";

import { useState } from "react";
import { ArrowPathIcon as RefreshCw } from "@heroicons/react/24/outline";
import {
  fetchAdminOverview,
  useAdminResource,
  type PeriodStats,
} from "@/lib/admin-api";
import { useAdminMoney } from "@/lib/admin-money";
import { UsdRateNote } from "@/components/admin/currency-switch";

/**
 * The owner's headline numbers, at the top of the Local book desk:
 * what the book made or lost, what was staked, what went to winners,
 * and what is riding right now. Read from GET /v1/admin/overview.
 *
 * Two clocks, said in the footnote: money staked counts a bet when it
 * is placed, profit counts it when its market finishes — so a busy week
 * of bets on next month's matches shows a lot staked and little profit.
 * "Money in play now" and "Credit held by users" are right now, whatever
 * the period.
 *
 * Every amount goes through useAdminMoney, so the ₦/$ switch applies.
 * `reloadKey` is the desk saying it settled something worth re-reading.
 */

const PERIODS = [
  { key: "last24h", label: "24 hours", phrase: "in the last 24 hours" },
  { key: "last7Days", label: "7 days", phrase: "in the last 7 days" },
  { key: "last30Days", label: "30 days", phrase: "in the last 30 days" },
  { key: "allTime", label: "All time", phrase: "so far" },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

export function BookOverview({ reloadKey = 0 }: { reloadKey?: number }) {
  const overview = useAdminResource(fetchAdminOverview, true, reloadKey);
  const money = useAdminMoney();
  const [periodKey, setPeriodKey] = useState<PeriodKey>("allTime");

  // a non-admin is already explained by the desk
  if (overview.errorCode === "FORBIDDEN" || overview.errorStatus === 403) {
    return null;
  }
  // an API older than this page has no overview yet — say so rather than
  // leave the desk's headline numbers silently missing
  if (overview.errorStatus === 404) {
    return (
      <section className="mt-6 rounded-xl border border-border bg-surface p-4 shadow-card">
        <h2 className="text-base font-semibold">Overview</h2>
        <p className="mt-2 text-sm text-secondary">
          Profit / loss, money staked and the other headline numbers will show here once the
          latest API is deployed. Redeploy the API from the latest code.
        </p>
      </section>
    );
  }

  if (!overview.data) {
    if (overview.loading) return <OverviewSkeleton />;
    if (!overview.error) return null; // API not configured — the desk says so
    return (
      <section className="mt-6 rounded-xl border border-border bg-surface p-4 shadow-card">
        <h2 className="text-base font-semibold">Overview</h2>
        <p className="mt-2 text-sm text-secondary">
          Couldn&rsquo;t load the overview.{" "}
          <button
            type="button"
            onClick={overview.refresh}
            className="font-semibold text-primary underline"
          >
            Try again
          </button>
        </p>
      </section>
    );
  }

  const data = overview.data;
  const period = PERIODS.find((p) => p.key === periodKey)!;
  const p: PeriodStats = data.periods[periodKey];
  const finished = p.settledStakesKobo > 0 || p.marginPct !== null;
  const up = p.profitKobo >= 0;
  const resultTone = finished ? (up ? "text-yes" : "text-no") : undefined;

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Overview</h2>
          <p className="mt-0.5 text-[13px] text-secondary">
            How the book is doing — money in, money out, and what is riding now.
          </p>
          <UsdRateNote className="mt-0.5" />
        </div>
        <div
          role="group"
          aria-label="Period"
          className="flex max-w-full rounded-md bg-element-2 p-0.5"
        >
          {PERIODS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              aria-pressed={periodKey === opt.key}
              onClick={() => setPeriodKey(opt.key)}
              className={`h-8 shrink-0 whitespace-nowrap rounded-sm px-2.5 text-xs font-semibold transition-colors sm:px-3 ${
                periodKey === opt.key
                  ? "bg-surface text-primary shadow-card"
                  : "text-secondary hover:text-primary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {p.platformMadeKobo !== undefined &&
      p.winningsPaidKobo !== undefined &&
      p.totalEarnedKobo !== undefined ? (
        <PlatformResult
          madeKobo={p.platformMadeKobo}
          keptKobo={p.lostStakesKobo ?? 0}
          feesKobo={p.conversionEarningsKobo ?? 0}
          winningsKobo={p.winningsPaidKobo}
          netKobo={p.totalEarnedKobo}
          phrase={period.phrase}
        />
      ) : (
        p.totalEarnedKobo !== undefined && (
          <TotalEarned
            totalKobo={p.totalEarnedKobo}
            bettingKobo={p.profitKobo}
            conversionKobo={p.conversionEarningsKobo ?? 0}
            conversions={p.conversions ?? 0}
            phrase={period.phrase}
          />
        )
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label={finished ? (up ? "Betting profit" : "Betting loss") : "Betting profit / loss"}
          value={money.formatHeadline(p.profitKobo, { signed: true })}
          exact={money.formatSigned(p.profitKobo)}
          valueClass={resultTone}
          note={
            finished
              ? periodKey === "allTime"
                ? "from every market that has finished"
                : `from markets that finished ${period.phrase}`
              : periodKey === "allTime"
                ? "no market has finished yet"
                : `no market finished ${period.phrase}`
          }
        />
        <Tile
          label="Money staked"
          value={money.formatHeadline(p.stakedKobo)}
          exact={money.format(p.stakedKobo)}
          note={`${count(p.bets)} bet${p.bets === 1 ? "" : "s"} placed ${period.phrase}`}
        />
        <Tile
          label="Paid out to winners"
          value={money.formatHeadline(p.payoutsKobo)}
          exact={money.format(p.payoutsKobo)}
          note="on finished markets"
        />
        <Tile
          label="Margin kept"
          value={p.marginPct === null ? "—" : formatPct(p.marginPct)}
          valueClass={p.marginPct === null ? "text-tertiary" : resultTone}
          note="of money staked on finished markets"
        />
        <Tile
          label="Active traders"
          value={count(p.traders)}
          note={`of ${count(data.tradersWithStakes)} who have ever staked`}
        />
        <Tile
          label="Average bet"
          value={p.bets === 0 ? "—" : money.formatHeadline(p.averageStakeKobo)}
          exact={p.bets === 0 ? undefined : money.format(p.averageStakeKobo)}
          valueClass={p.bets === 0 ? "text-tertiary" : undefined}
          note={p.bets === 0 ? `no bets ${period.phrase}` : "per bet placed"}
        />
        <Tile
          label="Money in play now"
          value={money.formatHeadline(data.open.stakeKobo)}
          exact={money.format(data.open.stakeKobo)}
          note={`${count(data.open.bets)} open bet${
            data.open.bets === 1 ? "" : "s"
          } on ${count(data.open.markets)} market${
            data.open.markets === 1 ? "" : "s"
          }, right now`}
        />
        <Tile
          label="Credit held by users"
          value={money.formatHeadline(data.creditHeldKobo)}
          exact={money.format(data.creditHeldKobo)}
          note="unspent balances, right now"
        />
      </div>

      <p className="mt-3 flex items-start gap-2 text-xs font-medium text-tertiary">
        <span>
          Money staked counts bets when they&rsquo;re placed; profit counts them
          when their market finishes.
        </span>
        {overview.loading && (
          <RefreshCw className="ml-auto size-3.5 shrink-0 animate-spin" aria-label="Updating" />
        )}
      </p>
    </section>
  );
}

/**
 * The owner's headline: what the platform MADE — stakes kept from losing
 * bets plus conversion fees — biggest, then what it paid out in
 * winnings and the net of the two beside it, so the sum reads off the
 * page: made − winnings = net. Nothing is hidden; the net is just second.
 */
function PlatformResult({
  madeKobo,
  keptKobo,
  feesKobo,
  winningsKobo,
  netKobo,
  phrase,
}: {
  madeKobo: number;
  keptKobo: number;
  feesKobo: number;
  winningsKobo: number;
  netKobo: number;
  phrase: string;
}) {
  const money = useAdminMoney();
  const netTone = netKobo > 0 ? "text-yes" : netKobo < 0 ? "text-no" : "";

  return (
    <div className="mt-4 grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="col-span-2 min-w-0 rounded-lg border border-border bg-page px-4 py-4 lg:col-span-1">
        <p className="text-sm font-semibold text-secondary">Platform made {phrase}</p>
        <p
          className="mt-1 text-4xl font-bold tabular-nums text-yes sm:text-5xl"
          title={money.format(madeKobo)}
        >
          {money.formatHeadline(madeKobo)}
        </p>
        <p className="mt-2 text-[13px] font-medium text-tertiary">
          <span className="text-secondary">{money.format(keptKobo)}</span> kept from losing
          bets · <span className="text-secondary">{money.format(feesKobo)}</span> conversion
          fees
        </p>
      </div>
      <div className="min-w-0 rounded-lg border border-border bg-page px-4 py-4">
        <p className="text-sm font-semibold text-secondary">Winnings paid out</p>
        <p
          className="mt-1 text-2xl font-semibold tabular-nums"
          title={money.format(winningsKobo)}
        >
          {money.formatHeadline(winningsKobo)}
        </p>
        <p className="mt-2 text-[13px] font-medium text-tertiary">
          what winners won, on top of getting their stake back
        </p>
      </div>
      <div className="min-w-0 rounded-lg border border-border bg-page px-4 py-4">
        <p className="text-sm font-semibold text-secondary">Net result</p>
        <p
          className={`mt-1 text-2xl font-semibold tabular-nums ${netTone}`}
          title={money.formatSigned(netKobo)}
        >
          {money.formatHeadline(netKobo, { signed: true })}
        </p>
        <p className="mt-2 text-[13px] font-medium text-tertiary">
          platform made − winnings paid out
        </p>
      </div>
    </div>
  );
}

/**
 * The older headline, for an API that predates the made / winnings
 * split: the net, with betting and conversion fees underneath.
 */
function TotalEarned({
  totalKobo,
  bettingKobo,
  conversionKobo,
  conversions,
  phrase,
}: {
  totalKobo: number;
  bettingKobo: number;
  conversionKobo: number;
  conversions: number;
  phrase: string;
}) {
  const money = useAdminMoney();
  const tone = totalKobo > 0 ? "text-yes" : totalKobo < 0 ? "text-no" : "";

  return (
    <div className="mt-4 rounded-lg border border-border bg-page px-4 py-3">
      <p className="text-sm font-semibold text-secondary">
        {totalKobo < 0 ? "Total lost" : "Total earned"} {phrase}
      </p>
      <p
        className={`mt-1 text-3xl font-semibold tabular-nums ${tone}`}
        title={money.formatSigned(totalKobo)}
      >
        {money.formatHeadline(totalKobo, { signed: true })}
      </p>
      <p className="mt-1.5 text-[13px] font-medium text-tertiary">
        Betting <span className="text-secondary">{money.formatSigned(bettingKobo)}</span>
        {" · "}
        Conversion fees <span className="text-secondary">{money.formatSigned(conversionKobo)}</span>
        {conversions > 0 && ` (${conversions} conversion${conversions === 1 ? "" : "s"})`}
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  exact,
  valueClass,
  note,
}: {
  label: string;
  value: string;
  /** The unabbreviated amount, when `value` may be shortened ("₦1.2M"). */
  exact?: string;
  valueClass?: string;
  note: string;
}) {
  const shortened = exact !== undefined && exact !== value;
  return (
    <div className="min-w-0 rounded-md border border-border bg-page px-3 py-2.5">
      <p className="text-xs font-medium text-secondary">{label}</p>
      <p
        className={`mt-0.5 break-words text-lg font-semibold tabular-nums sm:text-xl ${valueClass ?? ""}`}
        title={shortened ? exact : undefined}
      >
        {value}
        {shortened && <span className="sr-only"> ({exact})</span>}
      </p>
      <p className="mt-0.5 break-words text-xs font-medium leading-4 text-tertiary">
        {note}
      </p>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <section
      className="mt-6 rounded-xl border border-border bg-surface p-4 shadow-card"
      aria-busy="true"
      aria-label="Loading the overview"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="h-10 w-48 animate-pulse rounded-md bg-element-2" />
        <div className="h-9 w-64 max-w-full animate-pulse rounded-md bg-element-2" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="h-[92px] min-w-0 animate-pulse rounded-md border border-border bg-page"
          />
        ))}
      </div>
    </section>
  );
}

function count(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "0";
}

/** 8.43 → "8.4%", −3.2 → "−3.2%". */
function formatPct(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  const text = Math.abs(pct).toFixed(1);
  return `${pct < 0 && text !== "0.0" ? "−" : ""}${text}%`;
}
