"use client";

import { ArrowPathIcon as RefreshCw } from "@heroicons/react/24/outline";
import { useAdminMoney } from "@/lib/admin-money";
import { FLAG_TONE } from "@/components/admin/risk-flags";
import { Card, Count, PersonRow, blockedNotice, useAbuseWatch } from "@/components/admin/watch-parts";

/**
 * Money checks: things about customers' money worth knowing, none of them
 * abuse in itself. Who owes us, who took out more than they put in, and
 * balances that don't match their records. Read-only apart from suspending
 * (trading/abuse.ts); nothing here charges anyone's dollar wallet.
 */

export function MoneyChecksDesk() {
  const money = useAdminMoney();
  const { configured, watch, loading, error, errorCode, reload } = useAbuseWatch(30);
  const blocked = blockedNotice(configured, errorCode);
  if (blocked) return blocked;
  const belowZero = watch?.belowZero ?? [];

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Money checks</h1>
          <p className="mt-1 text-sm text-secondary">
            Being on this page doesn&rsquo;t mean a customer did anything wrong. All time.
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

      {error && <p className="mt-4 text-sm font-semibold text-no">Couldn&rsquo;t load: {error}</p>}
      {!watch ? (
        <div className="mt-4 flex flex-col gap-3" aria-busy="true" aria-label="Running the checks">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-element-2" />
          ))}
        </div>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Count label="Owe us money" n={belowZero.length} verdict="notAbuse" />
            <Count label="Took out more than they put in" n={watch.cashOut.length} verdict="notAbuse" />
            <Count label="Balance doesn't match records" n={watch.ledgerGaps.length} verdict="fault" />
          </dl>

          <Card
            title="Owe us money"
            verdict="notAbuse"
            means="A reversal took back more than their balance held. For information only."
            blurb={`Shown next to their WorldStreet dollar wallet. Nothing here charges it. Owed in all: ${money.format(
              belowZero.reduce((s, r) => s + r.owedKobo, 0),
            )}.`}
            empty={belowZero.length === 0}
          >
            {belowZero.map((r) => (
              <PersonRow key={r.authUserId} person={r} money={money} onChanged={reload}>
                <b className="text-no">Owes {money.format(r.owedKobo)}</b> · dollar wallet{" "}
                <b className="text-primary">
                  {r.walletUsdMinor === null ? "unknown" : `$${(r.walletUsdMinor / 100).toFixed(2)}`}
                </b>{" "}
                · from {r.reversedBets} reversed bet{r.reversedBets === 1 ? "" : "s"}.
                {r.waivedKobo > 0 && (
                  <span className={`mt-1 block rounded-md px-2 py-1 text-xs font-semibold ${FLAG_TONE.caution.chip}`}>
                    {money.format(r.waivedKobo)} of their debt was waived before — they were told they owe nothing.
                  </span>
                )}
              </PersonRow>
            ))}
          </Card>

          <Card
            title="Took out more than they put in"
            verdict="notAbuse"
            means="Honest winners land here too. It only matters if they're also under Suspicious customers."
            blurb="They withdrew more than they ever added. Failed withdrawals that came back are netted off."
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
            title="Balance doesn't match records"
            verdict="fault"
            means="Not the customer's doing: a bug on our side. Tell the developers; don't suspend for this."
            blurb="The balance isn't the sum of the account's money movements. This should never happen. Their withdrawals wait for approval until the alert is settled."
            empty={watch.ledgerGaps.length === 0}
          >
            {watch.ledgerGaps.map((r) => (
              <PersonRow key={r.authUserId} person={r} money={money} onChanged={reload}>
                The records add up to {money.format(r.ledgerKobo)}; the balance is{" "}
                <b className="text-no">{money.formatSigned(r.gapKobo)} off</b>.
              </PersonRow>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
