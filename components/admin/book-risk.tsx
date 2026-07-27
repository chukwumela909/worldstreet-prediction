"use client";

import Link from "next/link";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { formatNaira, formatNairaSigned } from "@/lib/format";
import { fetchBookRisk, useAdminResource } from "@/lib/admin-api";

/**
 * The house's own position, across both desks.
 *
 * Worldstreet pays out every Local market itself, so the margin in a
 * price is only worth anything if the money lands on both sides of it.
 * A market priced at a 5% overround with every stake on one side isn't
 * earning 5% — it's a bet. This strip is the one place that says which
 * of the two the book currently is.
 *
 * `worstCase` assumes every open market resolves the wrong way at once.
 * They settle independently, so it isn't a forecast — it's the floor,
 * and it already nets off the stakes taken.
 *
 * It reads its own endpoint, so nothing the desk around it does reaches
 * it on its own: settle the market carrying the downside and the strip
 * would keep quoting a book that no longer exists. `reloadKey` is how
 * the desk says it changed something — bump it wherever the desk
 * refreshes itself.
 */
export function BookRiskStrip({ reloadKey = 0 }: { reloadKey?: number }) {
  const risk = useAdminResource(fetchBookRisk, true, reloadKey);

  // A 403 is a non-admin, which the desks around this already explain;
  // don't stack a second refusal on top of theirs.
  if (risk.errorCode === "FORBIDDEN" || (!risk.data && !risk.loading)) {
    return null;
  }
  if (!risk.data) {
    return (
      <section className="mt-6 h-[92px] animate-pulse rounded-xl border border-border bg-surface" />
    );
  }

  const { openPositions, openMarkets, openStakeKobo, worstCaseKobo, worstMarket } =
    risk.data;

  if (openPositions === 0) {
    return (
      <section className="mt-6 flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-secondary shadow-card">
        <ShieldCheck className="size-4 text-yes" />
        Nothing open — the house isn&rsquo;t carrying any risk right now.
      </section>
    );
  }

  // One market being short isn't cancelled out by another's margin:
  // they settle on their own days, and the short one pays out on its
  // own. So the book only counts as balanced when the net is a profit
  // AND no single market is carrying a loss.
  const netLoss = worstCaseKobo < 0;
  const exposed = netLoss || worstMarket !== null;

  return (
    <section className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 shadow-card sm:grid-cols-3">
      <Stat
        label="Money held"
        value={formatNaira(openStakeKobo)}
        note={`${openPositions} open position${openPositions === 1 ? "" : "s"} across ${openMarkets} market${openMarkets === 1 ? "" : "s"}`}
      />
      <Stat
        label={exposed ? "Worst case" : "Locked-in profit"}
        value={formatNairaSigned(worstCaseKobo)}
        valueClass={netLoss ? "text-no" : "text-yes"}
        note={
          exposed
            ? "if every open market goes against us"
            : "the book is balanced — this is ours whatever happens"
        }
      />
      {worstMarket ? (
        <Stat
          label="Biggest single risk"
          value={formatNairaSigned(worstMarket.lossKobo)}
          valueClass="text-no"
          note={
            <Link
              href={`/local/${worstMarket.eventSlug}`}
              className="hover:text-primary hover:underline"
            >
              {worstMarket.eventTitle || worstMarket.marketTitle}
            </Link>
          }
        />
      ) : (
        <Stat
          label="Biggest single risk"
          value="—"
          note="no market is short either side"
        />
      )}
      {exposed && (
        <p className="flex items-start gap-1.5 text-[13px] font-medium text-tertiary sm:col-span-3">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-no" />
          Move the price on the side the money is piling onto — make it dearer,
          and the other side cheaper — until both sides pay for each other.
        </p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  valueClass,
  note,
}: {
  label: string;
  value: string;
  valueClass?: string;
  note: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-page px-3 py-2">
      <p className="text-xs font-medium text-secondary">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold ${valueClass ?? ""}`}>{value}</p>
      <p className="mt-0.5 truncate text-[13px] font-medium text-tertiary">{note}</p>
    </div>
  );
}
