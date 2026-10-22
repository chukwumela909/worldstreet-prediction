"use client";

import { useEffect, useState } from "react";
import {
  ArrowPathIcon as RefreshCw,
  CheckCircleIcon as Check,
} from "@heroicons/react/24/outline";
import { ApiError, isApiConfigured } from "@/lib/api-client";
import {
  fetchAbuseWatch,
  resolveWithdrawal,
  type AbusePerson,
  type AbuseWatch,
  type WithdrawalCheckRow,
} from "@/lib/admin-api";
import { useAdminMoney, type AdminMoney } from "@/lib/admin-money";
import { showToast } from "@/lib/toast-store";
import { AccountControl } from "@/components/admin/account-control";
import { FLAG_TONE } from "@/components/admin/risk-flags";

/**
 * Abuse watch: the patterns that point to someone taking money they
 * shouldn't, one card each, every flagged person with a way to suspend
 * them right there. Withdrawals the wallet never confirmed come first,
 * because they hold a customer's money until the desk settles them.
 * Betting scans follow the period picked; money in and out is all time.
 * Read-only apart from those two actions (trading/abuse.ts).
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
  const [reloads, setReloads] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    data: AbuseWatch | null;
    error: string | null;
    errorCode: string | null;
  } | null>(null);
  const configured = isApiConfigured();
  const key = `${days}|${reloads}`;

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    fetchAbuseWatch(days)
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
  const watch = fresh?.data ?? loaded?.data ?? null;
  const loading = fresh === null;
  const reload = () => setReloads((n) => n + 1);
  const waiting = watch?.withdrawals.filter((w) => w.status === "unconfirmed").length ?? 0;

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Abuse watch</h1>
          <p className="mt-1 text-sm text-secondary">
            Patterns that point to someone taking money they shouldn&rsquo;t. Open a person to
            suspend them.
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
        <span className="text-xs text-tertiary">Bets placed in this period · money in and out is all time</span>
      </div>

      {fresh?.error && <p className="mt-4 text-sm font-semibold text-no">Couldn&rsquo;t load: {fresh.error}</p>}
      {!watch ? (
        <div className="mt-4 flex flex-col gap-3" aria-busy="true" aria-label="Running the scans">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-element-2" />
          ))}
        </div>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Count label="Withdrawals to confirm" n={waiting} />
            <Count label="Beating the odds" n={watch.beatingOdds.length} />
            <Count label="Near-certain buyers" n={watch.nearCertain.length} />
            <Count label="Accounts in pairs" n={watch.twins.length} />
            <Count label="Took out more than in" n={watch.cashOut.length} />
            <Count label="Balance off ledger" n={watch.ledgerGaps.length} />
          </dl>

          {watch.withdrawals.length > 0 && (
            <Card
              title="Withdrawals to confirm"
              blurb="The wallet never confirmed these, so the customer's credit is held — not returned on a guess, since the dollars may have arrived. Ask the wallet again first; only return the credit once you're sure the dollars didn't arrive."
            >
              <ul className="flex flex-col gap-2">
                {watch.withdrawals.map((w) => (
                  <WithdrawalItem key={w.refKey} w={w} money={money} onDone={reload} />
                ))}
              </ul>
            </Card>
          )}

          <Card
            title="Winning more than the odds allow"
            blurb="Won far more often than the prices they paid say is possible by luck — about 1 in 1,000 or rarer. The signature of betting on results already known: a live game, a count anyone can see, a stale price."
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
            blurb="Ten or more bets at ₦90 or more a share, and in profit on them — buying results that were all but decided. The ₦90 ceiling stops new ones; this shows who did it."
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
            blurb="Two accounts backing the same side of the same market within two minutes of each other, on five markets or more — often one person using two accounts to get round stake and loss limits."
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

          <Card
            title="Took out more than they put in"
            blurb="Withdrew more than they ever added (failed withdrawals that came back are netted off) — where money won on the platform left it. Fine for an honest winner; worth a look next to the scans above."
            empty={watch.cashOut.length === 0}
          >
            {watch.cashOut.map((r) => (
              <PersonRow key={r.authUserId} person={r} money={money} onChanged={reload}>
                Added {money.format(r.addedKobo)}, withdrew {money.format(r.withdrawnKobo)} —{" "}
                <b className="text-primary">{money.format(r.extraKobo)} more out than in</b>. Their bets made{" "}
                <span className={r.betProfitKobo >= 0 ? "text-yes" : "text-no"}>{money.formatSigned(r.betProfitKobo)}</span>
                {r.reversedKobo > 0 && <> · {money.format(r.reversedKobo)} of winnings reversed</>}.
              </PersonRow>
            ))}
          </Card>

          <Card
            title="Balance doesn't match the ledger"
            blurb="The balance isn't the sum of the account's money movements — money moved outside the ledger. This should never happen: tell the developers."
            empty={watch.ledgerGaps.length === 0}
          >
            {watch.ledgerGaps.map((r) => (
              <PersonRow key={r.authUserId} person={r} money={money} onChanged={reload}>
                Ledger adds up to {money.format(r.ledgerKobo)}; the balance is{" "}
                <b className="text-no">{money.formatSigned(r.gapKobo)} off</b>.
              </PersonRow>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

/* ---------- pieces ---------- */

function Card({
  title,
  blurb,
  empty,
  children,
}: {
  title: string;
  blurb: string;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-0.5 text-sm text-secondary">{blurb}</p>
      {empty ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-yes">
          <Check className="size-4" aria-hidden />
          Nothing found.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">{children}</ul>
      )}
    </section>
  );
}

/** One flagged person: who, the evidence, and the suspend control on demand. */
function PersonRow({
  person,
  money,
  onChanged,
  compact,
  children,
}: {
  person: AbusePerson;
  money: AdminMoney;
  onChanged: () => void;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const Wrapper = compact ? "div" : "li";
  return (
    <Wrapper className={`rounded-md border border-border ${compact ? "bg-surface" : "bg-page"} p-3`}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="truncate">{person.displayName || person.username}</span>
            {person.suspendedAt && (
              <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${FLAG_TONE.danger.chip}`}>
                Suspended
              </span>
            )}
          </p>
          <p className="truncate text-xs text-tertiary">
            @{person.username}
            {person.email ? ` · ${person.email}` : ""} · balance {money.format(person.balanceKobo)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="h-8 shrink-0 rounded-sm border border-border px-3 text-xs font-semibold text-secondary hover:border-border-hover hover:text-primary"
        >
          {open ? "Close" : person.suspendedAt ? "Suspension…" : "Suspend…"}
        </button>
      </div>
      {children && <p className="mt-1.5 text-sm text-secondary">{children}</p>}
      {open && (
        <div className="mt-2">
          <AccountControl trader={person} actions={undefined} onChanged={onChanged} />
        </div>
      )}
    </Wrapper>
  );
}

function WithdrawalItem({ w, money, onDone }: { w: WithdrawalCheckRow; money: AdminMoney; onDone: () => void }) {
  const [busy, setBusy] = useState<"retry" | "paid" | "return" | null>(null);
  const [confirmReturn, setConfirmReturn] = useState(false);
  const act = async (action: "retry" | "paid" | "return") => {
    setBusy(action);
    try {
      const res = await resolveWithdrawal(w.refKey, action);
      showToast(res.message, res.status === "unconfirmed" ? "error" : "success");
      onDone();
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : "Request failed. Try again.", "error");
    } finally {
      setBusy(null);
      setConfirmReturn(false);
    }
  };
  const waiting = w.status === "unconfirmed";
  return (
    <li className="rounded-md border border-border bg-page p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">
            @{w.username || w.authUserId} · {money.format(w.amountKobo)} → ${(w.amountUsdMinor / 100).toFixed(2)}
          </p>
          <p className="text-xs text-tertiary">
            {w.email}
            {w.createdAt ? ` · ${when(w.createdAt)}` : ""}
            {w.lastCode ? ` · wallet said ${w.lastCode}${w.lastMessage ? `: ${w.lastMessage}` : ""}` : ""}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            waiting ? FLAG_TONE.caution.chip : "bg-element-2 text-tertiary"
          }`}
        >
          {waiting ? "Waiting" : w.status === "paid" ? "Paid" : w.status === "returned" ? "Credit returned" : "Checking"}
        </span>
      </div>
      {waiting && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => act("retry")}
            disabled={busy !== null}
            className="pressable h-8 rounded-sm bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
          >
            {busy === "retry" ? "Asking…" : "Ask the wallet again"}
          </button>
          <button
            type="button"
            onClick={() => act("paid")}
            disabled={busy !== null}
            className="h-8 rounded-sm border border-border px-3 text-xs font-semibold text-secondary hover:text-primary disabled:opacity-40"
          >
            The dollars arrived
          </button>
          {confirmReturn ? (
            <>
              <button
                type="button"
                onClick={() => act("return")}
                disabled={busy !== null}
                className="pressable h-8 rounded-sm bg-no-solid px-3 text-xs font-semibold text-white disabled:opacity-40"
              >
                {busy === "return" ? "Returning…" : `Yes, return ${money.format(w.amountKobo)}`}
              </button>
              <button
                type="button"
                onClick={() => setConfirmReturn(false)}
                className="h-8 rounded-sm border border-border px-3 text-xs font-semibold text-secondary"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReturn(true)}
              disabled={busy !== null}
              className="h-8 rounded-sm border border-no/40 px-3 text-xs font-semibold text-no hover:bg-no-tint disabled:opacity-40"
            >
              Return the credit…
            </button>
          )}
        </div>
      )}
      {!waiting && w.resolvedBy && (
        <p className="mt-1 text-xs text-tertiary">
          Settled by {w.resolvedBy}
          {w.resolvedAt ? ` · ${when(w.resolvedAt)}` : ""}
        </p>
      )}
    </li>
  );
}

function Count({ label, n }: { label: string; n: number }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 shadow-card">
      <dt className="text-xs font-medium text-secondary">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${n > 0 ? "text-warning" : ""}`}>{n}</dd>
    </div>
  );
}

function Profit({ kobo, money }: { kobo: number; money: AdminMoney }) {
  return (
    <>
      Their profit:{" "}
      <b className={kobo > 0 ? "text-no" : "text-yes"}>{money.formatSigned(kobo)}</b>.
    </>
  );
}

function Markets({ list }: { list: string[] }) {
  if (list.length === 0) return null;
  return <span className="mt-1 block text-xs text-tertiary">Mostly on: {list.join(" · ")}</span>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl rounded-xl border border-border bg-surface p-6 text-sm leading-6 text-secondary shadow-card">
      {children}
    </div>
  );
}

/** ₦95.20 for 9520 kobo — the price of a ₦100 share. */
function cents(kobo: number): string {
  return `₦${(kobo / 100).toFixed(2)}`;
}

function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
