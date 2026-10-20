"use client";

import { useState } from "react";
import { NoSymbolIcon as Paused } from "@heroicons/react/24/outline";
import { formatNaira } from "@/lib/format";
import { showToast } from "@/lib/toast-store";
import {
  updateBookSettings,
  voidPausedMarkets,
  type BookSettingsState,
  type PausedVoidResult,
} from "@/lib/admin-api";

/**
 * The desk's emergency stop for a whole topic. Markets whose name holds a
 * paused topic as a whole word ("bitcoin", "btc") take no bets and leave
 * the site within about a minute; "Void open bets" then refunds every
 * open stake on them — previewed first, because it can't be undone.
 */
export function PausedMarketsCard({
  state,
  onSaved,
}: {
  state: BookSettingsState;
  onSaved: (next: BookSettingsState) => void;
}) {
  const saved = state.settings.pausedTopics ?? [];
  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PausedVoidResult | null>(null);
  const [voiding, setVoiding] = useState<"preview" | "void" | null>(null);

  const draft = text ?? saved.join(", ");
  const topics = draft
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const dirty = topics.join(",") !== saved.join(",");
  const reason = `Paused topic: ${saved.join(", ")}`;

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updateBookSettings({ pausedTopics: topics });
      onSaved(next);
      setText(null);
      setPreview(null);
      showToast(
        topics.length > 0
          ? `Paused: ${topics.join(", ")} — off the site within about a minute`
          : "Nothing is paused now",
        "success",
      );
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const runVoid = async (dryRun: boolean) => {
    if (voiding) return;
    setVoiding(dryRun ? "preview" : "void");
    setError(null);
    try {
      const result = await voidPausedMarkets({ reason, dryRun });
      if (dryRun) {
        setPreview(result);
      } else {
        setPreview(null);
        showToast(
          `Voided ${result.positions} bet${result.positions === 1 ? "" : "s"} on ${result.markets} market${
            result.markets === 1 ? "" : "s"
          } — ${formatNaira(result.refundKobo)} refunded${
            result.emailed > 0 ? `, ${result.emailed} customer${result.emailed === 1 ? "" : "s"} emailed` : ""
          }`,
          "success",
        );
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't void. Try again.");
    } finally {
      setVoiding(null);
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-start gap-2">
        <Paused className="mt-0.5 size-5 shrink-0 text-no" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Paused markets</h2>
          <p className="mt-0.5 text-sm text-secondary">
            Stop every market on a topic at once. Markets whose name contains a paused word
            take no bets and disappear from the site within about a minute.
          </p>
        </div>
      </div>

      <label htmlFor="paused-topics" className="mt-4 block text-sm font-semibold">
        Paused topics
      </label>
      <p className="text-xs text-secondary">
        Words separated by commas, e.g. <span className="font-mono">bitcoin, btc</span>. Leave
        empty to un-pause everything.
      </p>
      <div className="mt-2 flex flex-wrap gap-2 sm:flex-nowrap">
        <input
          id="paused-topics"
          value={draft}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nothing paused"
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-sunken px-3 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="pressable flex h-10 shrink-0 items-center rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
        >
          {saving ? "Saving…" : "Save topics"}
        </button>
      </div>
      <p className="mt-2 text-xs font-medium text-tertiary">
        {saved.length > 0 ? `Paused now: ${saved.join(", ")}` : "Nothing is paused now."}
      </p>

      {saved.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-sm font-semibold">Void open bets on paused markets</p>
          <p className="text-xs text-secondary">
            Refunds every open stake on markets matching{" "}
            <span className="font-semibold">{saved.join(", ")}</span>, and emails each customer
            refunded. This also happens on its own about every minute while a topic is paused.
            Bets already settled are not changed. This can&rsquo;t be undone.
          </p>

          {preview ? (
            <div className="mt-3 rounded-md bg-no-tint px-3 py-3 text-sm">
              {preview.positions === 0 ? (
                <p className="font-semibold">No open bets on paused markets — nothing to void.</p>
              ) : (
                <p className="font-semibold text-no">
                  {preview.positions} open bet{preview.positions === 1 ? "" : "s"} on{" "}
                  {preview.markets} market{preview.markets === 1 ? "" : "s"} —{" "}
                  {formatNaira(preview.refundKobo)} will be refunded.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {preview.positions > 0 && (
                  <button
                    type="button"
                    onClick={() => runVoid(false)}
                    disabled={voiding !== null}
                    className="pressable flex h-9 items-center rounded-sm bg-no-solid px-4 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    {voiding === "void" ? "Voiding…" : "Void and refund now"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  disabled={voiding !== null}
                  className="flex h-9 items-center rounded-sm border border-border px-4 text-sm font-semibold text-secondary hover:text-primary"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => runVoid(true)}
              disabled={voiding !== null || dirty}
              className="mt-3 flex h-9 items-center rounded-sm border border-no/40 px-4 text-sm font-semibold text-no hover:bg-no-tint disabled:cursor-not-allowed disabled:opacity-40"
            >
              {voiding === "preview" ? "Checking…" : "Void open bets…"}
            </button>
          )}
          {dirty && (
            <p className="mt-2 text-xs text-secondary">Save the topics first.</p>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm font-semibold text-no">{error}</p>}
    </section>
  );
}
