"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { StatusBadge } from "@/components/admin/status-badge";
import { MOCK_EVENTS } from "@/lib/mock-events";
import { CATEGORIES, type Category } from "@/types/market";
import {
  deleteEvent,
  effectiveStatus,
  setCreatedStatus,
  setEventStatus,
  useAdminState,
  type MarketStatus,
} from "@/lib/admin-store";
import { formatVolume } from "@/lib/format";
import { usePageNow } from "@/lib/use-now";

const STATUS_FILTERS = [
  "All",
  "draft",
  "live",
  "paused",
  "closed",
  "resolving",
  "resolved",
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

interface Row {
  id: string;
  title: string;
  icon: string;
  category: Category;
  volume: number;
  endDate: string;
  outcomes: number;
  status: MarketStatus;
  /** True for admin-created events (editable/deletable). */
  created: boolean;
}

export function MarketsTable() {
  const { user } = useAuth();
  const admin = useAdminState();
  const now = usePageNow();
  const [status, setStatus] = useState<StatusFilter>("All");
  const [category, setCategory] = useState<"All" | Category>("All");
  const [query, setQuery] = useState("");

  const rows = useMemo<Row[]>(() => {
    if (now === null) return [];
    const created = admin.created.map((e) => ({
      id: e.id,
      title: e.title,
      icon: e.icon,
      category: e.category,
      volume: 0,
      endDate: e.endDate,
      outcomes: e.outcomes.length,
      status:
        e.status === "live" && Date.parse(e.endDate) < now
          ? "closed"
          : e.status,
      created: true,
    }));
    const fixtures = MOCK_EVENTS.map((e) => ({
      id: e.id,
      title: e.title,
      icon: e.icon,
      category: e.category,
      volume: parseFloat(e.volume),
      endDate: e.endDate,
      outcomes: e.markets.length,
      status: effectiveStatus(e.id, e.endDate, now),
      created: false,
    }));
    return [...created, ...fixtures.sort((a, b) => b.volume - a.volume)];
  }, [admin, now]);

  if (now === null) return null;

  const q = query.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (status === "All" || r.status === status) &&
      (category === "All" || r.category === category) &&
      (q === "" || r.title.toLowerCase().includes(q)),
  );
  const actor = user?.name ?? "admin";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Markets</h1>
          <p className="mt-1 text-sm text-secondary">
            {rows.length} markets · {rows.filter((r) => r.status === "live").length} live
          </p>
        </div>
        <Link
          href="/admin/markets/new"
          className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          <Plus className="size-4" />
          New market
        </Link>
      </div>

      {/* filters */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-secondary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search markets"
            className="h-9 w-56 rounded-md border border-border bg-surface pl-8 pr-3 text-sm outline-none placeholder:text-secondary focus:border-border-active"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as "All" | Category)}
          className="h-9 rounded-md border border-border bg-surface px-2.5 text-sm font-medium outline-none focus:border-border-active"
        >
          <option value="All">All categories</option>
          {CATEGORIES.filter((c) => c !== "Trending").map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`h-9 rounded-md px-3 text-sm font-semibold capitalize transition-colors ${
                status === s
                  ? "bg-element-3 text-primary"
                  : "text-secondary hover:bg-element-2 hover:text-primary"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* table */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold text-secondary">
              <th className="px-5 py-3 font-semibold">Market</th>
              <th className="px-3 py-3 font-semibold">Category</th>
              <th className="px-3 py-3 text-right font-semibold">Volume</th>
              <th className="px-3 py-3 font-semibold">Ends</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="px-5 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-secondary">
                  No markets match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((r) => <MarketRow key={r.id} row={r} actor={actor} />)
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MarketRow({ row, actor }: { row: Row; actor: string }) {
  const set = (status: MarketStatus) =>
    row.created
      ? setCreatedStatus(row.id, status, actor)
      : setEventStatus(row.id, row.title, status, actor);

  const actions: { label: string; onClick: () => void; tone?: string }[] = [];
  if (row.status === "live") {
    actions.push({ label: "Pause", onClick: () => set("paused") });
    actions.push({ label: "Close", onClick: () => set("closed") });
  } else if (row.status === "paused") {
    actions.push({ label: "Resume", onClick: () => set("live") });
    actions.push({ label: "Close", onClick: () => set("closed") });
  } else if (row.status === "closed") {
    actions.push({ label: "Reopen", onClick: () => set("live") });
  } else if (row.status === "draft") {
    actions.push({ label: "Publish", onClick: () => set("live") });
    actions.push({
      label: "Delete",
      tone: "text-no",
      onClick: () => {
        if (window.confirm(`Delete draft "${row.title}"?`))
          deleteEvent(row.id, actor);
      },
    });
  }

  return (
    <tr className="transition-colors hover:bg-element-2/50">
      <td className="px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">{row.icon}</span>
          <div className="min-w-0">
            <div className="truncate font-semibold">{row.title}</div>
            <div className="text-xs text-secondary">
              {row.outcomes === 1 ? "Binary" : `${row.outcomes} outcomes`}
              {row.created && " · admin-created"}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-3 text-secondary">{row.category}</td>
      <td className="px-3 py-3 text-right text-secondary">
        {formatVolume(String(row.volume)).replace(" Vol.", "")}
      </td>
      <td className="px-3 py-3 text-secondary">
        {new Date(row.endDate).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </td>
      <td className="px-3 py-3">
        <StatusBadge status={row.status} />
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center justify-end gap-1">
          {row.created && (
            <Link
              href={`/admin/markets/${row.id}`}
              className="rounded-sm px-2 py-1 text-xs font-semibold text-secondary transition-colors hover:bg-element-2 hover:text-primary"
            >
              Edit
            </Link>
          )}
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={a.onClick}
              className={`rounded-sm px-2 py-1 text-xs font-semibold transition-colors hover:bg-element-2 ${
                a.tone ?? "text-secondary hover:text-primary"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </td>
    </tr>
  );
}
