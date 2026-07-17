"use client";

import { useAdminState } from "@/lib/admin-store";

const fmt = (ts: number) =>
  new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function AuditLog() {
  const { audit } = useAdminState();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
      <p className="mt-1 text-sm text-secondary">
        Every admin action, newest first.
      </p>
      <div className="mt-5 rounded-xl border border-border bg-surface shadow-card">
        {audit.length === 0 ? (
          <p className="p-5 text-sm text-secondary">
            No admin actions recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {audit.map((a) => (
              <li key={a.id} className="px-5 py-3">
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="font-semibold">{a.action}</span>
                  <span className="min-w-0 truncate text-secondary">
                    {a.subject}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-tertiary">
                    {fmt(a.ts)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-secondary">
                  by {a.actor}
                  {a.detail ? ` — ${a.detail}` : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
