"use client";

import { useEffect, useState } from "react";
import { CheckCircleIcon as Check } from "@heroicons/react/24/outline";
import { ApiError, isApiConfigured } from "@/lib/api-client";
import { fetchAbuseWatch, type AbusePerson, type AbuseWatch } from "@/lib/admin-api";
import type { AdminMoney } from "@/lib/admin-money";
import { AccountControl } from "@/components/admin/account-control";
import { FLAG_TONE } from "@/components/admin/risk-flags";

/** The pieces the Suspicious customers and Money checks tabs share. */

const NEUTRAL = "bg-element-2 text-secondary";

/** What a card is, so nobody has to guess whether it means someone broke the rules. */
export const VERDICT = {
  abuse: { label: "Likely abuse", chip: FLAG_TONE.danger.chip, count: FLAG_TONE.danger.text },
  suspicious: { label: "Suspicious", chip: FLAG_TONE.caution.chip, count: FLAG_TONE.caution.text },
  notAbuse: { label: "Not abuse", chip: NEUTRAL, count: "text-primary" },
  fault: { label: "System fault", chip: NEUTRAL, count: "text-primary" },
} as const;
export type Verdict = keyof typeof VERDICT;

/** The scans behind both tabs; `days` bounds the betting ones (0 = all time). */
export function useAbuseWatch(days: number) {
  const [reloads, setReloads] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    data: AbuseWatch | null;
    error: string | null;
    errorCode: string | null;
  } | null>(null);
  const configured = isApiConfigured();
  const key = `${days}|${reloads}`;

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    fetchAbuseWatch(days)
      .then((data) => {
        if (!cancelled) setLoaded({ key, data, error: null, errorCode: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoaded({
          key,
          data: null,
          error: err instanceof Error ? err.message : "Request failed",
          errorCode: err instanceof ApiError ? err.code : null,
        });
      });
    return () => {
      cancelled = true;
    };
    // key encodes every input to the request above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, key]);

  const fresh = loaded?.key === key ? loaded : null;
  return {
    configured,
    watch: fresh?.data ?? loaded?.data ?? null,
    loading: fresh === null,
    error: fresh?.error ?? null,
    errorCode: fresh?.errorCode ?? null,
    reload: () => setReloads((n) => n + 1),
  };
}

/** The notice a Watch tab shows instead of itself, or null when it can load. */
export function blockedNotice(configured: boolean, errorCode: string | null) {
  if (!configured) return <Notice>This desk needs the prediction API (NEXT_PUBLIC_API_URL).</Notice>;
  if (errorCode === "FORBIDDEN") return <Notice>Your account isn&rsquo;t an admin of the Local book.</Notice>;
  if (errorCode === "NOT_FOUND") return <Notice>The API answering is older than this page — redeploy the API.</Notice>;
  return null;
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl rounded-xl border border-border bg-surface p-6 text-sm leading-6 text-secondary shadow-card">
      {children}
    </div>
  );
}

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const v = VERDICT[verdict];
  return (
    <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${v.chip}`}>
      {v.label}
    </span>
  );
}

export function Count({ label, n, verdict }: { label: string; n: number; verdict: Verdict }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 shadow-card">
      <dt className="text-xs font-medium text-secondary">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${n > 0 ? VERDICT[verdict].count : ""}`}>{n}</dd>
    </div>
  );
}

export function Card({
  title,
  verdict,
  means,
  blurb,
  empty,
  children,
}: {
  title: string;
  verdict: Verdict;
  /** What the card means, in one line: is it abuse, and what to do. */
  means: string;
  /** How the scan finds them. */
  blurb: string;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
        {title}
        <VerdictChip verdict={verdict} />
      </h2>
      <p className="mt-1 text-sm font-semibold text-primary">{means}</p>
      <p className="mt-0.5 text-sm text-secondary">{blurb}</p>
      {empty ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-yes">
          <Check className="size-4" aria-hidden />
          Nobody here.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">{children}</ul>
      )}
    </section>
  );
}

/** One person on a list: who, the evidence, and the suspend control on demand. */
export function PersonRow({
  person,
  money,
  onChanged,
  compact,
  children,
}: {
  person: AbusePerson;
  money: AdminMoney;
  onChanged: () => void;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const Wrapper = compact ? "div" : "li";
  return (
    <Wrapper className={`rounded-md border border-border ${compact ? "bg-surface" : "bg-page"} p-3`}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="truncate">{person.displayName || person.username}</span>
            {person.suspendedAt && (
              <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${FLAG_TONE.danger.chip}`}>
                Suspended
              </span>
            )}
          </p>
          <p className="truncate text-xs text-tertiary">
            @{person.username}
            {person.email ? ` · ${person.email}` : ""} · balance {money.format(person.balanceKobo)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="h-8 shrink-0 rounded-sm border border-border px-3 text-xs font-semibold text-secondary hover:border-border-hover hover:text-primary"
        >
          {open ? "Close" : person.suspendedAt ? "Suspension…" : "Suspend…"}
        </button>
      </div>
      {children && <p className="mt-1.5 text-sm text-secondary">{children}</p>}
      {open && (
        <div className="mt-2">
          <AccountControl trader={person} actions={undefined} onChanged={onChanged} />
        </div>
      )}
    </Wrapper>
  );
}

export function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
