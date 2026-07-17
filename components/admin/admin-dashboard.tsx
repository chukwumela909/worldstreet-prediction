"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CircleDollarSign, Clock3, Gavel, Radio } from "lucide-react";
import { StatusBadge } from "@/components/admin/status-badge";
import { MOCK_EVENTS } from "@/lib/mock-events";
import {
  effectiveStatus,
  useAdminState,
  type MarketStatus,
} from "@/lib/admin-store";
import { formatVolume } from "@/lib/format";
import { usePageNow } from "@/lib/use-now";

const DAY = 86_400_000;

interface Row {
  id: string;
  slug: string | null;
  title: string;
  icon: string;
  volume: number;
  endDate: string;
  status: MarketStatus;
}

export function AdminDashboard() {
  const admin = useAdminState();
  const now = usePageNow();

  const rows = useMemo<Row[]>(() => {
    if (now === null) return [];
    const fixtures = MOCK_EVENTS.map((e) => ({
      id: e.id,
      slug: e.slug,
      title: e.title,
      icon: e.icon,
      volume: parseFloat(e.volume),
      endDate: e.endDate,
      status: effectiveStatus(e.id, e.endDate, now),
    }));
    const created = admin.created.map((e) => ({
      id: e.id,
      slug: null, // admin-created events have no public page (UI demo only)
      title: e.title,
      icon: e.icon,
      volume: 0,
      endDate: e.endDate,
      status:
        e.status === "live" && Date.parse(e.endDate) < now
          ? "closed"
          : e.status,
    }));
    return [...created, ...fixtures];
  }, [admin, now]);

  // Server snapshot: statuses depend on the clock, render client-only.
  if (now === null) return null;

  const live = rows.filter((r) => r.status === "live");
  const pendingResolution = rows.filter(
    (r) => r.status === "closed" || r.status === "resolving",
  );
  const endingSoon = live
    .filter((r) => Date.parse(r.endDate) - now < 7 * DAY)
    .sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate));
  const totalVolume = rows.reduce((s, r) => s + r.volume, 0);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-secondary">
        Market operations at a glance.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Live markets"
          value={String(live.length)}
          icon={<Radio className="size-4 text-yes" />}
        />
        <StatCard
          label="Total volume"
          value={formatVolume(String(totalVolume)).replace(" Vol.", "")}
          icon={<CircleDollarSign className="size-4 text-secondary" />}
        />
        <StatCard
          label="Ending in 7 days"
          value={String(endingSoon.length)}
          icon={<Clock3 className="size-4 text-secondary" />}
        />
        <StatCard
          label="Pending resolution"
          value={String(pendingResolution.length)}
          icon={<Gavel className="size-4 text-no" />}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Queue
          title="Awaiting resolution"
          empty="Nothing to resolve — all closed markets are settled."
          rows={pendingResolution}
        />
        <Queue
          title="Ending soon"
          empty="No live markets end in the next 7 days."
          rows={endingSoon}
        />
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Recent admin activity</h2>
        <div className="mt-3 rounded-xl border border-border bg-surface shadow-card">
          {admin.audit.length === 0 ? (
            <p className="p-5 text-sm text-secondary">
              No admin actions yet. Changes to markets, statuses, and
              resolutions will appear here.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {admin.audit.slice(0, 8).map((a) => (
                <li key={a.id} className="flex items-baseline gap-2 px-5 py-3 text-sm">
                  <span className="font-semibold">{a.action}</span>
                  <span className="min-w-0 truncate text-secondary">
                    {a.subject}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-tertiary">
                    {new Date(a.ts).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between text-xs font-semibold text-secondary">
        {label}
        {icon}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function Queue({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: Row[];
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 rounded-xl border border-border bg-surface shadow-card">
        {rows.length === 0 ? (
          <p className="p-5 text-sm text-secondary">{empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const body = (
                <>
                  <span className="text-lg">{r.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {r.title}
                  </span>
                  <span className="hidden shrink-0 text-xs text-secondary sm:block">
                    {formatVolume(String(r.volume))}
                  </span>
                  <span className="shrink-0 text-xs text-secondary">
                    {new Date(r.endDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <StatusBadge status={r.status} />
                </>
              );
              const cls = "flex items-center gap-3 px-5 py-3";
              return (
                <li key={r.id}>
                  {r.slug ? (
                    <Link
                      href={`/event/${r.slug}`}
                      className={`${cls} transition-colors hover:bg-element-2`}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
