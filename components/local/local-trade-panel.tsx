"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  CheckIcon as Check,
  ChevronDownIcon as ChevronDown,
  ChevronRightIcon as ChevronRight,
  ArrowPathIcon as Loader2,
  TicketIcon as Ticket,
  WalletIcon as Wallet,
  XMarkIcon as X,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import { isBinary, isLocalBook, type MarketEvent } from "@/types/market";
import { ApiError } from "@/lib/api-client";
import {
  CREDIT,
  formatNaira,
  formatNairaCompact,
  formatNairaSigned,
  toPercent,
} from "@/lib/format";
import { useTickingNow } from "@/lib/use-now";
import { tradingStopsAt } from "@/lib/countdown";
import { CloseCountdown } from "@/components/local/close-countdown";
import { useAuth } from "@/components/auth/auth-context";
import { useTradeSelection } from "@/components/event/trade-context";
import { SideToggle } from "@/components/event/trade-panel";
import { FundNairaModal } from "@/components/local/fund-naira-modal";
import {
  newIdempotencyKey,
  refreshNairaWallet,
  useNairaWallet,
} from "@/lib/naira-wallet";
import {
  PAYOUT_PER_SHARE_KOBO,
  payoutFor,
  placeLocalTrade,
  sharesFor,
  type LocalPosition,
} from "@/lib/local-trades";
import { useQuote } from "@/components/book-pricing";
import { formatQuote } from "@/lib/book";
import { toCents } from "@/lib/format";
import { TeamMark } from "@/components/sports/team-mark";

/**
 * The trade ticket on every market page, laid out as the reference
 * app's bet slip: Buy/Sell tabs and an order-type select, the
 * question, an outcome select on multi-market events, Yes/No answer
 * pills with their prices, the amount, a summary, then Review Buy →
 * review → confirm → a receipt.
 *
 * WorldStreet is the counterparty every time: the stake leaves the naira
 * wallet now and a winning share pays ₦100 at settlement (lib/book.ts).
 * The Local book always trades, at its own price. An international
 * (Polymarket) market trades the same way, at Polymarket's price plus the
 * house spread, only while the API's international-trading switch is on
 * (`useQuote().international`, read from GET /v1/markets/pricing). With
 * it off — or no API, or one too old to say — the slip is a display-only
 * mirror: the source's prices in cents, the amount locked and no way to
 * submit. Stake limits are the API's too. Hold-to-settlement only, at
 * the market — so Sell and Limit are drawn where the reference has them
 * but can't be picked yet.
 *
 * Prices poll (see useLiveLocalEvent) but are never authoritative: every
 * order carries the price it was shown at, the server re-prices live,
 * and anything that drifted past its tolerance comes back as an explicit
 * "confirm at the new price" step rather than a silent fill.
 *
 * Renders the body of the page's "Trade outcome" card; the card, its
 * title and the narrow-screen sheet come from MarketDetail.
 */

const QUICK_ADD_KOBO = [50_000, 100_000, 500_000]; // ₦500 / ₦1,000 / ₦5,000

const ORDER_TYPES: SelectOption[] = [
  { value: "market", label: "Market" },
  { value: "limit", label: "Limit", disabled: true, hint: "Coming soon" },
];

/* The reference's button family, on our tokens. Pills (rounded-full) are
   used exactly where the reference sets `shape="pill"`: the answer tabs
   and the Review button. */
const PRIMARY_PILL =
  "pressable flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent px-6 text-[14px] font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40";
const MUTED_PILL =
  "flex h-11 w-full cursor-not-allowed items-center justify-center rounded-full bg-element-2 px-6 text-[14px] font-semibold text-secondary";
const PRIMARY_MD =
  "pressable inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40";
const GHOST_MD =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm px-4 text-sm font-medium text-secondary transition-colors hover:bg-element-2 hover:text-primary disabled:pointer-events-none disabled:opacity-40";
const GHOST_SM =
  "inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-sm px-2 text-[12.5px] font-medium text-secondary transition-colors hover:bg-element-2 hover:text-primary disabled:pointer-events-none disabled:opacity-40";
const SECONDARY_MD =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-border bg-surface px-4 text-sm font-medium text-primary transition-colors hover:border-border-hover hover:bg-element-2";

/** "Oct 31, 2026" — the settlement date under Max payout and on the receipt. */
function dateLabel(iso: string | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(ms);
}

/** Shares are fractional here (the whole stake buys in): "16.39". */
function formatShares(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

interface Receipt {
  position: LocalPosition;
  alreadyProcessed: boolean;
  question: string;
  /** "Spain · Yes" on a multi-market event, the side's label otherwise. */
  prediction: string;
  side: "yes" | "no";
  dueLabel: string | null;
}

export function LocalTradePanel({ event }: { event: MarketEvent }) {
  // the stake limits are the API's: min so the ticket can explain the
  // floor before submitting, max so typing more clamps to it
  const { quoteKobo, international, minStakeKobo, maxStakeKobo } = useQuote();
  const { marketId, side, select, setSide } = useTradeSelection();
  const { user, openAuth } = useAuth();
  const { balanceKobo } = useNairaWallet(Boolean(user));
  const now = useTickingNow();
  const amountId = useId();

  // Kept as typed text so a half-entered "1500." survives the keystroke;
  // kobo is derived, and kobo is what the API is told.
  const [stakeText, setStakeText] = useState("");
  const [pending, setPending] = useState(false);
  /** Which step of Review Buy → review → confirm is open, if any. */
  const [step, setStep] = useState<"review" | "confirm" | null>(null);
  /** The order just placed, shown in the slip's place until "New trade". */
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  /** The credit wallet, opened with the shortfall it should cover. */
  const [funding, setFunding] = useState<{ neededKobo?: number } | null>(null);
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
      ? Math.round(Math.min(typedNaira * 100, maxStakeKobo))
      : 0;
  const setStakeKobo = (kobo: number) =>
    setStakeText(String(Math.min(kobo, maxStakeKobo) / 100));

  const binary = isBinary(event);
  const market = event.markets.find((m) => m.id === marketId) ?? event.markets[0];
  const labels = market.outcomeLabels ?? ["Yes", "No"];
  const sideIndex = side === "yes" ? 0 : 1;
  const marketLabel = market.groupItemTitle ?? market.question;
  const question = binary ? market.question : event.title;
  const prediction = binary ? labels[sideIndex] : `${marketLabel} · ${labels[sideIndex]}`;
  const dueLabel = dateLabel(event.closesAt ?? event.endDate);

  // A receipt belongs to the selection it was placed from: pick another
  // outcome (here or in the page's outcome list) and the slip comes back.
  const selectionKey = `${market.id}:${side}`;
  const [shownSelection, setShownSelection] = useState(selectionKey);
  if (shownSelection !== selectionKey) {
    setShownSelection(selectionKey);
    setReceipt(null);
  }

  // One key per (order, nonce): stable while the user is looking at the
  // same order — so a re-confirm or a retry is idempotent — and new the
  // moment any part of the order changes.
  const orderKey = `${tradeNonce}:${market.id}:${side}:${stakeKobo}`;
  const failure = attempt?.orderKey === orderKey ? attempt : null;

  const shownPriceKobo = quoteKobo(event, market.outcomePrices[sideIndex]);
  const priceKobo = failure?.confirmPriceKobo ?? shownPriceKobo;
  const shares = stakeKobo > 0 ? sharesFor(stakeKobo, priceKobo) : 0;
  const payoutKobo = stakeKobo > 0 ? payoutFor(stakeKobo, priceKobo) : 0;

  // an international market while the API's switch is off is shown, not
  // traded: nothing to submit
  const mirror = !isLocalBook(event) && !international;
  // no outcome ids or no quote: not on our book
  const tradeable = Boolean(market.outcomeIds) && shownPriceKobo > 0;
  // the team behind the picked outcome on a game, for the reference's crest
  const team = event.game?.teams.find((t) => t.name === market.groupItemTitle);
  /** An answer pill's price: our quote when it trades here, the source's cents on a mirror. */
  const answerPrice = (i: 0 | 1) =>
    mirror
      ? toCents(market.outcomePrices[i])
      : formatQuote(quoteKobo(event, market.outcomePrices[i]));
  // The automated series stop taking trades before they close, so the
  // deadline that matters here is earlier than the closing time.
  const stopsAt = tradingStopsAt(event);
  const msLeft = stopsAt === null || now === null ? null : stopsAt - now;
  // A Worldstreet market can also be shut by the desk with time still on
  // the clock — the server would refuse the trade, so say so first.
  const closed = (msLeft !== null && msLeft <= 0) || event.tradingOpen === false;

  const belowMin = stakeKobo > 0 && stakeKobo < minStakeKobo;
  // typed past the cap: the stake is clamped to it, so say why
  const aboveMax = Number.isFinite(typedNaira) && typedNaira * 100 > maxStakeKobo;
  const stakeHint = belowMin
    ? `Minimum stake is ${formatNaira(minStakeKobo)}`
    : aboveMax
      ? `Maximum stake is ${formatNaira(maxStakeKobo)}`
      : null;
  // Caught before review, as the reference does: the button turns into
  // the way to top up. The server still checks (INSUFFICIENT_FUNDS).
  const insufficient =
    Boolean(user) &&
    balanceKobo !== null &&
    stakeKobo >= minStakeKobo &&
    stakeKobo > balanceKobo;

  const submit = async () => {
    if (!market.outcomeIds || stakeKobo < minStakeKobo || pending) return;
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
      if (res.alreadyProcessed) void refreshNairaWallet();
      setReceipt({
        position: res.position,
        alreadyProcessed: Boolean(res.alreadyProcessed),
        question,
        prediction: binary
          ? res.position.outcomeLabel
          : `${marketLabel} · ${res.position.outcomeLabel}`,
        side,
        dueLabel,
      });
      setStep(null);
      // money committed: the next order must not reuse this key
      setStakeText("");
      setTradeNonce(newIdempotencyKey().slice(0, 8));
    } catch (err) {
      setAttempt({ orderKey, ...describeFailure(err) });
    } finally {
      setPending(false);
    }
  };

  /** Turn the API's failure codes into something actionable on the ticket. */
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
        error: "Not enough credit for this stake.",
        confirmPriceKobo: null,
        shortfallKobo: Math.max(0, stakeKobo - (balanceKobo ?? 0)),
      };
    }
    return { error: err.message, confirmPriceKobo: null, shortfallKobo: null };
  };

  const addCredit = (neededKobo?: number) => {
    // the dialog is modal — everything else on the page is inert while
    // it's open — so it has to go before the wallet can open
    setStep(null);
    setFunding({ neededKobo });
  };

  const hasShortfall =
    failure?.shortfallKobo !== undefined && failure?.shortfallKobo !== null;

  /** The error under the summary, and the way out of a shortfall. */
  const failureNotice = failure && (
    <div className="grid gap-3">
      <p role="alert" className="text-sm font-semibold text-no">
        {failure.error}
      </p>
      {hasShortfall && (
        <button
          type="button"
          onClick={() => addCredit(failure.shortfallKobo ?? undefined)}
          className={`${SECONDARY_MD} w-full`}
        >
          <Wallet className="size-4" />
          Add credit
        </button>
      )}
    </div>
  );

  const summary = (
    <TradeSummary
      prediction={prediction}
      stakeKobo={stakeKobo}
      priceKobo={priceKobo}
      shares={shares}
      payoutKobo={payoutKobo}
    />
  );

  return (
    <div>
      {receipt ? (
        <TradeReceipt receipt={receipt} onNewTrade={() => setReceipt(null)} />
      ) : (
        <section data-bet-slip className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          {/* side and order type — buy-at-market is all the house takes today */}
          <header className="flex items-center justify-between gap-2 border-b border-border pb-3">
            <div role="group" aria-label="Trade side" className="flex gap-1">
              <button
                type="button"
                aria-pressed="true"
                disabled={pending}
                className="h-9 rounded-none border-b-2 border-accent px-4 text-sm font-semibold uppercase text-primary"
              >
                Buy
              </button>
              {/* the wrapper carries the hint: a disabled button gets no hover */}
              <span title="Coming soon" className="inline-flex cursor-not-allowed">
                <button
                  type="button"
                  aria-pressed="false"
                  disabled
                  className="pointer-events-none h-9 rounded-sm px-4 text-sm font-semibold uppercase text-secondary opacity-40"
                >
                  Sell<span className="sr-only"> (coming soon)</span>
                </button>
              </span>
            </div>
            <TicketSelect
              label="Order type"
              size="md"
              value="market"
              options={ORDER_TYPES}
              onChange={() => undefined}
              disabled={pending}
            />
          </header>

          <div className="grid gap-1.5">
            <p className="text-base leading-normal">{question}</p>
            {/* how long is left to trade */}
            {msLeft !== null && msLeft > 0 && (
              <CloseCountdown event={event} className="text-[13px]" />
            )}
          </div>

          <fieldset disabled={pending} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
            {!binary && (
              <div className="flex min-w-0 items-center gap-3">
                {team && <TeamMark team={team} px={32} className="size-8" />}
                <div className="min-w-0 flex-1">
                  <TicketSelect
                    label="Outcome"
                    value={market.id}
                    options={event.markets.map((m) => ({
                      value: m.id,
                      label: m.groupItemTitle ?? m.question,
                    }))}
                    onChange={(id) => select(id, "yes")}
                  />
                </div>
              </div>
            )}

            <div
              role="group"
              aria-label="Contract answer"
              className="grid grid-cols-2 gap-1 rounded-full bg-element-2 p-1"
            >
              <SideToggle
                label={labels[0]}
                price={answerPrice(0)}
                side="yes"
                active={side === "yes"}
                onClick={() => setSide("yes")}
              />
              <SideToggle
                label={labels[1]}
                price={answerPrice(1)}
                side="no"
                active={side === "no"}
                onClick={() => setSide("no")}
              />
            </div>

            {/* amount */}
            <div className="grid gap-2">
              <label htmlFor={amountId} className="sr-only">
                Amount in credit
              </label>
              <div className="flex min-h-11 items-center overflow-hidden rounded-md border border-border bg-page transition-[border-color,box-shadow] duration-150 hover:border-border-hover focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
                <input
                  id={amountId}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="Amount"
                  disabled={mirror}
                  value={stakeText}
                  aria-describedby={stakeHint ? `${amountId}-hint` : undefined}
                  onChange={(e) =>
                    setStakeText(e.target.value.replace(/[^0-9.]/g, "").slice(0, 10))
                  }
                  className="min-w-0 flex-1 bg-transparent px-4 py-2.5 text-sm tabular-nums text-primary outline-none placeholder:text-tertiary"
                />
                <span className="mr-3.5 flex shrink-0 items-center gap-2 text-sm text-primary">
                  <span
                    aria-hidden="true"
                    className="grid size-6 place-items-center rounded-full bg-element-2 text-[10px] font-semibold"
                  >
                    {CREDIT}
                  </span>
                  Credit
                </span>
              </div>
              {stakeHint && (
                <p id={`${amountId}-hint`} className="text-xs text-tertiary">
                  {stakeHint}
                </p>
              )}
            </div>

            {/* balance, quick adds, max */}
            <div className="-mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              {user ? (
                <p className="text-xs leading-normal text-secondary">
                  {balanceKobo === null ? "—" : formatNaira(balanceKobo)} available
                </p>
              ) : (
                <span />
              )}
              <div className="flex items-center">
                {QUICK_ADD_KOBO.map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-label={`Add ${formatNaira(v)}`}
                    disabled={mirror}
                    onClick={() => setStakeKobo(stakeKobo + v)}
                    className={GHOST_SM}
                  >
                    +{formatNairaCompact(v / 100)}
                  </button>
                ))}
                {user && (
                  <button
                    type="button"
                    disabled={mirror || !balanceKobo}
                    onClick={() => setStakeKobo(balanceKobo ?? 0)}
                    className={GHOST_SM}
                  >
                    Max
                  </button>
                )}
              </div>
            </div>
          </fieldset>

          <dl className="grid gap-3 text-sm tabular-nums">
            <SummaryRow label="Odds">
              {toPercent(market.outcomePrices[sideIndex])}% chance
            </SummaryRow>
            <SummaryRow label="Shares">{formatShares(shares)}</SummaryRow>
            <SummaryRow label="Estimated cost">{formatNaira(stakeKobo)}</SummaryRow>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-secondary">
                Max payout
                {dueLabel && <small className="mt-1 block text-xs">{dueLabel}</small>}
              </dt>
              <dd className="text-right text-[28.5px] font-semibold leading-tight [overflow-wrap:anywhere]">
                {formatNaira(payoutKobo)}
              </dd>
            </div>
          </dl>

          {/* action — a shut market says so before it asks anyone to log in */}
          {closed || !tradeable ? (
            <button type="button" disabled className={MUTED_PILL}>
              {closed ? "Trading closed" : mirror ? "Trading opens soon" : "Not tradeable"}
            </button>
          ) : !user ? (
            <button type="button" onClick={openAuth} className={PRIMARY_PILL}>
              Log in to Trade
            </button>
          ) : insufficient ? (
            <button
              type="button"
              onClick={() => addCredit(stakeKobo - (balanceKobo ?? 0))}
              className={PRIMARY_PILL}
            >
              Insufficient balance
            </button>
          ) : (
            <button
              type="button"
              disabled={stakeKobo < minStakeKobo || pending}
              onClick={() => setStep("review")}
              className={PRIMARY_PILL}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Review Buy
            </button>
          )}

          {step === null && failureNotice}

          {mirror ? (
            <p className="text-xs leading-normal text-secondary">
              This market can&apos;t be traded yet.{" "}
              <Link href="/?category=local" className="font-semibold text-accent-ink hover:underline">
                Local markets
              </Link>{" "}
              trade in credit now.
            </p>
          ) : (
            <p className="text-xs leading-normal text-secondary">
              Winning shares pay {formatNaira(PAYOUT_PER_SHARE_KOBO)} at settlement.
              Positions are held to settlement — selling and limit orders are
              coming soon.
            </p>
          )}

          {!mirror && user && balanceKobo !== null && !hasShortfall && (
            <button
              type="button"
              onClick={() => setFunding({})}
              className="justify-self-start text-xs font-semibold text-accent-ink hover:underline"
            >
              Manage credit balance
            </button>
          )}
        </section>
      )}

      {step && (
        <TicketDialog
          step={step}
          title={step === "review" ? "Review trade" : "Confirm trade"}
          description={
            step === "review"
              ? "Check the outcome, price and estimated payout before continuing."
              : "This places the order with WorldStreet and takes the stake from your credit."
          }
          size={step === "review" ? "md" : "sm"}
          sheet={step === "review"}
          busy={pending}
          onClose={() => setStep(null)}
          footer={
            step === "review" ? (
              <>
                <button
                  type="button"
                  data-autofocus
                  onClick={() => setStep(null)}
                  className={GHOST_MD}
                >
                  Edit trade
                </button>
                <button
                  type="button"
                  onClick={() => setStep("confirm")}
                  className={PRIMARY_MD}
                >
                  Continue to confirmation
                  <ChevronRight className="size-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  data-autofocus
                  disabled={pending}
                  onClick={() => setStep("review")}
                  className={GHOST_MD}
                >
                  Go back
                </button>
                {/* busy, not disabled, while in flight: a disabled button
                    drops focus out of the dialog (submit ignores repeats) */}
                <button
                  type="button"
                  aria-busy={pending || undefined}
                  disabled={closed || !tradeable}
                  onClick={() => void submit()}
                  className={`${PRIMARY_MD} aria-busy:pointer-events-none aria-busy:opacity-40`}
                >
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  {failure?.confirmPriceKobo
                    ? `Confirm at ${formatNaira(failure.confirmPriceKobo)}`
                    : "Place trade"}
                </button>
              </>
            )
          }
        >
          {step === "review" ? (
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-ink">
                  <Check className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-secondary">You are about to trade</p>
                  <h3 className="mt-1 text-base font-semibold leading-snug">
                    {question}
                  </h3>
                </div>
              </div>
              {summary}
              {failureNotice}
              <p className="text-xs leading-relaxed text-tertiary">
                This is an estimate from the current price. If it moves before
                the order fills, you&apos;ll be asked to confirm the new one.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-accent/30 bg-accent/15 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-accent-ink">
                  Final check
                </p>
                <p className="mt-2 text-sm font-semibold leading-snug">
                  Submit buy order for {prediction}?
                </p>
                <p className="mt-1 text-xs leading-relaxed text-accent-ink/80">
                  {question}
                </p>
              </div>
              {summary}
              {failureNotice}
              {closed && (
                <p className="text-sm font-semibold text-no">Trading has closed.</p>
              )}
              <p className="text-[11px] leading-relaxed text-tertiary">
                Winning shares pay {formatNaira(PAYOUT_PER_SHARE_KOBO)}. Losing
                shares pay {formatNaira(0)}. Positions are held to settlement.
              </p>
            </div>
          )}
        </TicketDialog>
      )}

      {/* Portalled so the wallet escapes the sticky aside's stacking
          context (which sits under the site header) and the sheet's. */}
      {funding &&
        createPortal(
          <FundNairaModal
            open
            onClose={() => setFunding(null)}
            neededKobo={funding.neededKobo}
          />,
          document.body,
        )}
    </div>
  );
}

/* ---------- summary ---------- */

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-secondary">{label}</dt>
      <dd className="text-right [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** The order as the review and confirm steps restate it. */
function TradeSummary({
  prediction,
  stakeKobo,
  priceKobo,
  shares,
  payoutKobo,
}: {
  prediction: string;
  stakeKobo: number;
  priceKobo: number;
  shares: number;
  payoutKobo: number;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs leading-normal text-secondary">
        Pay: {formatNaira(stakeKobo)} from your credit balance
      </p>
      <div className="rounded-xl border border-border bg-sunken p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary">
              Buy · Market
            </p>
            <p className="mt-1 text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
              {prediction}
            </p>
          </div>
          <p className="shrink-0 text-3xl font-semibold tabular-nums">
            {formatNaira(stakeKobo)}
          </p>
        </div>
        <p className="mt-2 text-xs text-secondary">
          {formatShares(shares)} shares at {formatNaira(priceKobo)} each
        </p>
      </div>
      <dl className="divide-y divide-border rounded-xl border border-border bg-page px-4 text-xs tabular-nums">
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-secondary">Potential payout</dt>
          <dd>{formatNaira(payoutKobo)}</dd>
        </div>
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-secondary">Potential profit</dt>
          <dd className="text-yes">{formatNairaSigned(payoutKobo - stakeKobo)}</dd>
        </div>
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-secondary">Fees</dt>
          <dd>Included in price</dd>
        </div>
      </dl>
    </div>
  );
}

/* ---------- receipt ---------- */

function ReceiptRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 py-[9px]">
      <dt className="text-xs text-secondary">{label}</dt>
      <dd className="min-w-0 text-right text-base font-medium [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

/**
 * The filled order, as the reference's trade receipt: a ticket with a
 * torn bottom edge. It takes the slip's place until "New trade".
 */
function TradeReceipt({
  receipt,
  onNewTrade,
}: {
  receipt: Receipt;
  onNewTrade: () => void;
}) {
  const { position } = receipt;
  const newTradeRef = useRef<HTMLButtonElement>(null);

  // the Review button that had focus is gone — land on the way back
  useEffect(() => {
    newTradeRef.current?.focus({ preventScroll: true });
  }, []);

  const reference = `WS-${position.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const placedAt = position.createdAt
    ? `${new Date(position.createdAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      })} UTC`
    : "Just now";

  return (
    <div className="space-y-4" data-trade-complete>
      <article
        aria-label={`Completed buy trade receipt for ${receipt.prediction}`}
        className="overflow-hidden rounded-t-sm bg-element-2 pb-3.5 tabular-nums text-primary [mask:linear-gradient(currentColor_0_0)_top/100%_calc(100%_-_12px)_no-repeat,conic-gradient(from_-45deg_at_50%_100%,transparent_0deg,currentColor_0deg_90deg,transparent_90deg)_bottom/20px_12px_repeat-x]"
      >
        <div className="px-[22px] pb-[26px] pt-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xs bg-primary/5">
              <Ticket className="size-[18px]" />
            </span>
            <h3 className="text-[19px] font-semibold leading-[1.4] text-pretty">
              {receipt.question}
            </h3>
          </div>
          <p className="mt-3 text-[11px] text-secondary">Buy · Market · Filled</p>
          <dl className="mt-5 grid">
            <ReceiptRow label="Prediction">
              <span
                className={`inline-flex min-h-7 items-center rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${
                  receipt.side === "yes" ? "bg-yes-tint text-yes" : "bg-no-tint text-no"
                }`}
              >
                {receipt.prediction}
              </span>
            </ReceiptRow>
            {receipt.dueLabel && <ReceiptRow label="Due date">{receipt.dueLabel}</ReceiptRow>}
            <ReceiptRow label="Qty">{formatShares(position.shares)}</ReceiptRow>
            <ReceiptRow label="Avg. price">
              {formatNaira(position.priceKobo)}
              <small className="mt-0.5 block text-[10px] font-normal text-secondary">
                / share
              </small>
            </ReceiptRow>
            <ReceiptRow label="Total">{formatNaira(position.stakeKobo)}</ReceiptRow>
            <div className="flex items-center justify-between gap-4 pt-[18px]">
              <dt className="text-[14px] font-semibold uppercase tracking-[0.06em]">
                To win
              </dt>
              <dd className="text-right text-[28px] font-semibold text-yes [overflow-wrap:anywhere]">
                {formatNaira(position.potentialPayoutKobo)}
              </dd>
            </div>
          </dl>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 px-[22px] pb-4 text-[10px] font-medium">
          <span className="inline-flex items-center gap-[7px]">
            <Check className="size-[15px]" />
            {receipt.alreadyProcessed ? "Trade already placed" : "Trade executed"}
          </span>
          <span>{reference}</span>
          <small className="basis-full text-[10px] font-normal text-secondary">
            {placedAt}
          </small>
        </footer>
      </article>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-xs text-secondary">
          {receipt.alreadyProcessed
            ? "That trade was already placed."
            : "Your position is open until the market settles."}
        </p>
        <button ref={newTradeRef} type="button" onClick={onNewTrade} className={SECONDARY_MD}>
          New trade
        </button>
      </div>
    </div>
  );
}

/* ---------- review / confirm dialog ---------- */

/**
 * The reference's Modal, cut to what the ticket needs: a native modal
 * <dialog> (top layer, focus trap, Escape) portalled to <body> so it
 * outlives the narrow-screen sheet it was opened from. The review step
 * is a bottom sheet on phones; the confirm step stays a centred dialog.
 * While the order is in flight (`busy`) nothing closes it.
 */
function TicketDialog({
  step,
  title,
  description,
  size,
  sheet,
  busy,
  onClose,
  footer,
  children,
}: {
  /** Changes when the content does — focus moves to the new step's first action. */
  step: string;
  title: string;
  description: string;
  size: "sm" | "md";
  sheet: boolean;
  busy: boolean;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const titleId = useId();
  const descId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    // the page behind doesn't scroll while the decision is open
    const root = document.documentElement;
    const { overflow } = root.style;
    root.style.overflow = "hidden";
    // Escape closes this dialog — not the trade sheet it was opened from
    const stopEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.stopPropagation();
    };
    dialog.addEventListener("keydown", stopEscape);
    return () => {
      dialog.removeEventListener("keydown", stopEscape);
      root.style.overflow = overflow;
      // closing (rather than just removing it) hands focus back
      dialog.close();
    };
  }, []);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [step]);

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descId}
      aria-busy={busy || undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      // the browser can force it shut (a second Escape) — follow it
      onClose={onClose}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget && !busy) onClose();
      }}
      className={`m-auto max-h-[min(760px,calc(100dvh-48px))] max-w-none overflow-hidden rounded-3xl border-0 bg-surface p-0 text-primary shadow-popover transition-[opacity,scale] duration-200 backdrop:bg-alpha-black-600 backdrop:backdrop-blur-[2px] starting:scale-[0.97] starting:opacity-0 ${
        size === "sm" ? "w-[min(400px,calc(100vw-32px))]" : "w-[min(520px,calc(100vw-32px))]"
      } ${
        sheet
          ? "max-sm:mx-0 max-sm:mb-0 max-sm:mt-auto max-sm:max-h-[calc(100dvh-24px)] max-sm:w-full max-sm:rounded-b-none"
          : ""
      }`}
    >
      <div className="flex max-h-[inherit] min-h-0 flex-col">
        {sheet && (
          <div className="flex shrink-0 justify-center pt-2 sm:hidden">
            <span aria-hidden="true" className="block h-1 w-9 rounded-full bg-primary/20" />
          </div>
        )}
        <div className={`flex shrink-0 items-start gap-2 px-6 ${sheet ? "pt-6 max-sm:pt-3" : "pt-6"}`}>
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="text-[17px] font-semibold leading-6 tracking-[-0.01em] text-balance text-primary"
            >
              {title}
            </h2>
            <p id={descId} className="mt-1 text-sm leading-relaxed text-pretty text-secondary">
              {description}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
            className="-mr-2 -mt-0.5 grid size-7 shrink-0 place-items-center rounded-sm text-secondary transition-colors hover:bg-element-2 hover:text-primary disabled:pointer-events-none disabled:opacity-40"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-2 pt-5">
          {children}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-6 pb-6 pt-4 max-sm:pb-[max(24px,env(safe-area-inset-bottom))]">
          {footer}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

/* ---------- select ---------- */

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** A line under the label — "Coming soon" on an option that can't be picked. */
  hint?: string;
}

/**
 * The reference's select: a field-styled trigger and a menu in the top
 * layer (a native popover — no scroll container or sheet can clip it,
 * and the browser supplies outside-click and Escape), placed under the
 * trigger and following it while the page scrolls.
 */
function TicketSelect({
  label,
  value,
  options,
  onChange,
  size = "lg",
  disabled,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** `lg` (44px) is the form field; `md` (36px) sits in the toolbar. */
  size?: "md" | "lg";
  disabled?: boolean;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openAtPress = useRef(false);
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  /** Under the trigger, or above it when the viewport has no room below. */
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const r = trigger.getBoundingClientRect();
    panel.style.minWidth = `${r.width}px`;
    const h = panel.offsetHeight;
    const w = panel.offsetWidth;
    const room = window.innerHeight - r.bottom;
    const top = room < h + 12 && r.top > room ? r.top - 4 - h : r.bottom + 4;
    panel.style.top = `${Math.max(8, top)}px`;
    panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  }, []);

  const isOpen = () => Boolean(panelRef.current?.matches(":popover-open"));

  const show = () => {
    const panel = panelRef.current;
    if (!panel || isOpen()) return;
    panel.showPopover();
    place(); // shown synchronously, so it measures and lands before paint
    setOpen(true);
    (
      panel.querySelector<HTMLElement>('[role=option][aria-selected="true"]:not(:disabled)') ??
      panel.querySelector<HTMLElement>("[role=option]:not(:disabled)")
    )?.focus();
  };

  const hide = (refocus: boolean) => {
    if (isOpen()) panelRef.current?.hidePopover();
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  // Light dismiss (outside press, Escape) closes the popover without
  // telling React; its toggle event does.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onToggle = (e: Event) => {
      if ((e as Event & { newState?: string }).newState !== "closed") return;
      setOpen(false);
      if (panel.contains(document.activeElement)) triggerRef.current?.focus();
    };
    // Escape closes this menu, not the trade sheet it sits in
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.stopPropagation();
    };
    panel.addEventListener("toggle", onToggle);
    panel.addEventListener("keydown", onKey);
    return () => {
      panel.removeEventListener("toggle", onToggle);
      panel.removeEventListener("keydown", onKey);
    };
  }, []);

  // follow the trigger while the page (or the sheet) scrolls
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    let raf = 0;
    const follow = (e: Event) => {
      if (e.target instanceof Node && panel?.contains(e.target)) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open, place]);

  /** Arrow keys, Home and End move through the options that can be picked. */
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") return hide(false);
    const rows = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>("[role=option]:not(:disabled)") ?? [],
    );
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      rows[(n + rows.length) % rows.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i < 0 ? rows.length - 1 : i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(rows.length - 1);
  };

  return (
    <div className={size === "lg" ? "min-w-0" : "shrink-0"}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${label}: ${selected?.label ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        disabled={disabled}
        onPointerDown={() => {
          openAtPress.current = isOpen();
        }}
        onClick={() => {
          // a press on the trigger already light-dismissed an open menu
          if (openAtPress.current) {
            openAtPress.current = false;
            hide(false);
          } else show();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            show();
          }
        }}
        className={`flex items-center gap-2 rounded-md border bg-page text-left text-primary outline-none transition-[border-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
          size === "lg"
            ? "min-h-11 w-full pl-4 pr-3.5 text-base font-semibold"
            : "min-h-9 pl-3 pr-2.5 text-[13px]"
        } ${
          open
            ? "border-accent ring-1 ring-accent"
            : "border-border hover:border-border-hover focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-tertiary transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <div
        ref={panelRef}
        popover="auto"
        onKeyDown={onMenuKey}
        className="fixed inset-auto m-0 max-w-[min(360px,calc(100vw-16px))] overflow-hidden rounded-2xl border border-border bg-element-2 p-1 text-primary shadow-popover"
      >
        <div id={`${id}-list`} role="listbox" aria-label={label} className="max-h-64 overflow-auto">
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                tabIndex={-1}
                disabled={o.disabled}
                title={o.hint}
                onClick={() => {
                  hide(true);
                  if (!on) onChange(o.value);
                }}
                className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-[13px] outline-none ${
                  o.hint ? "py-2" : ""
                } ${
                  o.disabled
                    ? "cursor-not-allowed text-tertiary opacity-50"
                    : on
                      ? "bg-accent/15 text-primary"
                      : "text-secondary hover:bg-primary/[0.08] hover:text-primary focus-visible:bg-primary/[0.08] focus-visible:text-primary"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && (
                    <span className="mt-0.5 block text-xs leading-snug text-secondary">
                      {o.hint}
                    </span>
                  )}
                </span>
                {on && <Check aria-hidden="true" className="size-4 shrink-0 text-accent-ink" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
