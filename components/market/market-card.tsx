import Link from "next/link";
import { Bookmark, Gift } from "lucide-react";
import { isBinary, type Market, type MarketEvent } from "@/types/market";
import { formatVolume, toPercent } from "@/lib/format";

/**
 * Market card — the atomic unit of the home grid (~299×180 on desktop).
 * Binary events: title + semicircle gauge + Buy Yes/No buttons.
 * Multi-outcome events: scrollable outcome rows with mini Yes/No pills.
 * Specs: docs/polymarket-recon.md §7.
 */
export function MarketCard({ event }: { event: MarketEvent }) {
  return (
    <article className="flex h-[180px] flex-col rounded-xl border border-border bg-surface p-3 shadow-card transition-colors hover:border-border-hover">
      {isBinary(event) ? <BinaryBody event={event} /> : <MultiBody event={event} />}
      <footer className="mt-auto flex items-center justify-between pt-2">
        <span className="text-xs font-medium text-tertiary">
          {formatVolume(event.volume)}
        </span>
        <span className="flex items-center gap-2 text-tertiary">
          <Gift className="size-3.5 cursor-pointer hover:text-secondary" />
          <Bookmark className="size-3.5 cursor-pointer hover:text-secondary" />
        </span>
      </footer>
    </article>
  );
}

/* ---------- binary ---------- */

function BinaryBody({ event }: { event: MarketEvent }) {
  const market = event.markets[0];
  const pct = toPercent(market.outcomePrices[0]);
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <CardTitle event={event} />
        <Gauge pct={pct} />
      </div>
      <div className="mt-auto flex gap-2 pt-2">
        <BuyButton side="yes" label="Buy Yes" />
        <BuyButton side="no" label="Buy No" />
      </div>
    </>
  );
}

/** Semicircular probability gauge with % + "chance" label. */
function Gauge({ pct }: { pct: number }) {
  // semicircle of radius 20, circumference/2 ≈ 62.8
  const half = Math.PI * 20;
  return (
    <div className="relative flex w-14 shrink-0 flex-col items-center">
      <svg viewBox="0 0 48 26" className="w-14">
        <path
          d="M 4 24 A 20 20 0 0 1 44 24"
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          className="stroke-element-3"
        />
        <path
          d="M 4 24 A 20 20 0 0 1 44 24"
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * half} ${half}`}
          className={pct >= 50 ? "stroke-yes" : "stroke-no"}
        />
      </svg>
      <span className="absolute top-2.5 text-[15px] font-semibold leading-none">
        {pct}%
      </span>
      <span className="text-[10px] font-medium text-secondary">chance</span>
    </div>
  );
}

/* ---------- multi-outcome ---------- */

function MultiBody({ event }: { event: MarketEvent }) {
  // fade the bottom edge when rows overflow, so the hidden 4th+
  // outcome has a visible scroll affordance
  const overflows = event.markets.length > 3;
  return (
    <>
      <CardTitle event={event} />
      <ul
        className={`mt-2 flex flex-col gap-1 overflow-y-auto [scrollbar-width:thin] ${
          overflows
            ? "[mask-image:linear-gradient(to_bottom,black_calc(100%-14px),transparent)]"
            : ""
        }`}
      >
        {event.markets.map((m) => (
          <OutcomeRow key={m.id} market={m} />
        ))}
      </ul>
    </>
  );
}

function OutcomeRow({ market }: { market: Market }) {
  const pct = toPercent(market.outcomePrices[0]);
  const name = market.groupItemTitle ?? market.question;
  return (
    <li className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {name}
      </span>
      <span className="text-sm font-semibold">{pct}%</span>
      <span className="flex gap-1">
        <BuyButton side="yes" label="Yes" outcome={name} mini />
        <BuyButton side="no" label="No" outcome={name} mini />
      </span>
    </li>
  );
}

/* ---------- shared ---------- */

function CardTitle({ event }: { event: MarketEvent }) {
  return (
    <Link
      href={`/event/${event.slug}`}
      className="flex min-w-0 items-center gap-2.5"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-element-2 text-xl">
        {event.icon}
      </span>
      <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-primary">
        {isBinary(event) ? event.markets[0].question : event.title}
      </h3>
    </Link>
  );
}

/**
 * Buy button state model (recon §7):
 * rest = colored text on 15% tint · hover/selected = white on solid -400.
 */
function BuyButton({
  side,
  label,
  outcome,
  mini = false,
}: {
  side: "yes" | "no";
  label: string;
  outcome?: string;
  mini?: boolean;
}) {
  const palette =
    side === "yes"
      ? "bg-yes-tint text-yes hover:bg-yes-solid"
      : "bg-no-tint text-no hover:bg-no-solid";
  const size = mini
    ? "h-6 rounded-xs px-2 text-xs"
    : "h-10 flex-1 rounded-sm text-sm";
  return (
    <button
      aria-label={outcome ? `Buy ${side} on ${outcome}` : undefined}
      className={`${size} ${palette} font-semibold transition-colors hover:text-white`}
    >
      {label}
    </button>
  );
}
