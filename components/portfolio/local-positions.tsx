"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import {
  ArrowUpRightIcon as ArrowUpRight,
  ExclamationCircleIcon as CircleAlert,
  CheckCircleIcon as CircleCheck,
  XCircleIcon as CircleX,
  ArrowPathIcon as LoaderCircle,
  DocumentTextIcon as Receipt,
  ArrowUturnLeftIcon as RotateCcw,
  TicketIcon as Ticket,
} from "@heroicons/react/24/outline";
import type { HeroIcon } from "@/components/icons";
import { ProbabilityBar } from "@/components/market/outcome-quote";
import { formatNaira, formatNairaSigned } from "@/lib/format";
import { PAYOUT_PER_SHARE_KOBO, type LocalPosition } from "@/lib/local-trades";
import {
  CARD,
  EmptyState,
  LABEL,
  OutcomeChip,
  PRIMARY_BUTTON,
  formatDay,
  outcomeBarTone,
} from "@/components/portfolio/portfolio-ui";

/**
 * Local (naira) book inside the portfolio: every position taken against
 * Worldstreet on a Bayse market. Positions are held to settlement, so
 * there is no live mark here — an open row shows what it cost and what
 * it pays if it wins, and a settled receipt shows what actually landed.
 * Open and settled are separate sections — the settled list only grows,
 * and it shouldn't push what's still live off the screen.
 */

export interface LocalBook {
  open: LocalPosition[];
  settled: LocalPosition[];
  /** What the open positions cost, in kobo. */
  stakedKobo: number;
  /** What the open positions pay if every one of them wins, in kobo. */
  potentialKobo: number;
}

export function splitLocalBook(positions: LocalPosition[]): LocalBook {
  const open = positions.filter((p) => p.status === "open");
  const settled = positions.filter((p) => p.status !== "open");
  return {
    open,
    settled,
    stakedKobo: open.reduce((s, p) => s + p.stakeKobo, 0),
    potentialKobo: open.reduce((s, p) => s + p.potentialPayoutKobo, 0),
  };
}

/** What the book's load looks like when there are no rows to show yet. */
interface LoadState {
  loading: boolean;
  error: string | null;
}

/** Loading or failed, with nothing loaded — otherwise null. */
function unloadedState({ loading, error }: LoadState): ReactElement | null {
  if (loading) {
    return (
      <EmptyState
        icon={LoaderCircle}
        iconClassName="motion-safe:animate-spin"
        title="Loading your positions…"
        role="status"
      />
    );
  }
  if (error) {
    return (
      <EmptyState
        icon={CircleAlert}
        tone="text-no"
        title="Couldn't load your positions"
        role="alert"
      >
        {error}
      </EmptyState>
    );
  }
  return null;
}

function BrowseLocal() {
  return (
    <Link href="/?category=local" className={PRIMARY_BUTTON}>
      Browse Local markets
    </Link>
  );
}

/** A refresh failed but earlier rows are still on screen. */
export function StaleBookNotice({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className={`${CARD} flex items-center gap-2 px-4 py-3 text-[13px] font-semibold text-no`}
    >
      <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

/* ---------- open ---------- */

export function OpenPositions({
  positions,
  hasSettled,
  loading,
  error,
}: LoadState & {
  positions: LocalPosition[];
  /** Whether anything has settled — changes what the empty state says. */
  hasSettled: boolean;
}) {
  if (positions.length === 0) {
    return (
      unloadedState({ loading, error }) ?? (
        <EmptyState
          icon={Ticket}
          tone="text-accent-ink"
          title={hasSettled ? "No open positions" : "No Local positions yet"}
          actions={<BrowseLocal />}
        >
          {hasSettled
            ? "Everything you've staked has settled. Pick a Local market to take a new position."
            : "Stake credit on a Local market and it stays here until the market settles."}
        </EmptyState>
      )
    );
  }

  return (
    <div className={`${CARD} overflow-hidden`}>
      <table className="w-full text-left text-[13.5px]">
        <caption className="sr-only">Open Local positions</caption>
        <thead>
          <tr className={`border-b border-border ${LABEL}`}>
            <th scope="col" className="px-4 py-3 text-left font-semibold sm:px-5">
              Market
            </th>
            <th
              scope="col"
              className="hidden px-3 py-3 text-left font-semibold lg:table-cell"
            >
              Outcome
            </th>
            <th
              scope="col"
              className="hidden px-3 py-3 text-right font-semibold lg:table-cell"
            >
              Shares
            </th>
            <th
              scope="col"
              className="hidden px-3 py-3 text-right font-semibold lg:table-cell"
            >
              Entry
            </th>
            <th
              scope="col"
              className="hidden px-3 py-3 text-right font-semibold lg:table-cell"
            >
              Staked
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right font-semibold sm:px-5 lg:px-3"
            >
              To win
            </th>
            <th scope="col" className="hidden py-3 pl-3 pr-5 lg:table-cell">
              <span className="sr-only">Market page</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {positions.map((p) => (
            <OpenRow key={p.id} position={p} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OpenRow({ position: p }: { position: LocalPosition }) {
  const href = `/local/${p.eventSlug}`;
  // kobo per ₦100 share is the implied chance at entry
  const entryPct = Math.round((p.priceKobo / PAYOUT_PER_SHARE_KOBO) * 100);
  const opened = formatDay(p.createdAt);

  return (
    <tr className="transition-colors hover:bg-element-2/50">
      <td className="px-4 py-3.5 align-middle sm:px-5">
        <Link
          href={href}
          className="line-clamp-2 font-semibold leading-snug hover:underline"
        >
          {p.eventTitle}
        </Link>
        {/* below lg the numeric columns fold into one line under the title */}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-secondary lg:hidden">
          <OutcomeChip label={p.outcomeLabel} />
          <span className="tabular-nums">
            {p.shares.toFixed(1)} shares @ {formatNaira(p.priceKobo)} ·{" "}
            {formatNaira(p.stakeKobo)} staked
          </span>
        </p>
        {opened && (
          <p className="mt-1 hidden text-xs text-secondary lg:block">
            Opened {opened}
          </p>
        )}
      </td>
      <td className="hidden px-3 py-3.5 align-middle lg:table-cell">
        <div className="w-28">
          <OutcomeChip label={p.outcomeLabel} />
          <ProbabilityBar
            pct={entryPct}
            tone={outcomeBarTone(p.outcomeLabel)}
            className="mt-2"
          />
        </div>
      </td>
      <td className="hidden whitespace-nowrap px-3 py-3.5 text-right align-middle tabular-nums lg:table-cell">
        {p.shares.toFixed(1)}
      </td>
      <td className="hidden whitespace-nowrap px-3 py-3.5 text-right align-middle lg:table-cell">
        <span className="tabular-nums">{formatNaira(p.priceKobo)}</span>
        <span className="mt-0.5 block text-xs tabular-nums text-secondary">
          {entryPct}% chance
        </span>
      </td>
      <td className="hidden whitespace-nowrap px-3 py-3.5 text-right align-middle tabular-nums lg:table-cell">
        {formatNaira(p.stakeKobo)}
      </td>
      <td className="whitespace-nowrap px-4 py-3.5 text-right align-middle sm:px-5 lg:px-3">
        <span className="font-semibold tabular-nums">
          {formatNaira(p.potentialPayoutKobo)}
        </span>
        <span className="mt-0.5 block text-xs tabular-nums text-yes">
          {formatNairaSigned(p.potentialPayoutKobo - p.stakeKobo)} net
        </span>
      </td>
      <td className="hidden py-3.5 pl-3 pr-5 text-right align-middle lg:table-cell">
        <Link
          href={href}
          aria-label={`View ${p.eventTitle}`}
          className="inline-flex h-8 items-center gap-1 rounded-sm bg-element-2 px-3 text-[13px] font-semibold text-primary transition-colors hover:bg-element-3"
        >
          View
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </td>
    </tr>
  );
}

/* ---------- settled ---------- */

interface Settlement {
  label: string;
  icon: HeroIcon;
  pill: string;
  /** What landed in the credit balance, in kobo. */
  creditedKobo: number;
  creditedNote: string;
  creditedTone: string;
  /** Credited minus staked, in kobo. */
  netKobo: number;
}

/**
 * What a settled position came to. Mirrors the server's settlement: a win
 * credits the position's potential payout, a void refunds the stake, and
 * a loss credits nothing.
 */
function settlementOf(p: LocalPosition): Settlement {
  switch (p.status) {
    case "won":
      return {
        label: "Won",
        icon: CircleCheck,
        pill: "bg-yes-tint text-yes",
        creditedKobo: p.potentialPayoutKobo,
        creditedNote: "paid to your credit balance",
        creditedTone: "text-yes",
        netKobo: p.potentialPayoutKobo - p.stakeKobo,
      };
    case "lost":
      return {
        label: "Lost",
        icon: CircleX,
        pill: "bg-no-tint text-no",
        creditedKobo: 0,
        creditedNote: "paid out",
        creditedTone: "text-secondary",
        netKobo: -p.stakeKobo,
      };
    default:
      return {
        label: "Refunded",
        icon: RotateCcw,
        pill: "bg-element-2 text-secondary",
        creditedKobo: p.stakeKobo,
        creditedNote: "refunded to your credit balance",
        creditedTone: "text-primary",
        netKobo: 0,
      };
  }
}

function netText(kobo: number): string {
  return kobo === 0 ? formatNaira(0) : formatNairaSigned(kobo);
}

function netTone(kobo: number): string {
  if (kobo > 0) return "text-yes";
  if (kobo < 0) return "text-no";
  return "text-primary";
}

export function SettledPositions({
  positions,
  loading,
  error,
}: LoadState & { positions: LocalPosition[] }) {
  if (positions.length === 0) {
    return (
      unloadedState({ loading, error }) ?? (
        <EmptyState icon={Receipt} title="Nothing settled yet">
          When a market you hold resolves, its receipt lands here and any
          winnings go straight to your credit balance.
        </EmptyState>
      )
    );
  }

  const results = positions.map(settlementOf);
  const count = (label: string) => results.filter((r) => r.label === label).length;
  const netKobo = results.reduce((s, r) => s + r.netKobo, 0);

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="Settlement summary"
        className={`${CARD} flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8`}
      >
        <div className="max-w-xl">
          <h2 className="text-[15px] font-semibold">How settlement works</h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-secondary">
            When a market resolves, each winning share pays{" "}
            {formatNaira(PAYOUT_PER_SHARE_KOBO)} straight to your credit
            balance and losing shares pay nothing. A voided market refunds the
            stake.
          </p>
        </div>
        <dl className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <Tally term="Won" value={String(count("Won"))} />
          <Tally term="Lost" value={String(count("Lost"))} />
          <Tally term="Refunded" value={String(count("Refunded"))} />
          <Tally term="Net result" value={netText(netKobo)} tone={netTone(netKobo)} />
        </dl>
      </section>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {positions.map((p, i) => (
          <li key={p.id} className="min-w-0">
            <SettlementReceipt position={p} settlement={results[i]} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tally({
  term,
  value,
  tone = "text-primary",
}: {
  term: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <dt className={LABEL}>{term}</dt>
      <dd className={`mt-1 text-[15px] font-semibold tabular-nums ${tone}`}>
        {value}
      </dd>
    </div>
  );
}

/** One settled position, laid out as a receipt. */
function SettlementReceipt({
  position: p,
  settlement: s,
}: {
  position: LocalPosition;
  settlement: Settlement;
}) {
  const Icon = s.icon;
  const settledOn = formatDay(p.settledAt);
  const openedOn = formatDay(p.createdAt);

  return (
    <article
      aria-label={`${s.label}: ${p.outcomeLabel} on ${p.eventTitle}`}
      className={`${CARD} flex h-full flex-col p-4 sm:p-5`}
    >
      <header className="flex items-center justify-between gap-3">
        <span
          className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-semibold ${s.pill}`}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {s.label}
        </span>
        {settledOn && p.settledAt && (
          <time dateTime={p.settledAt} className="text-xs text-secondary">
            Settled {settledOn}
          </time>
        )}
      </header>

      <h3 className="mt-3 text-[15px] font-semibold leading-snug">
        <Link href={`/local/${p.eventSlug}`} className="line-clamp-2 hover:underline">
          {p.eventTitle}
        </Link>
      </h3>
      <p className="mt-2 flex min-w-0 items-center gap-2 text-[13px] text-secondary">
        Your pick
        <OutcomeChip label={p.outcomeLabel} />
      </p>

      <dl className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-[13px]">
        <ReceiptLine
          term="Shares"
          value={`${p.shares.toFixed(1)} @ ${formatNaira(p.priceKobo)}`}
        />
        <ReceiptLine term="Staked" value={formatNaira(p.stakeKobo)} />
        <ReceiptLine
          term="Net result"
          value={netText(s.netKobo)}
          tone={netTone(s.netKobo)}
        />
      </dl>

      <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
        <span
          className={`text-2xl font-semibold tabular-nums tracking-tight ${s.creditedTone}`}
        >
          {formatNaira(s.creditedKobo)}
        </span>
        <span className="text-xs text-secondary">{s.creditedNote}</span>
      </p>

      {/* the receipt's stub: the reference support needs, and when it began */}
      <footer className="mt-auto pt-4">
        <div className="flex items-center justify-between gap-3 border-t border-dashed border-border pt-3 text-xs text-secondary">
          <span className="font-mono" title={p.id}>
            Ref {p.id.slice(-8)}
          </span>
          {openedOn && <span>Opened {openedOn}</span>}
        </div>
      </footer>
    </article>
  );
}

function ReceiptLine({
  term,
  value,
  tone = "text-primary",
}: {
  term: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-secondary">{term}</dt>
      <dd className={`font-medium tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}
