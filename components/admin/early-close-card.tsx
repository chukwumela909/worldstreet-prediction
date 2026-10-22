"use client";

import { useState } from "react";
import { ClockIcon as Clock } from "@heroicons/react/24/outline";
import { showToast } from "@/lib/toast-store";
import { updateBookSettings, type BookSettingsState } from "@/lib/admin-api";

/**
 * Which markets close early: those whose answer shows itself before they
 * close — a count of posts or likes anyone can watch. A market whose name
 * holds one of these words stops taking bets "Close count markets early"
 * hours before its close (Settings → Safety), matched like paused topics.
 */
export function EarlyCloseCard({
  state,
  onSaved,
}: {
  state: BookSettingsState;
  onSaved: (next: BookSettingsState) => void;
}) {
  const saved = state.settings.earlyCloseTopics ?? [];
  const hours = state.settings.earlyCloseHours ?? 0;
  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = text ?? saved.join(", ");
  const topics = draft
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const dirty = topics.join(",") !== saved.join(",");

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateBookSettings({ earlyCloseTopics: topics }));
      setText(null);
      showToast(topics.length > 0 ? `Closing early: ${topics.join(", ")}` : "No markets close early now", "success");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-start gap-2">
        <Clock className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Markets that close early</h2>
          <p className="mt-0.5 text-sm text-secondary">
            Markets whose answer shows itself before they close — a count of posts or likes
            anyone can watch. They stop taking bets{" "}
            {hours > 0 ? (
              <b className="text-primary">
                {hours} hour{hours === 1 ? "" : "s"}
              </b>
            ) : (
              "a set time"
            )}{" "}
            before their close (Close count markets early, under Safety below)
            {hours === 0 ? " — which is off right now" : ""}.
          </p>
        </div>
      </div>
      <label htmlFor="early-close-topics" className="mt-4 block text-sm font-semibold">
        Topics
      </label>
      <p className="text-xs text-secondary">
        Words separated by commas, e.g. <span className="font-mono">x posts, likes</span>.
      </p>
      <div className="mt-2 flex flex-wrap gap-2 sm:flex-nowrap">
        <input
          id="early-close-topics"
          value={draft}
          onChange={(e) => setText(e.target.value)}
          placeholder="None"
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
      {error && <p className="mt-2 text-sm font-semibold text-no">{error}</p>}
    </section>
  );
}
