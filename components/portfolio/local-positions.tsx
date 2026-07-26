"use client";

import { useState } from "react";
import Link from "next/link";
import { formatNaira } from "@/lib/format";
import { useLocalPortfolio, type LocalPosition } from "@/lib/local-trades";

const TABS = ["Open", "Settled"] as const;
type Tab = (typeof TABS)[number];

/**
 * Local (naira) book inside the portfolio: every position taken against
 * Worldstreet on a Bayse market. Positions are held to settlement, so
 * there is no live mark here — an open row shows what it cost and what
 * it pays if it wins, and a settled row shows what actually landed.
 * Open and settled are separate tabs — the settled list only grows, and
 * it shouldn't push what's still live off the screen.
 */
export function LocalPositions() {
  const { positions, loading, error } = useLocalPortfolio(true);
  const [tab, setTab] = useState<Tab>("Open");

  const open = positions.filter((p) => p.status === "open");
  const settled = positions.filter((p) => p.status !== "open");
  const stakedKobo = open.reduce((s, p) => s + p.stakeKobo, 0);
  const potentialKobo = open.reduce((s, p) => s + p.potentialPayoutKobo, 0);

  // someone whose bets have all resolved lands on an empty Open tab —
  // show them the book they actually have
  const active = tab === "Open" && open.length === 0 && settled.length > 0
    ? "Settled"
    : tab;
  const rows = active === "Open" ? open : settled;

  return (
    <>
      {/* the naira balance itself is a page-level card — these are what
          the open stakes represent */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat label="Staked (open)" value={formatNaira(stakedKobo)} />
        <Stat
          label="Pays if all win"
          value={formatNaira(potentialKobo)}
          tone="text-yes"
        />
      </div>

      {error && (
        <p className="mt-4 text-sm font-semibold text-no">{error}</p>
      )}

      {positions.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-secondary">
            {loading ? "Loading…" : "No Local positions yet."}
          </p>
          <Link
            href="/?category=local"
            className="mt-4 inline-flex h-9 items-center rounded-md bg-element-2 px-4 text-sm font-semibold text-secondary hover:bg-element-3 hover:text-primary"
          >
            Browse Local markets
          </Link>
        </div>
      ) : (
        <div className="mt-6">
          <div className="flex gap-1.5">
            {TABS.map((t) => {
              const count = t === "Open" ? open.length : settled.length;
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition-colors ${
                    active === t
                      ? "bg-element-3 text-primary"
                      : "text-secondary hover:bg-element-2 hover:text-primary"
                  }`}
                >
                  {t}
                  <span className="text-tertiary">{count}</span>
                </button>
              );
            })}
          </div>

          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-secondary">
              {active === "Open"
                ? "No open positions."
                : "Nothing settled yet."}
            </p>
          ) : (
            <ul className="mt-1 flex flex-col">
              {rows.map((p) => (
                <PositionRow key={p.id} position={p} />
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

function PositionRow({ position: p }: { position: LocalPosition }) {
  const settlement = settlementOf(p);
  return (
    <li className="flex items-center gap-3 border-b border-border py-3.5 last:border-0">
      <div className="min-w-0 flex-1">
        <Link
          href={`/local/${p.eventSlug}`}
          className="block truncate text-sm font-semibold hover:underline"
        >
          {p.eventTitle}
        </Link>
        <p className="mt-0.5 text-[13px] font-medium text-tertiary">
          <span className="text-primary">{p.outcomeLabel}</span> ·{" "}
          {p.shares.toFixed(1)} shares @ {formatNaira(p.priceKobo)} ·{" "}
          {formatNaira(p.stakeKobo)} staked
        </p>
      </div>
      <div className="text-right">
        <p className={`text-sm font-semibold ${settlement.tone}`}>
          {settlement.amount}
        </p>
        <p className="text-[13px] font-medium text-tertiary">
          {settlement.label}
        </p>
      </div>
    </li>
  );
}

/** Right-hand column: what an open row could pay, or what a settled one did. */
function settlementOf(p: LocalPosition): {
  amount: string;
  label: string;
  tone: string;
} {
  switch (p.status) {
    case "won":
      return {
        amount: `+${formatNaira(p.potentialPayoutKobo)}`,
        label: "Won",
        tone: "text-yes",
      };
    case "lost":
      return {
        amount: `−${formatNaira(p.stakeKobo)}`,
        label: "Lost",
        tone: "text-no",
      };
    case "voided":
      return {
        amount: formatNaira(p.stakeKobo),
        label: "Refunded",
        tone: "text-primary",
      };
    default:
      return {
        amount: formatNaira(p.potentialPayoutKobo),
        label: "To win",
        tone: "text-primary",
      };
  }
}

function Stat({
  label,
  value,
  tone = "text-primary",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <p className="text-[13px] font-medium text-secondary">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
