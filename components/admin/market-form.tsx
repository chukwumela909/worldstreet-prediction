"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { MarketCard } from "@/components/market/market-card";
import { MOCK_EVENTS } from "@/lib/mock-events";
import { CATEGORIES, type Category, type MarketEvent } from "@/types/market";
import {
  createEvent,
  deleteEvent,
  slugify,
  updateEvent,
  useAdminState,
  type AdminEvent,
  type AdminOutcome,
} from "@/lib/admin-store";

const inputCls =
  "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm outline-none placeholder:text-secondary focus:border-border-active";
const labelCls = "text-xs font-semibold text-secondary";

/** Authoring form for new markets and edits to admin-created ones. */
export function MarketForm({ initial }: { initial?: AdminEvent }) {
  const { user } = useAuth();
  const admin = useAdminState();
  const router = useRouter();

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(initial));
  const [icon, setIcon] = useState(initial?.icon ?? "🔮");
  const [category, setCategory] = useState<Category>(
    initial?.category ?? "Politics",
  );
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [binary, setBinary] = useState((initial?.outcomes.length ?? 1) === 1);
  const [yesPct, setYesPct] = useState(initial?.outcomes[0]?.yesPct ?? 50);
  const [outcomes, setOutcomes] = useState<AdminOutcome[]>(
    initial && initial.outcomes.length > 1
      ? initial.outcomes
      : [
          { label: "", yesPct: 50 },
          { label: "", yesPct: 30 },
        ],
  );
  const [rules, setRules] = useState(initial?.resolutionRules ?? "");
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugTouched ? slug : slugify(title);

  /** Synthesized event driving the live MarketCard preview. */
  const preview = useMemo<MarketEvent>(() => {
    const rows = binary
      ? [{ label: "Yes", yesPct }]
      : outcomes.map((o, i) => ({
          label: o.label || `Outcome ${i + 1}`,
          yesPct: o.yesPct,
        }));
    return {
      id: "preview",
      slug: effectiveSlug || "preview",
      title: title || "Your market question?",
      icon: icon || "🔮",
      category,
      volume: "0",
      endDate: endDate || "2026-12-31",
      markets: rows.map((o, i) => ({
        id: `preview-${i}`,
        question: title || "Your market question?",
        groupItemTitle: binary ? undefined : o.label,
        outcomePrices: [
          (o.yesPct / 100).toFixed(2),
          (1 - o.yesPct / 100).toFixed(2),
        ] as [string, string],
        volume: "0",
      })),
    };
  }, [binary, yesPct, outcomes, title, icon, category, endDate, effectiveSlug]);

  function validate(): string | null {
    if (!title.trim()) return "Title is required.";
    if (!effectiveSlug) return "Slug is required.";
    const taken =
      MOCK_EVENTS.some((e) => e.slug === effectiveSlug) ||
      admin.created.some(
        (e) => e.slug === effectiveSlug && e.id !== initial?.id,
      );
    if (taken) return `Slug "${effectiveSlug}" is already in use.`;
    if (!endDate) return "End date is required.";
    if (!binary) {
      if (outcomes.length < 2) return "Multi-outcome markets need at least 2 outcomes.";
      if (outcomes.some((o) => !o.label.trim()))
        return "Every outcome needs a label.";
    }
    if (!rules.trim()) return "Resolution rules are required — ambiguity causes disputes.";
    return null;
  }

  function save(publish: boolean) {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    const fields = {
      title: title.trim(),
      slug: effectiveSlug,
      icon: icon || "🔮",
      category,
      endDate,
      outcomes: binary
        ? [{ label: "Yes", yesPct }]
        : outcomes.map((o) => ({ ...o, label: o.label.trim() })),
      resolutionRules: rules.trim(),
    };
    const actor = user?.name ?? "admin";
    if (initial) {
      const status =
        initial.status === "draft" && publish ? "live" : initial.status;
      updateEvent(initial.id, fields, status, actor);
    } else {
      createEvent(fields, publish ? "live" : "draft", actor);
    }
    router.push("/admin/markets");
  }

  const isDraft = !initial || initial.status === "draft";

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_340px]">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {initial ? "Edit market" : "New market"}
        </h1>
        <p className="mt-1 text-sm text-secondary">
          {initial
            ? `Editing "${initial.title}"`
            : "Draft a market, review the preview, then publish."}
        </p>

        <div className="mt-6 flex flex-col gap-5">
          {/* title + icon */}
          <div className="flex gap-3">
            <div className="w-16">
              <label className={labelCls}>Icon</label>
              <input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className={`${inputCls} mt-1.5 text-center text-lg`}
                maxLength={4}
              />
            </div>
            <div className="flex-1">
              <label className={labelCls}>Question</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Will BTC hit $200k in 2026?"
                className={`${inputCls} mt-1.5`}
              />
            </div>
          </div>

          {/* slug */}
          <div>
            <label className={labelCls}>Slug</label>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="text-sm text-secondary">/event/</span>
              <input
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                className={inputCls}
              />
            </div>
          </div>

          {/* category + end date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                className={`${inputCls} mt-1.5`}
              >
                {CATEGORIES.filter((c) => c !== "Trending").map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>End date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={`${inputCls} mt-1.5`}
              />
            </div>
          </div>

          {/* market type */}
          <div>
            <label className={labelCls}>Market type</label>
            <div className="mt-1.5 flex gap-1 rounded-md bg-element-2 p-1">
              {(["Binary Yes/No", "Multi-outcome"] as const).map((t, i) => {
                const active = binary === (i === 0);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setBinary(i === 0)}
                    className={`h-8 flex-1 rounded-sm text-sm font-semibold transition-colors ${
                      active
                        ? "bg-surface text-primary shadow-card"
                        : "text-secondary hover:text-primary"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* outcomes */}
          {binary ? (
            <div>
              <label className={labelCls}>Initial Yes probability — {yesPct}%</label>
              <input
                type="range"
                min={1}
                max={99}
                value={yesPct}
                onChange={(e) => setYesPct(Number(e.target.value))}
                className="mt-2 w-full accent-(--accent)"
              />
            </div>
          ) : (
            <div>
              <label className={labelCls}>Outcomes</label>
              <div className="mt-1.5 flex flex-col gap-2">
                {outcomes.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      value={o.label}
                      onChange={(e) =>
                        setOutcomes(
                          outcomes.map((x, j) =>
                            j === i ? { ...x, label: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder={`Outcome ${i + 1}`}
                      className={inputCls}
                    />
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={o.yesPct}
                      onChange={(e) =>
                        setOutcomes(
                          outcomes.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  yesPct: Math.min(
                                    99,
                                    Math.max(1, Number(e.target.value) || 1),
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                      className={`${inputCls} w-20 text-right`}
                    />
                    <span className="text-sm text-secondary">%</span>
                    <button
                      type="button"
                      onClick={() =>
                        setOutcomes(outcomes.filter((_, j) => j !== i))
                      }
                      disabled={outcomes.length <= 2}
                      className="text-secondary transition-colors hover:text-no disabled:opacity-30"
                      aria-label={`Remove outcome ${i + 1}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setOutcomes([...outcomes, { label: "", yesPct: 10 }])
                  }
                  className="flex h-9 w-fit items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold text-secondary transition-colors hover:border-border-hover hover:text-primary"
                >
                  <Plus className="size-3.5" />
                  Add outcome
                </button>
              </div>
            </div>
          )}

          {/* resolution rules */}
          <div>
            <label className={labelCls}>Resolution rules</label>
            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={5}
              placeholder="Resolves Yes if… State the source of truth, the exact threshold, the timezone, and how edge cases resolve."
              className="mt-1.5 w-full rounded-md border border-border bg-surface p-3 text-sm outline-none placeholder:text-secondary focus:border-border-active"
            />
          </div>

          {error && (
            <p className="rounded-md bg-no-tint px-3 py-2 text-sm font-medium text-no">
              {error}
            </p>
          )}

          {/* actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
            {isDraft ? (
              <>
                <button
                  onClick={() => save(true)}
                  className="h-10 rounded-md bg-accent px-5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
                >
                  Publish
                </button>
                <button
                  onClick={() => save(false)}
                  className="h-10 rounded-md border border-border px-5 text-sm font-semibold text-secondary transition-colors hover:border-border-hover hover:text-primary"
                >
                  {initial ? "Save draft" : "Save as draft"}
                </button>
              </>
            ) : (
              <button
                onClick={() => save(false)}
                className="h-10 rounded-md bg-accent px-5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
              >
                Save changes
              </button>
            )}
            <Link
              href="/admin/markets"
              className="h-10 rounded-md px-4 text-sm font-semibold leading-10 text-secondary transition-colors hover:text-primary"
            >
              Cancel
            </Link>
            {initial && (
              <button
                onClick={() => {
                  if (window.confirm(`Delete "${initial.title}"?`)) {
                    deleteEvent(initial.id, user?.name ?? "admin");
                    router.push("/admin/markets");
                  }
                }}
                className="ml-auto h-10 rounded-md px-4 text-sm font-semibold text-no transition-colors hover:bg-no-tint"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* live preview */}
      <aside className="xl:sticky xl:top-6 xl:self-start">
        <div className={labelCls}>Card preview</div>
        <div className="pointer-events-none mt-1.5 w-[299px]">
          <MarketCard event={preview} />
        </div>
        <p className="mt-3 max-w-[299px] text-xs text-secondary">
          Exactly how the card renders on the home grid. Volume starts at $0.
        </p>
      </aside>
    </div>
  );
}
