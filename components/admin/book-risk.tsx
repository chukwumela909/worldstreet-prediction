"use client";

import Link from "next/link";
import {
  ExclamationTriangleIcon as AlertTriangle,
  ShieldCheckIcon as ShieldCheck,
} from "@heroicons/react/24/outline";
import { bookHref } from "@/lib/book";
import { useAdminMoney } from "@/lib/admin-money";
import {
  fetchBookRisk,
  useAdminResource,
  type MarketLimitFlag,
} from "@/lib/admin-api";
import { FLAG_LEVEL, FLAG_TONE, FlagChip } from "@/components/admin/risk-flags";
import { UsdRateNote } from "@/components/admin/currency-switch";

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
 *
 * Under it, the markets closing in on the "Maximum loss per market"
 * setting — the API only reports those once it knows the setting, so on
 * an older API that section simply isn't there.
 *
 * Amounts follow the desk's ₦/$ switch (useAdminMoney).
 */
export function BookRiskStrip({ reloadKey = 0 }: { reloadKey?: number }) {
  const risk = useAdminResource(fetchBookRisk, true, reloadKey);
  const money = useAdminMoney();

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

  const {
    openPositions,
    openMarkets,
    openStakeKobo,
    worstCaseKobo,
    worstMarket,
    limitFlags,
    maxMarketExposureKobo,
  } = risk.data;

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
    <>
      <section className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 shadow-card sm:grid-cols-3">
        <Stat
          label="Money in unfinished bets"
          value={money.format(openStakeKobo)}
          note={`${openPositions} bet${openPositions === 1 ? "" : "s"} on ${openMarkets} market${openMarkets === 1 ? "" : "s"} still waiting for a result`}
        />
        <Stat
          label={exposed ? "Most we could lose" : "Profit already guaranteed"}
          value={money.formatSigned(worstCaseKobo)}
          valueClass={netLoss ? "text-no" : "text-yes"}
          note={
            exposed
              ? "only if every unfinished bet goes against us at once — very unlikely"
              : "bets are balanced on every market — we keep this whatever happens"
          }
        />
        {worstMarket ? (
          <Stat
            label="Riskiest market"
            value={money.formatSigned(worstMarket.lossKobo)}
            valueClass="text-no"
            note={
              <Link
                href={bookHref(worstMarket.eventSlug, worstMarket.marketId)}
                className="hover:text-primary hover:underline"
              >
                {worstMarket.eventTitle || worstMarket.marketTitle}
              </Link>
            }
          />
        ) : (
          <Stat
            label="Riskiest market"
            value="—"
            note="no market can lose us money right now"
          />
        )}
        {exposed && (
          <p className="flex items-start gap-1.5 text-[13px] font-medium text-tertiary sm:col-span-3">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-no" />
            Most of the money on these markets is on one side. On our own markets, make that side
            more expensive and the other side cheaper, so bets come in on both sides.
          </p>
        )}
        <UsdRateNote className="sm:col-span-3" />
      </section>
      {limitFlags && (
        <MarketLimits flags={limitFlags} limitKobo={maxMarketExposureKobo} />
      )}
    </>
  );
}

/**
 * Markets whose open bets could cost the house most of the per-market
 * loss limit — "Watch" from 70%, "Critical" from 90%. At 100% the book
 * refuses new bets on that market, so these are the ones that are about
 * to start turning people away (or that need their price moved).
 */
function MarketLimits({
  flags,
  limitKobo,
}: {
  flags: MarketLimitFlag[];
  limitKobo?: number;
}) {
  const money = useAdminMoney();
  return (
    <section className="mt-3 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold">Markets near their limit</h2>
        {limitKobo !== undefined && (
          <p className="text-[13px] font-medium text-tertiary">
            Maximum loss per market: {money.format(limitKobo)} ·{" "}
            <Link
              href="/admin/settings"
              className="hover:text-primary hover:underline"
            >
              Change
            </Link>
          </p>
        )}
      </div>

      {flags.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-secondary">
          <ShieldCheck className="size-4 shrink-0 text-yes" />
          No market is near its loss limit.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {flags.map((flag) => (
            <LimitRow key={flag.marketId} flag={flag} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LimitRow({ flag }: { flag: MarketLimitFlag }) {
  const money = useAdminMoney();
  const tone = FLAG_TONE[FLAG_LEVEL[flag.level].tone];
  const pct = Math.round(flag.share * 100);
  const title = flag.eventTitle || flag.marketTitle;
  const subtitle =
    flag.eventTitle && flag.marketTitle && flag.marketTitle !== flag.eventTitle
      ? flag.marketTitle
      : null;

  return (
    <li className="min-w-0 rounded-md border border-border bg-page px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={bookHref(flag.eventSlug, flag.marketId)}
            className="block truncate text-sm font-semibold hover:underline"
          >
            {title}
          </Link>
          {subtitle && (
            <p className="truncate text-xs font-medium text-tertiary">{subtitle}</p>
          )}
        </div>
        <FlagChip level={flag.level} />
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-element-3" aria-hidden>
        <div
          className={`h-full rounded-full ${tone.bar}`}
          style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs font-medium text-secondary">
        {money.formatCompact(flag.usedKobo)} of{" "}
        {money.formatCompact(flag.limitKobo)} used
        <span className="text-tertiary"> · {pct}%</span>
      </p>
    </li>
  );
}

export function Stat({
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
    <div className="min-w-0 rounded-md border border-border bg-page px-3 py-2">
      <p className="text-xs font-medium text-secondary">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold ${valueClass ?? ""}`}>{value}</p>
      <p className="mt-0.5 truncate text-[13px] font-medium text-tertiary">{note}</p>
    </div>
  );
}
