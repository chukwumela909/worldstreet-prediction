"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { isBinary, type MarketEvent } from "@/types/market";
import { toCents } from "@/lib/format";
import { useAuth } from "@/components/auth/auth-context";
import { useTradeSelection } from "./trade-context";

const QUICK_ADD = [1, 5, 10, 100];

/**
 * Sticky right-rail trade panel (~306px):
 * Buy/Sell tabs · Market dropdown · Yes/No toggle (selected = solid) ·
 * amount + quick chips · To win · Trade button.
 */
export function TradePanel({ event }: { event: MarketEvent }) {
  const { marketId, side, setSide } = useTradeSelection();
  const { user, openAuth } = useAuth();
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState(0);

  const market = event.markets.find((m) => m.id === marketId) ?? event.markets[0];
  const price = parseFloat(market.outcomePrices[side === "yes" ? 0 : 1]);
  const toWin = amount > 0 ? amount / price : 0;

  return (
    <aside className="w-full lg:w-[306px] lg:shrink-0">
      <div className="lg:sticky lg:top-[124px] rounded-xl border border-border bg-surface p-4 shadow-card">
        {/* market being traded */}
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-element-2 text-lg">
            {event.icon}
          </span>
          <div className="min-w-0 text-sm font-semibold leading-tight">
            <p className="truncate text-secondary">{event.title}</p>
            {!isBinary(event) && (
              <p className="truncate">
                {market.groupItemTitle}
                <span className={side === "yes" ? "text-yes" : "text-no"}>
                  {" "}· {side === "yes" ? "Yes" : "No"}
                </span>
              </p>
            )}
          </div>
        </div>

        {/* buy/sell + order type */}
        <div className="mt-3 flex items-center justify-between border-b border-border">
          <div className="flex gap-4">
            {(["buy", "sell"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`border-b-2 pb-2 text-base font-semibold capitalize transition-colors ${
                  mode === m
                    ? "border-primary text-primary"
                    : "border-transparent text-secondary hover:text-primary"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <button className="flex items-center gap-1 pb-2 text-sm font-semibold text-secondary">
            Market <ChevronDown className="size-4" />
          </button>
        </div>

        {/* yes/no toggle */}
        <div className="mt-4 flex gap-2">
          <SideToggle
            label={`Yes ${toCents(market.outcomePrices[0])}`}
            active={side === "yes"}
            activeClass="bg-yes-solid text-white"
            onClick={() => setSide("yes")}
          />
          <SideToggle
            label={`No ${toCents(market.outcomePrices[1])}`}
            active={side === "no"}
            activeClass="bg-no-solid text-white"
            onClick={() => setSide("no")}
          />
        </div>

        {/* amount */}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-base font-semibold">Amount</span>
          <input
            inputMode="decimal"
            value={`$${amount}`}
            onChange={(e) => {
              const n = parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
              setAmount(Number.isNaN(n) ? 0 : Math.min(n, 99999));
            }}
            className={`w-40 bg-transparent text-right text-4xl font-semibold outline-none ${
              amount === 0 ? "text-border-active" : "text-primary"
            }`}
            aria-label="Amount in dollars"
          />
        </div>

        {/* quick add chips */}
        <div className="mt-3 flex justify-end gap-1.5">
          {QUICK_ADD.map((v) => (
            <button
              key={v}
              onClick={() => setAmount((a) => Math.min(a + v, 99999))}
              className="h-[30px] rounded-md bg-element-2 px-2.5 text-xs font-semibold text-secondary hover:bg-element-3"
            >
              +${v}
            </button>
          ))}
        </div>

        {/* trade — signed out it becomes the auth CTA, like the real site */}
        {user ? (
          <button
            disabled={amount === 0}
            className="mt-4 h-11 w-full rounded-md bg-accent text-base font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
          >
            Trade
          </button>
        ) : (
          <button
            onClick={openAuth}
            className="mt-4 h-11 w-full rounded-md bg-accent text-base font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            Log in to Trade
          </button>
        )}

        {toWin > 0 && mode === "buy" && (
          <p className="mt-3 text-center text-sm font-semibold">
            <span className="text-secondary">To win </span>
            <span className="text-yes">
              ${toWin.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </span>
          </p>
        )}

        <p className="mt-3 text-center text-xs text-tertiary">
          By trading, you agree to the Terms of Use.
        </p>
      </div>
    </aside>
  );
}

function SideToggle({
  label,
  active,
  activeClass,
  onClick,
}: {
  label: string;
  active: boolean;
  activeClass: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-11 flex-1 rounded-sm text-sm font-semibold transition-colors ${
        active
          ? activeClass
          : "bg-element-2 text-secondary hover:bg-element-3 hover:text-primary"
      }`}
    >
      {label}
    </button>
  );
}
