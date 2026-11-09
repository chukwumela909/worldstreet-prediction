"use client";

import { useState } from "react";
import { HandRaisedIcon as Stop } from "@heroicons/react/24/outline";
import { showToast } from "@/lib/toast-store";
import {
  fetchBookSettings,
  updateBookSettings,
  useAdminResource,
  type BookSettingsState,
} from "@/lib/admin-api";
import { isApiConfigured } from "@/lib/api-client";
import { FLAG_TONE } from "@/components/admin/risk-flags";

/**
 * Stop new bets on a type of market, and nothing else: a market whose
 * name holds one of these words as a whole word ("x posts") refuses new
 * bets (MARKET_STOPPED), stays on the site, and its open bets stay open
 * and settle as normal: no refunds, no emails. The quiet sibling of the
 * paused list, which also refunds every open bet and emails each
 * customer. Undone with "Allow bets again".
 */
export function StopBetsCard({
  state,
  onSaved,
  suggestion = "",
}: {
  state: BookSettingsState;
  onSaved: (next: BookSettingsState) => void;
  /** What the box starts with. */
  suggestion?: string;
}) {
  const stopped = state.settings.stoppedTopics;
  const paused = state.settings.pausedTopics ?? [];
  const [text, setText] = useState(suggestion);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const topic = text.trim().toLowerCase().replace(/\s+/g, " ");

  const save = async (next: string[], key: string, done: string) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      onSaved(await updateBookSettings({ stoppedTopics: next }));
      showToast(done, "success");
      return true;
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't save. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    if (!stopped || !topic) return;
    if (stopped.includes(topic)) {
      setError(`“${topic}” markets already take no new bets.`);
      return;
    }
    const ok = await save(
      [...stopped, topic],
      "stop",
      `No new bets on “${topic}” markets. Bets already placed stay open.`,
    );
    if (ok) setText("");
  };

  return (
    <section className="mt-5 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-start gap-2">
        <Stop className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Stop new bets</h2>
          <p className="mt-0.5 text-sm text-secondary">
            Markets with these words in their name stop taking new bets. That&rsquo;s all: they stay on the site, and
            bets already placed stay open and settle as normal. No refunds, no emails.
          </p>
        </div>
      </div>

      {!Array.isArray(stopped) ? (
        <p className={`mt-3 rounded-md px-3 py-2 text-sm font-semibold ${FLAG_TONE.caution.chip}`}>
          The API is older than this page. Deploy the API, then this button works.
        </p>
      ) : (
        <>
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void stop();
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">Markets to stop, by a word in their name</span>
              <input
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. x posts"
                maxLength={40}
                className="h-9 w-full rounded-md border border-border bg-sunken px-3 text-sm outline-none placeholder:text-tertiary focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={busy !== null || topic.length < 2}
              className="pressable h-9 shrink-0 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent disabled:opacity-40"
            >
              {busy === "stop" ? "Stopping…" : "Stop new bets"}
            </button>
          </form>

          {paused.includes(topic) && (
            <p className="mt-2 text-xs text-secondary">
              &ldquo;{topic}&rdquo; markets are already closed for everyone on the paused list.
            </p>
          )}

          <div className="mt-3">
            {stopped.length === 0 ? (
              <p className="text-sm text-tertiary">Nothing is stopped. Every market takes bets as normal.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {stopped.map((t) => (
                  <li
                    key={t}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-element-2 px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-semibold">&ldquo;{t}&rdquo;</span>{" "}
                      <span className="text-secondary">markets take no new bets</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void save(
                          stopped.filter((s) => s !== t),
                          `allow:${t}`,
                          `“${t}” markets take bets again.`,
                        )
                      }
                      disabled={busy !== null}
                      className="h-8 rounded-sm border border-border px-3 text-xs font-semibold text-secondary hover:text-primary disabled:opacity-40"
                    >
                      {busy === `allow:${t}` ? "Allowing…" : "Allow bets again"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {error && <p className={`mt-3 rounded-md px-3 py-2 text-sm font-semibold ${FLAG_TONE.danger.chip}`}>{error}</p>}
    </section>
  );
}

/** The card on its own, reading the settings itself: for Take action. */
export function StopBetsPanel({ suggestion }: { suggestion?: string }) {
  const resource = useAdminResource(fetchBookSettings, isApiConfigured());
  const [saved, setSaved] = useState<{ state: BookSettingsState; over: BookSettingsState | null } | null>(null);
  const state = saved && saved.over === resource.data ? saved.state : resource.data;

  if (!state) {
    return (
      <section className="mt-5 rounded-xl border border-border bg-surface p-4 text-sm text-secondary shadow-card sm:p-5">
        {resource.error ? (
          <>
            Couldn&rsquo;t load Stop new bets: {resource.error}{" "}
            <button type="button" onClick={resource.refresh} className="font-semibold text-accent-ink">
              Try again
            </button>
          </>
        ) : (
          "Loading Stop new bets…"
        )}
      </section>
    );
  }
  return (
    <StopBetsCard
      state={state}
      suggestion={suggestion}
      onSaved={(next) => setSaved({ state: next, over: resource.data })}
    />
  );
}
