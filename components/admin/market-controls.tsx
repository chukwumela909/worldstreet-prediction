"use client";

import { useState } from "react";
import Link from "next/link";
import { AdjustmentsHorizontalIcon as Controls } from "@heroicons/react/24/outline";
import { showToast } from "@/lib/toast-store";
import { useAdminMoney } from "@/lib/admin-money";
import {
  previewReversal,
  updateBookSettings,
  voidPausedMarkets,
  type BookSettingsState,
  type PausedVoidResult,
} from "@/lib/admin-api";
import { FLAG_TONE } from "@/components/admin/risk-flags";

/**
 * Market controls: every market on a topic at once, by a word in its
 * name (a whole word, "x posts", "bitcoin"), in one of three ways. Each
 * is one of the book's topic lists, matched the same way by the API:
 *
 *  - Stop new bets (`stoppedTopics`): no new bets, nothing else. The
 *    markets stay on the site and their open bets settle as normal; no
 *    refunds, no emails.
 *  - Close and refund (`pausedTopics`): no bets, off the site, and every
 *    open bet refunded, each customer emailed (the pause's own email).
 *    Asked first, with how many open bets it refunds; refunded now
 *    rather than at the next minute's pass.
 *  - Close early (`earlyCloseTopics`): no bets in the last
 *    `earlyCloseHours` before the market closes (set in Settings).
 *
 * One list underneath shows every controlled word, what's on it, and an
 * undo for each.
 */

type Mode = "stop" | "close" | "early";

const CHIP: Record<Mode, { label: string; className: string }> = {
  stop: { label: "No new bets", className: FLAG_TONE.caution.chip },
  close: { label: "Closed and refunded", className: FLAG_TONE.danger.chip },
  early: { label: "Closes early", className: "bg-element-3 text-secondary" },
};

const UNDO: Record<Mode, { label: string; busy: string; done: (w: string) => string }> = {
  stop: { label: "Allow bets again", busy: "Allowing…", done: (w) => `“${w}” markets take bets again.` },
  close: {
    label: "Reopen",
    busy: "Reopening…",
    done: (w) => `“${w}” markets are open again. Bets already refunded stay refunded.`,
  },
  early: { label: "Stop closing early", busy: "Saving…", done: (w) => `“${w}” markets no longer close early.` },
};

/** The API's own rule for a topic: 2–40 letters, numbers, spaces, dots or dashes. */
const TOPIC = /^[a-z0-9][a-z0-9 .-]{1,39}$/;

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function MarketControlsCard({
  state,
  onSaved,
}: {
  state: BookSettingsState;
  onSaved: (next: BookSettingsState) => void;
}) {
  const money = useAdminMoney();
  const s = state.settings;
  // an older API has no stop list
  const canStop = Array.isArray(s.stoppedTopics);
  const lists: Record<Mode, string[]> = {
    stop: s.stoppedTopics ?? [],
    close: s.pausedTopics ?? [],
    early: s.earlyCloseTopics ?? [],
  };
  const hours = s.earlyCloseHours ?? 0;

  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Close and refund, waiting for a yes: the word and how many open bets it refunds (null = couldn't count). */
  const [confirm, setConfirm] = useState<{ word: string; openBets: number | null } | null>(null);
  /** "Refund open bets now" on what's already closed: the preview, waiting for a yes. */
  const [refund, setRefund] = useState<PausedVoidResult | null>(null);

  const word = normalize(text);

  const save = async (mode: Mode, next: string[]) => {
    const view = await updateBookSettings(
      mode === "stop"
        ? { stoppedTopics: next }
        : mode === "close"
          ? { pausedTopics: next }
          : { earlyCloseTopics: next },
    );
    onSaved(view);
    return view;
  };

  /** A word that can go on `mode`'s list, or a message saying why not. */
  const check = (mode: Mode): string | null => {
    if (!TOPIC.test(word)) return "Use 2 to 40 letters, numbers, spaces, dots or dashes.";
    if (lists[mode].includes(word)) {
      return mode === "stop"
        ? `“${word}” markets already take no new bets.`
        : mode === "close"
          ? `“${word}” markets are already closed.`
          : `“${word}” markets already close early.`;
    }
    return null;
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't save. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const add = (mode: Mode) => {
    const why = check(mode);
    if (why) {
      setError(why);
      return;
    }
    if (mode === "close") {
      // ask first, with what it refunds
      void run("count", async () => {
        const openBets = await previewReversal({ topics: [word], sinceDays: null })
          .then((p) => p.openBets)
          .catch(() => null);
        setRefund(null);
        setConfirm({ word, openBets });
      });
      return;
    }
    void run(mode, async () => {
      await save(mode, [...lists[mode], word]);
      setText("");
      showToast(
        mode === "stop"
          ? `No new bets on “${word}” markets. Bets already placed stay open.`
          : hours > 0
            ? `“${word}” markets now stop taking bets ${hours} hour${hours === 1 ? "" : "s"} before they close.`
            : `“${word}” added to Close early. It's off until you set the hours in Settings.`,
        "success",
      );
    });
  };

  const closeAndRefund = () => {
    if (!confirm) return;
    const { word: w, openBets } = confirm;
    void run("close", async () => {
      const view = await save("close", [...lists.close, w]);
      setConfirm(null);
      setText("");
      if (openBets === 0) {
        showToast(`Closed “${w}”. There were no open bets to refund.`, "success");
        return;
      }
      try {
        const res = await voidPausedMarkets({
          reason: `Paused topic: ${view.settings.pausedTopics.join(", ")}`,
          dryRun: false,
        });
        showToast(
          `Closed “${w}”. ${res.positions} open bet${res.positions === 1 ? "" : "s"} refunded (${money.format(
            res.refundKobo,
          )})${res.emailed > 0 ? `, ${res.emailed} customer${res.emailed === 1 ? "" : "s"} emailed` : ""}.`,
          "success",
        );
      } catch {
        // the settlement pass refunds paused markets about every minute anyway
        showToast(`Closed “${w}”. Its open bets are refunded within about a minute.`, "success");
      }
    });
  };

  const undo = (mode: Mode, w: string) =>
    void run(`undo:${mode}:${w}`, async () => {
      await save(
        mode,
        lists[mode].filter((t) => t !== w),
      );
      if (mode === "close") setRefund(null);
      showToast(UNDO[mode].done(w), "success");
    });

  const previewRefund = () =>
    void run("refund-check", async () => {
      setConfirm(null);
      setRefund(await voidPausedMarkets({ reason: `Paused topic: ${lists.close.join(", ")}`, dryRun: true }));
    });

  const refundNow = () =>
    void run("refund", async () => {
      const res = await voidPausedMarkets({ reason: `Paused topic: ${lists.close.join(", ")}`, dryRun: false });
      setRefund(null);
      showToast(
        `Refunded ${res.positions} bet${res.positions === 1 ? "" : "s"} on ${res.markets} market${
          res.markets === 1 ? "" : "s"
        } (${money.format(res.refundKobo)})${
          res.emailed > 0 ? `, ${res.emailed} customer${res.emailed === 1 ? "" : "s"} emailed` : ""
        }.`,
        "success",
      );
    });

  // every controlled word once, in the order it was first listed
  const words = [...new Set([...lists.stop, ...lists.close, ...lists.early])];
  const modesOf = (w: string) => (["stop", "close", "early"] as const).filter((m) => lists[m].includes(w));

  const button = (mode: Mode, label: string, busyLabel: string, disabled = false) => (
    <button
      type="button"
      onClick={() => add(mode)}
      disabled={busy !== null || word.length < 2 || disabled}
      className={`h-9 shrink-0 rounded-sm px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
        mode === "stop"
          ? "pressable bg-accent text-on-accent hover:bg-accent-hover disabled:hover:bg-accent"
          : "border border-border text-secondary hover:border-border-hover hover:text-primary"
      }`}
    >
      {busy === mode || (mode === "close" && busy === "count") ? busyLabel : label}
    </button>
  );

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-start gap-2">
        <Controls className="mt-0.5 size-5 shrink-0 text-secondary" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Market controls</h2>
          <p className="mt-0.5 text-sm text-secondary">
            Every market on a topic at once, by a word in its name (a whole word), e.g.{" "}
            <span className="font-mono">x posts</span> or <span className="font-mono">bitcoin</span>.
          </p>
        </div>
      </div>

      <form
        className="mt-4 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (canStop) add("stop");
        }}
      >
        <label htmlFor="market-control-word" className="sr-only">
          A word in the markets&rsquo; names
        </label>
        <input
          id="market-control-word"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
            setConfirm(null);
          }}
          placeholder="e.g. x posts"
          maxLength={40}
          className="h-10 w-full rounded-md border border-border bg-sunken px-3 text-sm outline-none placeholder:text-tertiary focus:border-accent"
        />
        <div className="flex flex-wrap gap-2">
          {button("stop", "Stop new bets", "Stopping…", !canStop)}
          {button("close", "Close and refund…", "Counting…")}
          {button("early", "Close early", "Saving…")}
        </div>
      </form>

      <ul className="mt-3 flex flex-col gap-1 text-xs leading-5 text-secondary">
        <li>
          <b className="text-primary">Stop new bets:</b> nothing else changes. The markets stay on the site and bets
          already placed settle as normal. No refunds, no emails.
          {!canStop && <span className={`ml-1 font-semibold ${FLAG_TONE.caution.text}`}>Deploy the API first.</span>}
        </li>
        <li>
          <b className="text-primary">Close and refund:</b> no bets, off the site, and every open bet is refunded. Each
          customer refunded gets an email saying so.
        </li>
        <li>
          <b className="text-primary">Close early:</b>{" "}
          {hours > 0 ? (
            <>
              stops taking bets {hours} hour{hours === 1 ? "" : "s"} before each market closes, for counts anyone can
              watch.
            </>
          ) : (
            <>
              off right now (0 hours). Set the hours under Safety in{" "}
              <Link href="/admin/settings" className="font-semibold text-accent-ink hover:underline">
                Settings
              </Link>
              .
            </>
          )}
        </li>
      </ul>

      {confirm && (
        <div className={`mt-3 rounded-md border px-3 py-3 text-sm ${FLAG_TONE.danger.banner}`}>
          <p className="font-semibold text-primary">
            Close &ldquo;{confirm.word}&rdquo; and refund?{" "}
            {confirm.openBets === null
              ? "Couldn't count the open bets on them. Every one is refunded and each of those customers emailed."
              : confirm.openBets === 0
                ? "There are no open bets on them, so nothing is refunded and no one is emailed."
                : `This refunds ${confirm.openBets} open bet${confirm.openBets === 1 ? "" : "s"} and emails each of those customers.`}
          </p>
          <p className="mt-1 text-xs text-secondary">Refunds can&rsquo;t be undone. Reopening later doesn&rsquo;t bring the bets back.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={closeAndRefund}
              disabled={busy !== null}
              className="pressable h-9 rounded-sm bg-no-solid px-4 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy === "close" ? "Closing…" : "Close and refund"}
            </button>
            <button
              type="button"
              onClick={() => setConfirm(null)}
              disabled={busy !== null}
              className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-secondary hover:text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-border pt-4">
        <p className="text-sm font-semibold">Controlled now</p>
        {words.length === 0 ? (
          <p className="mt-1 text-sm text-tertiary">Nothing. Every market takes bets as normal.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {words.map((w) => (
              <li key={w} className="flex flex-wrap items-center gap-2 rounded-md bg-element-2 px-3 py-2 text-sm">
                <span className="mr-auto flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="font-semibold">&ldquo;{w}&rdquo;</span>
                  {modesOf(w).map((m) => (
                    <span key={m} className={`rounded-sm px-1.5 text-xs font-semibold ${CHIP[m].className}`}>
                      {CHIP[m].label}
                    </span>
                  ))}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {modesOf(w).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => undo(m, w)}
                      disabled={busy !== null || (m === "stop" && !canStop)}
                      title={m === "close" ? "Bets already refunded stay refunded" : undefined}
                      className="h-8 rounded-sm border border-border bg-surface px-3 text-xs font-semibold text-secondary hover:text-primary disabled:opacity-40"
                    >
                      {busy === `undo:${m}:${w}` ? UNDO[m].busy : UNDO[m].label}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}

        {lists.close.length > 0 && (
          <div className="mt-3">
            {refund ? (
              <div className={`rounded-md border px-3 py-3 text-sm ${FLAG_TONE.danger.banner}`}>
                {refund.positions === 0 ? (
                  <p className="font-semibold text-primary">No open bets on closed markets. Nothing to refund.</p>
                ) : (
                  <p className="font-semibold text-primary">
                    {refund.positions} open bet{refund.positions === 1 ? "" : "s"} on {refund.markets} closed market
                    {refund.markets === 1 ? "" : "s"}: {money.format(refund.refundKobo)} to refund, each customer
                    emailed. This can&rsquo;t be undone.
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {refund.positions > 0 && (
                    <button
                      type="button"
                      onClick={refundNow}
                      disabled={busy !== null}
                      className="pressable h-9 rounded-sm bg-no-solid px-4 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      {busy === "refund" ? "Refunding…" : "Refund now"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRefund(null)}
                    disabled={busy !== null}
                    className="h-9 rounded-sm border border-border px-4 text-sm font-semibold text-secondary hover:text-primary"
                  >
                    {refund.positions > 0 ? "Cancel" : "OK"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-secondary">
                Open bets on closed markets are refunded on their own about every minute.{" "}
                <button
                  type="button"
                  onClick={previewRefund}
                  disabled={busy !== null}
                  className="font-semibold text-accent-ink hover:underline disabled:opacity-40"
                >
                  {busy === "refund-check" ? "Checking…" : "Refund them now…"}
                </button>
              </p>
            )}
          </div>
        )}
      </div>

      {error && <p className={`mt-3 rounded-md px-3 py-2 text-sm font-semibold ${FLAG_TONE.danger.chip}`}>{error}</p>}
    </section>
  );
}
