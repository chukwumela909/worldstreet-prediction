"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Gavel } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { StatusBadge } from "@/components/admin/status-badge";
import { MOCK_EVENTS } from "@/lib/mock-events";
import {
  effectiveStatus,
  resolveEvent,
  unresolveEvent,
  useAdminState,
  type MarketStatus,
} from "@/lib/admin-store";
import { formatVolume } from "@/lib/format";
import { usePageNow } from "@/lib/use-now";

interface Item {
  id: string;
  title: string;
  icon: string;
  volume: number;
  endDate: string;
  /** Winning-outcome choices: ["Yes","No"] for binary. */
  choices: string[];
  status: MarketStatus;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export function ResolutionDesk() {
  const { user } = useAuth();
  const admin = useAdminState();
  const now = usePageNow();

  const { queue, resolved } = useMemo(() => {
    if (now === null) return { queue: [] as Item[], resolved: [] as Item[] };
    const fixtures: Item[] = MOCK_EVENTS.map((e) => ({
      id: e.id,
      title: e.title,
      icon: e.icon,
      volume: parseFloat(e.volume),
      endDate: e.endDate,
      choices:
        e.markets.length === 1
          ? ["Yes", "No"]
          : e.markets.map((m) => m.groupItemTitle ?? m.question),
      status: effectiveStatus(e.id, e.endDate, now),
    }));
    const created: Item[] = admin.created
      .filter((e) => e.status !== "draft")
      .map((e) => ({
        id: e.id,
        title: e.title,
        icon: e.icon,
        volume: 0,
        endDate: e.endDate,
        choices:
          e.outcomes.length === 1 ? ["Yes", "No"] : e.outcomes.map((o) => o.label),
        // Created events carry their own status; past end date closes them.
        status:
          e.status === "live" && Date.parse(e.endDate) < now
            ? "closed"
            : e.status,
      }));
    const all = [...created, ...fixtures];
    return {
      queue: all
        .filter((i) => i.status === "closed" || i.status === "resolving")
        .sort((a, b) => b.volume - a.volume),
      resolved: all
        .filter((i) => admin.resolutions[i.id])
        .sort(
          (a, b) =>
            (admin.resolutions[b.id]?.ts ?? 0) - (admin.resolutions[a.id]?.ts ?? 0),
        ),
    };
  }, [admin, now]);

  if (now === null) return null;
  const actor = user?.name ?? "admin";

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Resolution</h1>
      <p className="mt-1 text-sm text-secondary">
        Closed markets awaiting an outcome. Resolution pays $1 per winning
        share — check the rules and evidence before confirming.
      </p>

      <div className="mt-5 rounded-xl border border-border bg-surface shadow-card">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <Gavel className="size-6 text-tertiary" />
            <p className="text-sm text-secondary">
              The queue is empty — close a market from the Markets table and it
              lands here for an outcome.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {queue.map((i) => (
              <QueueRow key={i.id} item={i} actor={actor} />
            ))}
          </ul>
        )}
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Recently resolved</h2>
        <div className="mt-3 rounded-xl border border-border bg-surface shadow-card">
          {resolved.length === 0 ? (
            <p className="p-5 text-sm text-secondary">No resolutions yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {resolved.map((i) => {
                const r = admin.resolutions[i.id];
                return (
                  <li key={i.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="text-lg">{i.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {i.title}
                      </div>
                      <div className="text-xs text-secondary">
                        Resolved{" "}
                        <span className="font-semibold text-primary">
                          {r.outcome}
                        </span>{" "}
                        by {r.actor} ·{" "}
                        {new Date(r.ts).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                        {r.evidenceUrl && (
                          <>
                            {" · "}
                            <a
                              href={r.evidenceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 text-accent hover:underline"
                            >
                              evidence
                              <ExternalLink className="size-3" />
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                    <StatusBadge status="resolved" />
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            `Reopen "${i.title}"? Its resolution will be cleared.`,
                          )
                        )
                          unresolveEvent(i.id, i.title, actor);
                      }}
                      className="rounded-sm px-2 py-1 text-xs font-semibold text-secondary transition-colors hover:bg-element-2 hover:text-primary"
                    >
                      Reopen
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}

function QueueRow({ item, actor }: { item: Item; actor: string }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [evidence, setEvidence] = useState("");

  return (
    <li>
      <div className="flex items-center gap-3 px-5 py-3">
        <span className="text-lg">{item.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{item.title}</div>
          <div className="text-xs text-secondary">
            Ended {fmtDate(item.endDate)} ·{" "}
            {formatVolume(String(item.volume))}
          </div>
        </div>
        <StatusBadge status="closed" />
        <button
          onClick={() => setOpen(!open)}
          className={`h-8 rounded-sm px-3 text-xs font-semibold transition-colors ${
            open
              ? "bg-element-3 text-primary"
              : "bg-accent text-white hover:bg-accent-hover"
          }`}
        >
          {open ? "Cancel" : "Resolve"}
        </button>
      </div>

      {open && (
        <div className="border-t border-border bg-element-2/40 px-5 py-4">
          <div className="text-xs font-semibold text-secondary">
            Winning outcome
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.choices.map((c) => {
              const selected = choice === c;
              const yesNo = c === "Yes" || c === "No";
              const rest = yesNo
                ? c === "Yes"
                  ? "bg-yes-tint text-yes"
                  : "bg-no-tint text-no"
                : "bg-element-2 text-primary";
              const active = yesNo
                ? c === "Yes"
                  ? "bg-yes-solid text-white"
                  : "bg-no-solid text-white"
                : "bg-accent text-white";
              return (
                <button
                  key={c}
                  onClick={() => setChoice(selected ? null : c)}
                  className={`h-8 rounded-sm px-3 text-xs font-semibold transition-colors ${
                    selected ? active : rest
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="Evidence URL (optional)"
              className="h-9 w-72 rounded-md border border-border bg-surface px-3 text-sm outline-none placeholder:text-secondary focus:border-border-active"
            />
            <button
              disabled={!choice}
              onClick={() => {
                if (!choice) return;
                if (
                  window.confirm(
                    `Resolve "${item.title}" as "${choice}"? This settles the market.`,
                  )
                )
                  resolveEvent(
                    item.id,
                    item.title,
                    choice,
                    actor,
                    evidence.trim() || undefined,
                  );
              }}
              className="h-9 rounded-md bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              Confirm resolution
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
