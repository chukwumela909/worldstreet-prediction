"use client";

import { useState } from "react";
import Link from "next/link";
import { describeRate, useAdminMoney } from "@/lib/admin-money";

/**
 * The desk's "₦ | $" switch, in the admin chrome. Dollars need a
 * conversion rate; until one is set the $ side stays greyed out, and
 * pressing it says why (a title alone never shows on a phone).
 * `explainMissingRate` keeps "Set a conversion rate first" on show
 * whenever the API says there is no rate — the sidebar has the room.
 */
export function CurrencySwitch({
  align = "start",
  explainMissingRate = false,
}: {
  align?: "start" | "end";
  explainMissingRate?: boolean;
}) {
  const money = useAdminMoney();
  const [pressed, setPressed] = useState(false);
  const usdReady = money.rate !== null;
  const noRate = money.fxStatus === "ready" && !usdReady;
  const hint = pressed || (explainMissingRate && noRate);
  const loadingRate = money.fxStatus === "idle" || money.fxStatus === "loading";

  const reason = loadingRate
    ? "Loading the conversion rate…"
    : money.fxStatus === "failed"
      ? "Couldn't load the conversion rate"
      : "Set a conversion rate first";

  const segment = (active: boolean, disabled = false) =>
    `h-7 min-w-9 rounded-sm px-2.5 text-xs font-semibold transition-colors ${
      active
        ? "bg-surface text-primary shadow-card"
        : disabled
          ? "cursor-not-allowed text-tertiary opacity-50"
          : "text-secondary hover:text-primary"
    }`;

  return (
    <div className={`flex flex-col gap-1 ${align === "end" ? "items-end" : "items-start"}`}>
      <div
        role="group"
        aria-label="Show amounts in"
        className="inline-flex shrink-0 rounded-md bg-element-2 p-0.5"
      >
        <button
          type="button"
          aria-pressed={money.currency === "ngn"}
          title="Show amounts in naira"
          onClick={() => {
            money.setCurrency("ngn");
            setPressed(false);
          }}
          className={segment(money.currency === "ngn")}
        >
          ₦
        </button>
        <button
          type="button"
          aria-pressed={money.currency === "usd"}
          aria-disabled={!usdReady}
          title={usdReady && money.fx ? `Show amounts in dollars — ${describeRate(money.fx)}` : reason}
          onClick={() => {
            if (usdReady) money.setCurrency("usd");
            else setPressed(true);
          }}
          className={segment(money.currency === "usd", !usdReady)}
        >
          $
        </button>
      </div>
      {hint && !usdReady && (
        <p className="text-[11px] font-medium text-tertiary" role="status">
          {noRate ? (
            <Link href="/admin#conversion-rate" className="hover:text-primary hover:underline">
              {reason}
            </Link>
          ) : (
            reason
          )}
        </p>
      )}
    </div>
  );
}

/**
 * "At ₦1,450/$ (rate set Jul 25)" — the quiet line money-heavy panels
 * carry while amounts are in dollars, so a converted figure is never
 * read without the rate behind it. Renders nothing in naira.
 */
export function UsdRateNote({ className = "" }: { className?: string }) {
  const money = useAdminMoney();
  if (money.currency !== "usd" || !money.fx) return null;
  return (
    <p className={`text-xs font-medium text-tertiary ${className}`}>
      {describeRate(money.fx)}
    </p>
  );
}
