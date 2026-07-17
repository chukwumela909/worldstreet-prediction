import Link from "next/link";
import { Gift } from "lucide-react";
import { WatchButton } from "./watch-button";
import { isBinary, type Market, type MarketEvent } from "@/types/market";
import { formatVolume, toPercent } from "@/lib/format";
import { BuyButton } from "./buy-button";

/**
 * Market card — the atomic unit of the home grid (~299×180 on desktop).
 * Binary events: title + probability gauge + Buy Yes/No buttons.
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
          <WatchButton slug={event.slug} />
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

/**
 * Probability gauge, measured from the live card DOM + source (recon §7):
 * r=29 arc spanning 200° (each end dips 10° below horizontal), stroke 4.5
 * round-capped, 12° gap between fill and track. Fill from the site's own
 * code: <30 red-500 · <50 amber-500 · else green-600, with
 * stroke-opacity = |p−50|/50 × 0.45 + 0.55. The % sits inside the arc's
 * lower half; "chance" hangs directly below the svg.
 */
const GAUGE_R = 29;
const GAUGE_SWEEP = 200;

/** point at `a` degrees along the arc (0 = left end, 200 = right end) */
function gaugePoint(a: number): [number, number] {
  const phi = ((190 - a) * Math.PI) / 180;
  return [GAUGE_R * Math.cos(phi), -GAUGE_R * Math.sin(phi)];
}

function gaugeArc(a1: number, a2: number): string {
  const [x1, y1] = gaugePoint(a1);
  const [x2, y2] = gaugePoint(a2);
  const large = a2 - a1 > 180 ? 1 : 0;
  return `M ${x1.toFixed(3)} ${y1.toFixed(3)} A ${GAUGE_R} ${GAUGE_R} 0 ${large} 1 ${x2.toFixed(3)} ${y2.toFixed(3)}`;
}

function Gauge({ pct }: { pct: number }) {
  // measured endpoints: fill ends at (2p−7)°, track resumes at (2p+5)°
  const fillEnd = Math.min(pct * 2 - 7, GAUGE_SWEEP);
  const trackStart = Math.min(Math.max(pct * 2 + 5, 0), GAUGE_SWEEP);
  const fill =
    pct < 30
      ? "var(--red-500)"
      : pct < 50
        ? "var(--amber-500)"
        : "var(--green-600)";
  const opacity = (Math.abs(pct - 50) / 50) * 0.45 + 0.55;
  return (
    <div className="relative flex w-[58px] shrink-0 flex-col items-center">
      <svg
        width="58"
        height="34.04"
        viewBox="-29 -29 58 34.036"
        className="overflow-visible"
      >
        {trackStart < GAUGE_SWEEP && (
          <path
            d={gaugeArc(trackStart, GAUGE_SWEEP)}
            fill="none"
            strokeWidth="4.5"
            strokeLinecap="round"
            className="stroke-element-3"
          />
        )}
        {fillEnd > 0 && (
          <path
            d={gaugeArc(0, fillEnd)}
            fill="none"
            strokeWidth="4.5"
            strokeLinecap="round"
            stroke={fill}
            strokeOpacity={opacity}
          />
        )}
      </svg>
      <span className="absolute bottom-4 text-base font-medium leading-5">
        {pct}%
      </span>
      <span className="text-xs font-semibold leading-4 text-secondary">
        chance
      </span>
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

