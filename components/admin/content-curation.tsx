"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Flame, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { MOCK_EVENTS } from "@/lib/mock-events";
import {
  DEFAULT_CONTENT,
  setContent,
  useAdminState,
  type ContentConfig,
} from "@/lib/admin-store";

const SLIDE_LABELS: Record<ContentConfig["heroSlides"][number]["key"], string> = {
  market: "Featured market slide",
  game: "Game slide — Spain vs. Argentina",
  btc: "Binary slide — Bitcoin $150k",
};

const inputCls =
  "h-9 rounded-md border border-border bg-surface px-3 text-sm outline-none placeholder:text-secondary focus:border-border-active";

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function ContentCuration() {
  const { user } = useAuth();
  const admin = useAdminState();
  const [draft, setDraft] = useState<ContentConfig>(admin.content);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  // Adopt the client store snapshot once it replaces the SSR default.
  useEffect(() => {
    if (!dirty) setDraft(admin.content);
  }, [admin.content, dirty]);

  const patch = (p: Partial<ContentConfig>) => {
    setDraft({ ...draft, ...p });
    setDirty(true);
    setSaved(false);
  };

  const enabledCount = draft.heroSlides.filter((s) => s.enabled).length;

  function save() {
    setContent(
      draft,
      user?.name ?? "admin",
      `${enabledCount} hero slides · ${draft.hotTopics.length} hot topics`,
    );
    setDirty(false);
    setSaved(true);
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Content</h1>
          <p className="mt-1 text-sm text-secondary">
            Curate the homepage: hero rotation and the promo-rail hot topics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && !dirty && (
            <span className="text-sm font-medium text-yes">Saved</span>
          )}
          <button
            onClick={() => {
              setDraft(DEFAULT_CONTENT);
              setDirty(true);
              setSaved(false);
            }}
            className="h-9 rounded-md border border-border px-4 text-sm font-semibold text-secondary transition-colors hover:border-border-hover hover:text-primary"
          >
            Reset to defaults
          </button>
          <button
            onClick={save}
            disabled={!dirty}
            className="h-9 rounded-md bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save changes
          </button>
        </div>
      </div>

      {/* hero rotation */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold">Featured hero</h2>
        <div className="mt-3 rounded-xl border border-border bg-surface p-5 shadow-card">
          <label className="text-xs font-semibold text-secondary">
            Featured market (first slide)
          </label>
          <select
            value={draft.heroFeaturedSlug}
            onChange={(e) => patch({ heroFeaturedSlug: e.target.value })}
            className={`${inputCls} mt-1.5 block w-full max-w-sm`}
          >
            {MOCK_EVENTS.map((e) => (
              <option key={e.slug} value={e.slug}>
                {e.icon} {e.title}
              </option>
            ))}
          </select>

          <div className="mt-5 text-xs font-semibold text-secondary">
            Rotation order
          </div>
          <ul className="mt-1.5 divide-y divide-border rounded-md border border-border">
            {draft.heroSlides.map((s, i) => (
              <li key={s.key} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-5 text-center text-xs font-semibold text-tertiary">
                  {i + 1}
                </span>
                <span
                  className={`flex-1 text-sm font-medium ${
                    s.enabled ? "" : "text-tertiary line-through"
                  }`}
                >
                  {SLIDE_LABELS[s.key]}
                </span>
                <Mover
                  onUp={() => patch({ heroSlides: move(draft.heroSlides, i, i - 1) })}
                  onDown={() => patch({ heroSlides: move(draft.heroSlides, i, i + 1) })}
                  upOk={i > 0}
                  downOk={i < draft.heroSlides.length - 1}
                />
                <button
                  onClick={() =>
                    patch({
                      heroSlides: draft.heroSlides.map((x, j) =>
                        j === i ? { ...x, enabled: !x.enabled } : x,
                      ),
                    })
                  }
                  disabled={s.enabled && enabledCount === 1}
                  className={`w-16 rounded-sm px-2 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    s.enabled
                      ? "bg-yes-tint text-yes hover:bg-element-2"
                      : "bg-element-2 text-secondary hover:text-primary"
                  }`}
                >
                  {s.enabled ? "On" : "Off"}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-secondary">
            At least one slide stays on. The featured market drives the first
            slide&apos;s chart and outcomes.
          </p>
        </div>
      </section>

      {/* hot topics */}
      <section className="mt-8">
        <h2 className="flex items-center gap-1.5 text-lg font-semibold">
          <Flame className="size-4 text-no" />
          Hot topics
        </h2>
        <div className="mt-3 rounded-xl border border-border bg-surface p-5 shadow-card">
          <ul className="flex flex-col gap-2">
            {draft.hotTopics.map((t, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-5 text-center text-xs font-semibold text-tertiary">
                  {i + 1}
                </span>
                <input
                  value={t.name}
                  onChange={(e) =>
                    patch({
                      hotTopics: draft.hotTopics.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x,
                      ),
                    })
                  }
                  placeholder="Topic"
                  className={`${inputCls} flex-1`}
                />
                <input
                  value={t.volumeToday}
                  onChange={(e) =>
                    patch({
                      hotTopics: draft.hotTopics.map((x, j) =>
                        j === i ? { ...x, volumeToday: e.target.value } : x,
                      ),
                    })
                  }
                  placeholder="$0"
                  className={`${inputCls} w-24 text-right`}
                />
                <Mover
                  onUp={() => patch({ hotTopics: move(draft.hotTopics, i, i - 1) })}
                  onDown={() => patch({ hotTopics: move(draft.hotTopics, i, i + 1) })}
                  upOk={i > 0}
                  downOk={i < draft.hotTopics.length - 1}
                />
                <button
                  onClick={() =>
                    patch({ hotTopics: draft.hotTopics.filter((_, j) => j !== i) })
                  }
                  className="text-secondary transition-colors hover:text-no"
                  aria-label={`Remove topic ${i + 1}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={() =>
              patch({
                hotTopics: [...draft.hotTopics, { name: "", volumeToday: "$0" }],
              })
            }
            className="mt-3 flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold text-secondary transition-colors hover:border-border-hover hover:text-primary"
          >
            <Plus className="size-3.5" />
            Add topic
          </button>
        </div>
      </section>
    </>
  );
}

function Mover({
  onUp,
  onDown,
  upOk,
  downOk,
}: {
  onUp: () => void;
  onDown: () => void;
  upOk: boolean;
  downOk: boolean;
}) {
  const cls =
    "rounded-sm p-1 text-secondary transition-colors hover:bg-element-2 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30";
  return (
    <span className="flex gap-0.5">
      <button onClick={onUp} disabled={!upOk} className={cls} aria-label="Move up">
        <ArrowUp className="size-3.5" />
      </button>
      <button onClick={onDown} disabled={!downOk} className={cls} aria-label="Move down">
        <ArrowDown className="size-3.5" />
      </button>
    </span>
  );
}
