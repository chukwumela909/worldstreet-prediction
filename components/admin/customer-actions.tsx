"use client";

import { useEffect, useState } from "react";
import {
  fetchBookSettings,
  fetchCustomerBetReview,
  notifyReversals,
  previewReversal,
  runReversalBatch,
  updateBookSettings,
  type BetReviewRow,
  type ReversalPreview,
  type TraderRow,
} from "@/lib/admin-api";
import { ApiError } from "@/lib/api-client";
import type { AdminMoney } from "@/lib/admin-money";
import { showToast } from "@/lib/toast-store";
import { FLAG_TONE } from "@/components/admin/risk-flags";

/**
 * Everything the desk does to one customer's bets, in the opened trader:
 * their high-price bets (what the ₦90 rule flags), and taking back their
 * winnings on chosen markets from a chosen date, then emailing them why.
 * Nothing moves until the preview has been read and REVERSE typed.
 * Locking and suspending sit just above, in AccountControl.
 */

const MIN_REASON = 10;
const DAY_MS = 86_400_000;

const price = (kobo: number) => `₦${(kobo / 100).toFixed(2)}`;

export function CustomerActions({
  trader,
  money,
  onChanged,
}: {
  trader: TraderRow;
  money: AdminMoney;
  onChanged: () => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      <HighPriceBets trader={trader} money={money} />
      <TakeBack trader={trader} money={money} onChanged={onChanged} />
    </div>
  );
}

/* ---------- their ₦90+ bets ---------- */

function HighPriceBets({ trader, money }: { trader: TraderRow; money: AdminMoney }) {
  const [row, setRow] = useState<BetReviewRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCustomerBetReview(trader.authUserId)
      .then((r) => {
        if (!cancelled) setRow(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load");
      });
    return () => {
      cancelled = true;
    };
  }, [trader.authUserId]);

  return (
    <details className="rounded-md border border-border bg-surface p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        High-price bets (₦90 or more a share)
        {row && (
          <span className="font-normal text-secondary">
            {" "}
            · {row.high.bets} bet{row.high.bets === 1 ? "" : "s"}, won {row.high.won}, lost {row.high.lost}, profit{" "}
            {money.formatSigned(row.high.profitKobo)}
          </span>
        )}
      </summary>
      {error && <p className="mt-2 text-sm font-semibold text-no">{error}</p>}
      {!row && !error && <p className="mt-2 text-sm text-secondary">Loading…</p>}
      {row && (
        <>
          <p className="mt-2 text-sm text-secondary">
            Buying results that were nearly decided. {row.beforeTerms.bets} before the Terms went live on 21 Oct (
            {money.formatSigned(row.beforeTerms.profitKobo)}), {row.afterTerms.bets} after (
            {money.formatSigned(row.afterTerms.profitKobo)}). A high price alone isn&rsquo;t proof; check the times.
          </p>
          {row.markets.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-xs text-secondary">
                    <th scope="col" className="py-2 pr-3 font-medium">Market and side</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Bet times</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Bets</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Avg price</th>
                    <th scope="col" className="py-2 text-right font-medium">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {row.markets.map((m) => (
                    <tr key={`${m.title}|${m.outcome}`}>
                      <td className="py-2 pr-3">
                        {m.title}
                        <span className="block text-xs text-secondary">{m.outcome}</span>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-secondary">
                        {when(m.firstAt)}
                        {m.lastAt !== m.firstAt && <span className="block text-xs text-tertiary">to {when(m.lastAt)}</span>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{m.bets}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{price(m.avgPriceKobo)}</td>
                      <td className="py-2 text-right tabular-nums">{money.formatSigned(m.profitKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </details>
  );
}

/* ---------- take back winnings ---------- */

function TakeBack({ trader, money, onChanged }: { trader: TraderRow; money: AdminMoney; onChanged: () => void }) {
  const name = trader.displayName || trader.username;
  const [open, setOpen] = useState(false);
  const [marketsText, setMarketsText] = useState("x posts");
  const [sinceDate, setSinceDate] = useState("");
  const [preview, setPreview] = useState<ReversalPreview | null>(null);
  const [shortfall, setShortfall] = useState<"cap" | "negative">("cap");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<"preview" | "pause" | "run" | "email" | null>(null);
  const [error, setError] = useState<{ text: string; needsPause: boolean } | null>(null);
  const [done, setDone] = useState<{ reversed: number; changeKobo: number } | null>(null);

  const topics = marketsText
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  // worked out when a button is pressed, so rendering stays pure
  const sinceDaysNow = () =>
    sinceDate ? Math.max(Math.ceil((Date.now() - new Date(`${sinceDate}T00:00:00`).getTime()) / DAY_MS), 1) : null;
  const params = () => ({ topics, sinceDays: sinceDaysNow(), customer: trader.username });
  const fail = (err: unknown) =>
    setError({
      text: err instanceof Error && err.message ? err.message : "Request failed. Try again.",
      needsPause: err instanceof ApiError && err.code === "NOT_PAUSED",
    });
  const restart = () => {
    setPreview(null);
    setConfirm("");
    setError(null);
  };

  const doPreview = async () => {
    setBusy("preview");
    setError(null);
    setDone(null);
    try {
      setPreview(await previewReversal(params()));
      setConfirm("");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const pauseForEveryone = async () => {
    setBusy("pause");
    try {
      const state = await fetchBookSettings();
      await updateBookSettings({ pausedTopics: [...new Set([...(state.settings.pausedTopics ?? []), ...topics])] });
      showToast("Closed for everyone: these markets take no bets and their open bets are refunded", "success");
      setError(null);
      setPreview(await previewReversal(params()));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    if (!preview || confirm !== "REVERSE") return;
    setBusy("run");
    setError(null);
    const p = params();
    let reversed = 0;
    let changeKobo = 0;
    try {
      for (let guard = 0; guard < 1_000; guard++) {
        const batch = await runReversalBatch({ ...p, shortfall, reason: reason.trim() });
        reversed += batch.reversed;
        changeKobo += batch.changeKobo;
        if (batch.remaining === 0 || batch.reversed === 0) break;
      }
      setDone({ reversed, changeKobo });
      setPreview(null);
      setConfirm("");
      onChanged();
    } catch (err) {
      fail(err);
      if (reversed > 0) setDone({ reversed, changeKobo });
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const email = async () => {
    setBusy("email");
    try {
      const res = await notifyReversals(false, trader.username);
      showToast(
        res.mailConfigured ? `Emailed ${res.emailed} customer${res.emailed === 1 ? "" : "s"} the reason` : "Email isn't set up on the API",
        res.mailConfigured ? "success" : "error",
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const balance = preview?.customerRows?.[0]?.balanceKobo ?? trader.balanceKobo;
  const covers = preview ? balance >= preview.netKobo : true;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 w-fit items-center rounded-sm border border-no/40 px-3 text-sm font-semibold text-no hover:bg-no-tint"
      >
        Take back winnings…
      </button>
    );
  }

  return (
    <section className="rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Take back {name}&rsquo;s winnings</h3>
          <p className="mt-0.5 text-xs text-secondary">
            Their winning bets are undone (winnings taken back, stake kept) and losing bets get their stake back. Only
            this customer&rsquo;s bets are touched. Preview first; nothing moves until you confirm.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-secondary hover:text-primary">
          Close
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="min-w-0">
          <span className="block text-xs font-medium text-secondary">Which markets: words in their titles, comma-separated</span>
          <input
            value={marketsText}
            onChange={(e) => {
              setMarketsText(e.target.value);
              restart();
            }}
            className="mt-1 h-9 w-full rounded-md border border-border bg-sunken px-3 text-sm outline-none focus:border-accent"
          />
        </label>
        <label>
          <span className="block text-xs font-medium text-secondary">Bets placed since (empty = all time)</span>
          <input
            type="date"
            value={sinceDate}
            onChange={(e) => {
              setSinceDate(e.target.value);
              restart();
            }}
            className="mt-1 h-9 rounded-md border border-border bg-sunken px-3 text-sm outline-none focus:border-accent"
          />
        </label>
      </div>

      {!preview ? (
        <button
          type="button"
          onClick={doPreview}
          disabled={busy !== null || topics.length === 0}
          className="pressable mt-3 h-9 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
        >
          {busy === "preview" ? "Checking…" : "Preview"}
        </button>
      ) : preview.bets === 0 ? (
        <p className="mt-3 rounded-md bg-element-2 px-3 py-2 text-sm">
          No settled bets of theirs on these markets{sinceDate ? " since that date" : ""}. Nothing to take back.
        </p>
      ) : (
        <div className="mt-3 rounded-md bg-element-2 p-3 text-sm">
          <p className="font-semibold">
            {preview.bets} bet{preview.bets === 1 ? "" : "s"} ({preview.won} won, {preview.lost} lost) on{" "}
            {preview.events.length} market{preview.events.length === 1 ? "" : "s"}.
          </p>
          <p className="mt-1 text-secondary">
            Takes back {money.format(preview.takeBackKobo)} of winnings and returns {money.format(preview.returnKobo)} of
            stakes, so we recover <b className="text-primary">{money.format(preview.netKobo)}</b>. Their balance is{" "}
            {money.format(balance)}
            {covers ? ", which covers it." : `, which doesn't cover it.`}
          </p>
          {preview.events.length > 0 && (
            <p className="mt-1 text-xs text-tertiary">Markets: {preview.events.map((e) => e.title).join(" · ")}</p>
          )}

          {!covers && (
            <fieldset className="mt-3">
              <legend className="text-xs font-medium text-secondary">Their balance can&rsquo;t cover it, so:</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {(
                  [
                    ["cap", "Take only what's there", "Stop at zero and write off the rest."],
                    ["negative", "Take it all", "Their balance goes below zero until new money covers it."],
                  ] as const
                ).map(([key, label, hint]) => (
                  <label
                    key={key}
                    className={`flex min-w-0 flex-1 basis-52 cursor-pointer gap-2 rounded-md border px-3 py-2 ${
                      shortfall === key ? "border-accent bg-surface" : "border-border"
                    }`}
                  >
                    <input type="radio" checked={shortfall === key} onChange={() => setShortfall(key)} className="mt-0.5 accent-[var(--accent)]" />
                    <span>
                      <span className="block font-semibold">{label}</span>
                      <span className="block text-xs text-secondary">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <label className="mt-3 block">
            <span className="block text-xs font-medium text-secondary">Reason: their email quotes this word for word</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="e.g. You placed bets on X post count markets that were already decided, which our Terms and Conditions don't allow (sections 4b and 4c). We have reversed the winnings from these bets."
              className="mt-1 w-full rounded-md border border-border bg-sunken px-3 py-2 text-sm outline-none placeholder:text-tertiary focus:border-accent"
            />
          </label>
          <label className="mt-2 block">
            <span className="block text-xs font-medium text-secondary">Type REVERSE to confirm. This can&rsquo;t be undone.</span>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1 h-9 w-40 rounded-md border border-border bg-sunken px-3 text-sm outline-none focus:border-accent"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={run}
              disabled={busy !== null || confirm !== "REVERSE" || reason.trim().length < MIN_REASON}
              className="pressable h-9 rounded-sm bg-no-solid px-4 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy === "run" ? "Taking back…" : `Take back ${money.format(preview.netKobo)}`}
            </button>
            <button type="button" onClick={restart} disabled={busy !== null} className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-secondary">
              Change
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className={`mt-3 rounded-md px-3 py-2 text-sm font-semibold ${FLAG_TONE.danger.chip}`}>
          {error.needsPause
            ? "They still have open bets on these markets. Close the markets first, then try again."
            : error.text}
          {error.needsPause && (
            <button
              type="button"
              onClick={pauseForEveryone}
              disabled={busy !== null}
              className="mt-2 block h-9 rounded-sm bg-surface px-3 text-sm font-semibold text-primary disabled:opacity-40"
            >
              {busy === "pause" ? "Closing…" : "Close these markets for everyone"}
            </button>
          )}
        </div>
      )}

      {done && (
        <div className="mt-3 rounded-md bg-yes-tint px-3 py-2 text-sm">
          <p className="font-semibold text-yes">
            Done: {done.reversed} bet{done.reversed === 1 ? "" : "s"} reversed, balance changed by{" "}
            {money.formatSigned(done.changeKobo)}.
          </p>
          <p className="mt-1 text-secondary">Now email them the reason. Only this customer is emailed.</p>
          <button
            type="button"
            onClick={email}
            disabled={busy !== null}
            className="pressable mt-2 h-9 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
          >
            {busy === "email" ? "Sending…" : "Email them the reason"}
          </button>
        </div>
      )}
    </section>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
