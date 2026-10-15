"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronDownIcon as ChevronDown,
  ArrowPathIcon as RefreshCw,
  MagnifyingGlassIcon as Search,
  UsersIcon as Users,
} from "@heroicons/react/24/outline";
import { formatNaira, formatNairaSigned } from "@/lib/format";
import { bookHref } from "@/lib/book";
import { isApiConfigured, ApiError } from "@/lib/api-client";
import {
  fetchTrader,
  fetchTraders,
  type TraderDetail,
  type TraderList,
  type TraderRow,
  type TraderSort,
} from "@/lib/admin-api";

/**
 * Who is playing the book.
 *
 * The public leaderboard answers "who is winning", which is a different
 * question from the one an operator asks — that one is "who is here at
 * all". So this lists every account with a local profile, the ones that
 * signed up and never staked included, and says for each what they have
 * staked, what is still riding, what they have realized and what credit
 * they are sitting on. Opening a row asks the API for that person's
 * actual positions, because "₩40,000 staked" doesn't say on what.
 *
 * Read-only on purpose: nothing here moves anyone's money. Settlement
 * is the Local book desk, and it acts on markets, not on people.
 */

const SORTS: { key: TraderSort; label: string }[] = [
  { key: "recent", label: "Last trade" },
  { key: "staked", label: "Staked" },
  { key: "pnl", label: "P&L" },
  { key: "balance", label: "Balance" },
  { key: "trades", label: "Trades" },
  { key: "joined", label: "Joined" },
];

const PAGE = 50;

export function TradersDesk() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TraderSort>("recent");
  const [activeOnly, setActiveOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [reloads, setReloads] = useState(0);

  // typing is a filter, not a request per keystroke
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  /**
   * One state object keyed by the request that produced it, set only
   * from the fetch's own callbacks. An effect that setStates in its
   * body cascades renders (and the lint rule says so); comparing the
   * loaded key against the current one gives "loading" for free, and
   * keeps the previous page on screen while the next one lands.
   */
  const [loaded, setLoaded] = useState<{
    key: string;
    data: TraderList | null;
    error: string | null;
    errorCode: string | null;
  } | null>(null);

  const configured = isApiConfigured();
  const key = `${query}|${sort}|${offset}|${activeOnly}|${reloads}`;

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    fetchTraders({ search: query, sort, offset, limit: PAGE, activeOnly })
      .then((data) => {
        if (!cancelled) {
          setLoaded({ key, data, error: null, errorCode: null });
        }
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
  const loading = fresh === null;
  const error = fresh?.error ?? null;
  const errorCode = fresh?.errorCode ?? null;

  if (!configured) {
    return (
      <Notice>
        This desk needs the prediction API. Set{" "}
        <code className="font-mono text-[13px]">NEXT_PUBLIC_API_URL</code> and
        rebuild.
      </Notice>
    );
  }

  if (errorCode === "FORBIDDEN") {
    return (
      <Notice>
        Your account isn&rsquo;t an admin of the Local book. Ask for the{" "}
        <code className="font-mono text-[13px]">admin</code> role on your
        central WorldStreet account.
      </Notice>
    );
  }

  // the last page that loaded stays visible while the next one is in flight
  const list = fresh?.data ?? loaded?.data ?? null;
  const rows = list?.traders ?? [];
  const summary = list?.summary;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Traders</h1>
          <p className="mt-1 text-sm text-secondary">
            Everyone with an account on the Local book, and what they play.
          </p>
        </div>
        <button
          onClick={() => setReloads((n) => n + 1)}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {summary && (
        <section className="mt-6 grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 shadow-card sm:grid-cols-4">
          <Stat
            label="People"
            value={String(summary.users)}
            note={`${summary.traders} have staked`}
          />
          <Stat
            label="Staked all time"
            value={formatNaira(summary.stakedKobo)}
            note={`${formatNaira(summary.openStakeKobo)} still riding`}
          />
          <Stat
            label="Traders' realized P&L"
            value={formatNairaSigned(summary.realizedPnlKobo)}
            valueClass={summary.realizedPnlKobo > 0 ? "text-no" : "text-yes"}
            note="the house made the opposite of this"
          />
          <Stat
            label="Credit held"
            value={formatNaira(summary.balanceKobo)}
            note="unspent balances"
          />
        </section>
      )}

      {/* search + filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-border bg-surface px-3">
          <Search className="size-4 shrink-0 text-secondary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, username or email"
            className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-tertiary"
          />
        </div>
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-semibold text-secondary">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => {
              setActiveOnly(e.target.checked);
              setOffset(0);
            }}
            className="size-4 accent-accent"
          />
          Only people who have traded
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-1 rounded-md border border-border p-0.5">
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => {
              setSort(s.key);
              setOffset(0);
            }}
            className={`h-8 rounded-[7.2px] px-3 text-[13px] font-semibold transition-colors ${
              sort === s.key
                ? "bg-element-2 text-primary"
                : "text-secondary hover:text-primary"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* rows */}
      <section className="mt-4">
        {error && errorCode !== "FORBIDDEN" && (
          <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm font-medium text-no">
            {error}
          </p>
        )}

        {loading && !list ? (
          <p className="py-10 text-center text-sm text-secondary">
            Loading traders…
          </p>
        ) : rows.length === 0 ? (
          <p className="flex flex-col items-center gap-2 py-12 text-center text-sm leading-6 text-secondary">
            <Users className="size-6 text-tertiary" />
            {query
              ? `Nobody matches “${query}”.`
              : activeOnly
                ? "Nobody has staked on the book yet."
                : "No accounts yet — a profile is created the first time somebody signs in."}
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
            {rows.map((t) => (
              <TraderRowItem key={t.authUserId} trader={t} />
            ))}
          </ul>
        )}

        {list && list.total > PAGE && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[13px] font-medium text-tertiary">
              {offset + 1}–{Math.min(offset + PAGE, list.total)} of {list.total}
              {list.truncated && " (scan capped)"}
            </p>
            <div className="flex gap-2">
              <PageButton
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(offset - PAGE, 0))}
              >
                Previous
              </PageButton>
              <PageButton
                disabled={offset + PAGE >= list.total}
                onClick={() => setOffset(offset + PAGE)}
              >
                Next
              </PageButton>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * One person, closed. Opening one fetches their positions — the list
 * endpoint deliberately doesn't carry them, since 50 people's worth of
 * bets is a payload nobody reads.
 */
function TraderRowItem({ trader }: { trader: TraderRow }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<TraderDetail | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    fetchTrader(trader.authUserId)
      .then(setDetail)
      .catch(() => setFailed(true));
  }, [trader.authUserId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) load();
  };

  const settled = trader.wonPositions + trader.lostPositions;

  return (
    <li className="border-b border-border last:border-0">
      <button
        onClick={toggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-element"
      >
        <Avatar name={trader.displayName || trader.username} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {trader.displayName}
          </span>
          <span className="block truncate text-xs font-medium text-tertiary">
            @{trader.username} · {trader.email}
          </span>
        </span>

        <span className="hidden w-24 shrink-0 text-right md:block">
          <Cell
            value={String(trader.trades)}
            note={
              trader.trades === 0
                ? "no trades"
                : `${trader.openPositions} open`
            }
          />
        </span>
        <span className="hidden w-28 shrink-0 text-right sm:block">
          <Cell value={formatNaira(trader.stakedKobo)} note="staked" />
        </span>
        <span className="w-28 shrink-0 text-right">
          <Cell
            value={
              settled === 0 ? "—" : formatNairaSigned(trader.realizedPnlKobo)
            }
            valueClass={
              settled === 0
                ? "text-tertiary"
                : trader.realizedPnlKobo < 0
                  ? "text-no"
                  : "text-yes"
            }
            note={settled === 0 ? "nothing settled" : "realized"}
          />
        </span>
        <span className="hidden w-28 shrink-0 text-right lg:block">
          <Cell value={formatNaira(trader.balanceKobo)} note="balance" />
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-tertiary transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="border-t border-border bg-page px-4 py-3">
          <dl className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px] font-medium text-secondary">
            <Meta label="Joined" value={shortDate(trader.joinedAt)} />
            <Meta label="Last trade" value={shortDate(trader.lastTradeAt)} />
            <Meta
              label="Record"
              value={`${trader.wonPositions}W · ${trader.lostPositions}L · ${trader.voidedPositions} void`}
            />
            <Meta
              label="Open risk"
              value={`${formatNaira(trader.openStakeKobo)} → ${formatNaira(trader.openPayoutKobo)}`}
            />
            <Meta label="User id" value={trader.authUserId} mono />
          </dl>

          {failed ? (
            <p className="py-3 text-sm text-secondary">
              Couldn&rsquo;t load this trader&rsquo;s positions.{" "}
              <button
                onClick={load}
                className="font-semibold text-primary underline"
              >
                Try again
              </button>
            </p>
          ) : !detail ? (
            <p className="py-3 text-sm text-secondary">Loading positions…</p>
          ) : detail.positions.length === 0 ? (
            <p className="py-3 text-sm text-secondary">
              This account has never staked.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {detail.positions.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <Link
                      href={bookHref(p.eventSlug, p.eventId)}
                      className="block truncate text-[13px] font-semibold hover:underline"
                    >
                      {p.eventTitle}
                    </Link>
                    <span className="block truncate text-xs font-medium text-tertiary">
                      {p.marketTitle} · {p.outcomeLabel} @{" "}
                      {(p.priceKobo / 100).toFixed(0)}¢ ·{" "}
                      {shortDate(p.createdAt)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[13px] font-semibold">
                    {formatNaira(p.stakeKobo)}
                  </span>
                  <StatusPill status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

const STATUS_CLASS: Record<string, string> = {
  open: "bg-element-2 text-secondary",
  won: "bg-yes-tint text-yes",
  lost: "bg-no-tint text-no",
  voided: "bg-element-2 text-tertiary",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`w-16 shrink-0 rounded-sm py-1 text-center text-[11px] font-bold uppercase tracking-wide ${
        STATUS_CLASS[status] ?? "bg-element-2 text-secondary"
      }`}
    >
      {status}
    </span>
  );
}

/** Initials on a name-derived hue — no remote avatar host to configure. */
function Avatar({ name }: { name: string }) {
  let hue = 0;
  for (let i = 0; i < name.length; i++) hue = (hue * 31 + name.charCodeAt(i)) % 360;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 60% 50%), hsl(${(hue + 60) % 360} 60% 40%))`,
      }}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}

function Cell({
  value,
  note,
  valueClass,
}: {
  value: string;
  note: string;
  valueClass?: string;
}) {
  return (
    <>
      <span className={`block text-sm font-semibold ${valueClass ?? ""}`}>
        {value}
      </span>
      <span className="block text-xs font-medium text-tertiary">{note}</span>
    </>
  );
}

function Stat({
  label,
  value,
  note,
  valueClass,
}: {
  label: string;
  value: string;
  note: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-page px-3 py-2">
      <p className="text-xs font-medium text-secondary">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold ${valueClass ?? ""}`}>
        {value}
      </p>
      <p className="mt-0.5 truncate text-[13px] font-medium text-tertiary">
        {note}
      </p>
    </div>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <span className="flex gap-1.5">
      <dt className="text-tertiary">{label}</dt>
      <dd className={mono ? "font-mono text-[12px]" : ""}>{value}</dd>
    </span>
  );
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function PageButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-9 rounded-full border border-border px-4 text-sm font-semibold text-secondary transition-colors hover:border-border-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-secondary"
    >
      {children}
    </button>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6 text-sm leading-6 text-secondary shadow-card">
      {children}
    </div>
  );
}
