"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Wallet } from "lucide-react";
import { isBinary, type MarketEvent } from "@/types/market";
import { ApiError } from "@/lib/api-client";
import { formatNaira } from "@/lib/format";
import { usePageNow } from "@/lib/use-now";
import { useAuth } from "@/components/auth/auth-context";
import { useTradeSelection } from "@/components/event/trade-context";
import { EventIcon } from "@/components/market/event-icon";
import { FundNairaModal } from "@/components/local/fund-naira-modal";
import {
  newIdempotencyKey,
  refreshNairaWallet,
  useNairaWallet,
} from "@/lib/naira-wallet";
import { payoutFor, placeLocalTrade, priceToKobo } from "@/lib/local-trades";

/**
 * Trade panel for Local (Bayse) markets. Worldstreet is the
 * counterparty: the stake leaves the naira wallet now and a winning
 * share pays ₦100 at settlement. Hold-to-settlement only — there is no
 * sell side in v1, so the panel is a stake box, not a Buy/Sell pair.
 *
 * The price shown here comes from the page's cached Bayse fetch, so it
 * can be up to a minute old. Every order carries that price; the server
 * re-prices live and bounces anything that drifted past its tolerance,
 * which lands here as an explicit "confirm at the new price" step.
 */

/** Bayse's own floor, mirrored so the panel can explain it before submitting. */
const MIN_STAKE_KOBO = 10_000; // ₦100
const QUICK_ADD_KOBO = [50_000, 100_000, 500_000]; // ₦500 / ₦1,000 / ₦5,000

export function LocalTradePanel({ event }: { event: MarketEvent }) {
  const { marketId, side, setSide } = useTradeSelection();
  const { user, openAuth } = useAuth();
  const { balanceKobo } = useNairaWallet(Boolean(user));
  const now = usePageNow();

  // Kept as typed text so a half-entered "1500." survives the keystroke;
  // kobo is derived, and kobo is what the API is told.
  const [stakeText, setStakeText] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  /**
   * The last failed attempt, tagged with the order it belongs to. Change
   * the market, side, or stake and it stops applying — that's how the
   * re-price confirmation and the shortfall prompt clear themselves
   * without an effect chasing every input.
   */
  const [attempt, setAttempt] = useState<{
    orderKey: string;
    error: string;
    /** Fresh server price to confirm, when the quote moved under us. */
    confirmPriceKobo: number | null;
    /** Kobo short of the stake, when the balance couldn't cover it. */
    shortfallKobo: number | null;
  } | null>(null);
  /**
   * Rotated after every committed trade so re-staking the identical
   * order isn't deduped as a retry of the one already placed.
   */
  const [tradeNonce, setTradeNonce] = useState(() =>
    newIdempotencyKey().slice(0, 8),
  );

  const typedNaira = parseFloat(stakeText);
  const stakeKobo =
    Number.isFinite(typedNaira) && typedNaira > 0
      ? Math.round(Math.min(typedNaira, 500_000) * 100)
      : 0;
  const setStakeKobo = (kobo: number) => setStakeText(String(kobo / 100));

  const market = event.markets.find((m) => m.id === marketId) ?? event.markets[0];
  const labels = market.outcomeLabels ?? ["Yes", "No"];
  const sideIndex = side === "yes" ? 0 : 1;

  // One key per (order, nonce): stable while the user is looking at the
  // same order — so a re-confirm or a retry is idempotent — and new the
  // moment any part of the order changes.
  const orderKey = `${tradeNonce}:${market.id}:${side}:${stakeKobo}`;
  const failure = attempt?.orderKey === orderKey ? attempt : null;

  const shownPriceKobo = priceToKobo(market.outcomePrices[sideIndex]);
  const priceKobo = failure?.confirmPriceKobo ?? shownPriceKobo;
  const payoutKobo = stakeKobo > 0 ? payoutFor(stakeKobo, priceKobo) : 0;

  const tradeable = Boolean(market.outcomeIds);
  const closesMs = event.closesAt ? Date.parse(event.closesAt) : NaN;
  const closed =
    !Number.isNaN(closesMs) && now !== null && now >= closesMs;

  useEffect(() => {
    if (!confirmation) return;
    const t = setTimeout(() => setConfirmation(null), 6000);
    return () => clearTimeout(t);
  }, [confirmation]);

  const submit = async () => {
    if (!market.outcomeIds || stakeKobo < MIN_STAKE_KOBO || pending) return;
    setPending(true);
    setAttempt(null);
    try {
      const res = await placeLocalTrade({
        eventId: event.id,
        marketId: market.id,
        outcomeId: market.outcomeIds[sideIndex],
        stakeKobo,
        expectedPriceKobo: priceKobo,
        idempotencyKey: orderKey,
      });
      const { position } = res;
      setConfirmation(
        res.alreadyProcessed
          ? "That trade was already placed."
          : `${position.shares.toFixed(1)} ${position.outcomeLabel} shares at ${formatNaira(
              position.priceKobo,
            )} — pays ${formatNaira(position.potentialPayoutKobo)} if it wins`,
      );
      if (res.alreadyProcessed) void refreshNairaWallet();
      // money committed: the next order must not reuse this key
      setStakeText("");
      setTradeNonce(newIdempotencyKey().slice(0, 8));
    } catch (err) {
      setAttempt({ orderKey, ...describeFailure(err) });
    } finally {
      setPending(false);
    }
  };

  /** Turn the API's failure codes into something actionable in the panel. */
  const describeFailure = (err: unknown) => {
    if (!(err instanceof ApiError)) {
      return {
        error: "Trade failed. Please try again.",
        confirmPriceKobo: null,
        shortfallKobo: null,
      };
    }
    const fresh = err.details?.freshPriceKobo;
    if (err.code === "PRICE_MOVED" && typeof fresh === "number") {
      return {
        error: `Price moved to ${formatNaira(fresh)} per share — confirm to trade at it.`,
        confirmPriceKobo: fresh,
        shortfallKobo: null,
      };
    }
    if (err.code === "INSUFFICIENT_FUNDS") {
      void refreshNairaWallet();
      return {
        error: "Not enough naira for this stake.",
        confirmPriceKobo: null,
        shortfallKobo: Math.max(0, stakeKobo - (balanceKobo ?? 0)),
      };
    }
    return { error: err.message, confirmPriceKobo: null, shortfallKobo: null };
  };

  const belowMin = stakeKobo > 0 && stakeKobo < MIN_STAKE_KOBO;
  const disabled = stakeKobo < MIN_STAKE_KOBO || pending || closed || !tradeable;

  return (
    <aside className="w-full lg:w-[306px] lg:shrink-0">
      <div className="rounded-xl border border-border bg-surface p-4 shadow-card lg:sticky lg:top-[124px]">
        {/* what's being traded */}
        <div className="flex items-center gap-2.5">
          <EventIcon event={event} className="size-9 rounded-md text-lg" px={36} />
          <div className="min-w-0 text-sm font-semibold leading-tight">
            <p className="truncate text-secondary">{event.title}</p>
            {!isBinary(event) && (
              <p className="truncate">
                {market.groupItemTitle}
                <span className={side === "yes" ? "text-yes" : "text-no"}>
                  {" "}
                  · {labels[sideIndex]}
                </span>
              </p>
            )}
          </div>
        </div>

        {/* side */}
        <div className="mt-4 flex gap-2">
          <SideToggle
            label={`${labels[0]} · ${formatNaira(priceToKobo(market.outcomePrices[0]))}`}
            active={side === "yes"}
            activeClass="bg-yes-solid text-white"
            onClick={() => setSide("yes")}
          />
          <SideToggle
            label={`${labels[1]} · ${formatNaira(priceToKobo(market.outcomePrices[1]))}`}
            active={side === "no"}
            activeClass="bg-no-solid text-white"
            onClick={() => setSide("no")}
          />
        </div>

        {/* stake */}
        <div className="mt-4 flex items-center justify-between">
          <div>
            <span className="text-base font-semibold">Stake</span>
            {user && (
              <p className="text-xs font-medium text-tertiary">
                {balanceKobo === null ? "—" : formatNaira(balanceKobo)} available
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-3xl font-semibold text-tertiary">₦</span>
            <input
              inputMode="decimal"
              aria-label="Stake in naira"
              value={stakeText}
              placeholder="0"
              onChange={(e) =>
                setStakeText(e.target.value.replace(/[^0-9.]/g, "").slice(0, 10))
              }
              className={`w-36 bg-transparent text-right text-3xl font-semibold outline-none placeholder:text-border-active ${
                stakeKobo === 0 ? "text-border-active" : "text-primary"
              }`}
            />
          </div>
        </div>

        <div className="mt-3 flex justify-end gap-1.5">
          {QUICK_ADD_KOBO.map((v) => (
            <QuickChip
              key={v}
              label={`+${formatNaira(v)}`}
              onClick={() => setStakeKobo(stakeKobo + v)}
            />
          ))}
          {balanceKobo !== null && balanceKobo > 0 && (
            <QuickChip label="Max" onClick={() => setStakeKobo(balanceKobo)} />
          )}
        </div>

        {/* action */}
        {!user ? (
          <button
            onClick={openAuth}
            className="mt-4 h-11 w-full rounded-md bg-accent text-base font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            Log in to Trade
          </button>
        ) : (
          <button
            disabled={disabled}
            onClick={() => void submit()}
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-accent text-base font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {closed
              ? "Trading closed"
              : !tradeable
                ? "Not tradeable"
                : failure?.confirmPriceKobo
                  ? `Confirm at ${formatNaira(failure.confirmPriceKobo)}`
                  : "Place trade"}
          </button>
        )}

        {belowMin && !failure && (
          <p className="mt-3 text-center text-sm font-semibold text-secondary">
            Minimum stake is {formatNaira(MIN_STAKE_KOBO)}
          </p>
        )}
        {failure && (
          <p className="mt-3 text-center text-sm font-semibold text-no">
            {failure.error}
          </p>
        )}
        {failure?.shortfallKobo !== undefined &&
          failure?.shortfallKobo !== null && (
            <button
              onClick={() => setFunding(true)}
              className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-element-2 text-sm font-semibold text-primary hover:bg-element-3"
            >
              <Wallet className="size-4" />
              Add naira
            </button>
          )}
        {confirmation && (
          <p className="mt-3 flex items-start justify-center gap-1.5 text-center text-sm font-semibold text-yes">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            {confirmation}
          </p>
        )}

        {payoutKobo > 0 && !confirmation && (
          <p className="mt-3 text-center text-sm font-semibold">
            <span className="text-secondary">To win </span>
            <span className="text-yes">{formatNaira(payoutKobo)}</span>
          </p>
        )}

        <p className="mt-3 text-center text-xs leading-5 text-tertiary">
          Prices are ₦ per ₦100 share, live from Bayse. Positions are held
          to settlement — no selling back yet.
        </p>

        {user && balanceKobo !== null && !failure?.shortfallKobo && (
          <button
            onClick={() => setFunding(true)}
            className="mt-2 w-full text-center text-xs font-semibold text-accent hover:underline"
          >
            Manage naira balance
          </button>
        )}
      </div>

      <FundNairaModal
        open={funding}
        onClose={() => setFunding(false)}
        neededKobo={failure?.shortfallKobo ?? undefined}
      />
    </aside>
  );
}

function QuickChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-[30px] rounded-md bg-element-2 px-2.5 text-xs font-semibold text-secondary hover:bg-element-3"
    >
      {label}
    </button>
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
