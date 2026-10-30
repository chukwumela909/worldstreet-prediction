"use client";

import { useState } from "react";
import { ArrowPathIcon as RefreshCw } from "@heroicons/react/24/outline";
import { useAdminMoney, type AdminMoney } from "@/lib/admin-money";
import { Card, Count, PersonRow, blockedNotice, useAbuseWatch } from "@/components/admin/watch-parts";

/**
 * Suspicious customers: only the people whose betting looks like it breaks
 * the Terms, one card per pattern, each with a way to suspend them right
 * there. Withdrawals have their own tab and things that aren't abuse live
 * in Money checks, so everyone here is someone to look at. Read-only apart
 * from suspending (trading/abuse.ts).
 */

const PERIODS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 0, label: "All time" },
] as const;

export function AbuseDesk() {
  const money = useAdminMoney();
  const [days, setDays] = useState<number>(30);
  const { configured, watch, loading, error, errorCode, reload } = useAbuseWatch(days);
  const blocked = blockedNotice(configured, errorCode);
  if (blocked) return blocked;

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Suspicious customers</h1>
          <p className="mt-1 text-sm text-secondary">
            Customers whose betting looks like it breaks our Terms. Check each one, then suspend them or clear them.
          </p>
          <p className="mt-1 text-sm text-secondary">
            A flagged customer&rsquo;s withdrawals wait for approval. To clear someone, go to Alerts → Suspicious
            customers and mark their alert settled.
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

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Bets placed in" className="inline-flex rounded-md bg-element-2 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              aria-pressed={days === p.days}
              onClick={() => setDays(p.days)}
              className={`h-9 rounded-sm px-3 text-sm font-semibold ${
                days === p.days ? "bg-surface text-primary shadow-card" : "text-secondary hover:text-primary"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-tertiary">Bets placed in this period</span>
      </div>

      {error && <p className="mt-4 text-sm font-semibold text-no">Couldn&rsquo;t load: {error}</p>}
      {!watch ? (
        <div className="mt-4 flex flex-col gap-3" aria-busy="true" aria-label="Running the scans">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-element-2" />
          ))}
        </div>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Count label="Winning more than the odds allow" n={watch.beatingOdds.length} verdict="abuse" />
            <Count label="Buying near-certain sides" n={watch.nearCertain.length} verdict="abuse" />
            <Count label="Accounts moving in pairs" n={watch.twins.length} verdict="suspicious" />
          </dl>

          <Card
            title="Winning more than the odds allow"
            verdict="abuse"
            means="Against our Terms if they bet on results already known. Check their bets, then suspend."
            blurb="They won far more often than the prices they paid say is possible by luck, about 1 in 1,000 or rarer."
            empty={watch.beatingOdds.length === 0}
          >
            {watch.beatingOdds.map((r) => (
              <PersonRow key={r.authUserId} person={r} money={money} onChanged={reload}>
                <b className="text-primary">
                  Won {r.won} of {r.bets}
                </b>{" "}
                — the prices said about {r.expectedWins.toLocaleString("en-US")} (avg {cents(r.avgPriceKobo)}).{" "}
                <Profit kobo={r.profitKobo} money={money} />
                <Markets list={r.markets} />
              </PersonRow>
            ))}
          </Card>

          <Card
            title="Buying near-certain sides"
            verdict="abuse"
            means="Against our Terms if the result was already decided. Check when they bet, then suspend or clear them."
            blurb="Ten or more bets at ₦90 or more a share, and in profit on them. The ₦90 ceiling stops new ones; this shows who did it."
            empty={watch.nearCertain.length === 0}
          >
            {watch.nearCertain.map((r) => (
              <PersonRow key={r.authUserId} person={r} money={money} onChanged={reload}>
                <b className="text-primary">
                  {r.bets} bets at avg {cents(r.avgPriceKobo)}, won {r.won}
                </b>{" "}
                on {money.format(r.stakedKobo)} staked. <Profit kobo={r.profitKobo} money={money} />
                <Markets list={r.markets} />
              </PersonRow>
            ))}
          </Card>

          <Card
            title="Accounts moving in pairs"
            verdict="suspicious"
            means="Could be one person on two accounts (against our Terms), or friends betting together. Check before acting."
            blurb="Two accounts backing the same side of the same market within two minutes of each other, on five markets or more."
            empty={watch.twins.length === 0}
          >
            {watch.twins.map((t) => (
              <li key={`${t.a.authUserId}|${t.b.authUserId}`} className="rounded-md border border-border bg-page p-3">
                <p className="text-sm text-secondary">
                  <b className="text-primary">
                    @{t.a.username} and @{t.b.username}
                  </b>{" "}
                  backed the same side of <b className="text-primary">{t.sharedMarkets} markets</b> within two
                  minutes{t.lastAt ? `, last on ${day(t.lastAt)}` : ""}.
                </p>
                <Markets list={t.examples} />
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {[t.a, t.b].map((p) => (
                    <PersonRow key={p.authUserId} person={p} money={money} onChanged={reload} compact />
                  ))}
                </div>
              </li>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

function Profit({ kobo, money }: { kobo: number; money: AdminMoney }) {
  return (
    <>
      Their profit: <b className={kobo > 0 ? "text-no" : "text-yes"}>{money.formatSigned(kobo)}</b>.
    </>
  );
}

function Markets({ list }: { list: string[] }) {
  if (list.length === 0) return null;
  return <span className="mt-1 block text-xs text-tertiary">Mostly on: {list.join(" · ")}</span>;
}

/** ₦95.20 for 9520 kobo — the price of a ₦100 share. */
function cents(kobo: number): string {
  return `₦${(kobo / 100).toFixed(2)}`;
}

function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
