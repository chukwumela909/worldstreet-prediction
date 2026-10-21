"use client";

import { useEffect, useState } from "react";
import {
  ArrowPathIcon as RefreshCw,
  ChatBubbleLeftRightIcon as Chat,
  ChevronDownIcon as ChevronDown,
  MagnifyingGlassIcon as Search,
} from "@heroicons/react/24/outline";
import { ApiError, isApiConfigured } from "@/lib/api-client";
import {
  SUPPORT_CATEGORY_LABEL,
  fetchSupportInbox,
  fetchSupportTicket,
  replySupport,
  setSupportStatus,
  type SupportInbox,
  type SupportStatus,
  type SupportTicketDetail,
  type SupportTicketRow,
} from "@/lib/admin-api";
import { useAdminMoney } from "@/lib/admin-money";
import { showToast } from "@/lib/toast-store";
import { FLAG_TONE } from "@/components/admin/risk-flags";

/**
 * The support inbox: what customers sent from the site's Support page.
 * "Waiting on us" first — new requests and customers who wrote again —
 * then answered (waiting on them), closed, or everything. Opening one
 * shows the thread, the customer's account at a glance, and the reply
 * box; every reply is emailed to the customer too. Closing is a click,
 * and a customer writing again opens it back up on its own.
 */

type View = SupportStatus | "all";

const VIEWS: { key: View; label: string }[] = [
  { key: "open", label: "Waiting on us" },
  { key: "answered", label: "Answered" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

const STATUS_CHIP: Record<SupportStatus, { label: string; className: string }> = {
  open: { label: "Waiting on us", className: FLAG_TONE.caution.chip },
  answered: { label: "Answered", className: "bg-yes-tint text-yes" },
  closed: { label: "Closed", className: "bg-element-2 text-tertiary" },
};

const PAGE = 50;

export function SupportDesk() {
  const [view, setView] = useState<View>("open");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [reloads, setReloads] = useState(0);
  const [openRef, setOpenRef] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const [loaded, setLoaded] = useState<{
    key: string;
    data: SupportInbox | null;
    error: string | null;
    errorCode: string | null;
  } | null>(null);
  const configured = isApiConfigured();
  const key = `${view}|${query}|${offset}|${reloads}`;

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    fetchSupportInbox({ status: view, search: query, offset })
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

  if (!configured) {
    return <Notice>This desk needs the prediction API (NEXT_PUBLIC_API_URL).</Notice>;
  }
  const fresh = loaded?.key === key ? loaded : null;
  if (fresh?.errorCode === "FORBIDDEN") {
    return <Notice>Your account isn&rsquo;t an admin of the Local book.</Notice>;
  }
  if (fresh?.errorCode === "NOT_FOUND") {
    return <Notice>The API answering is older than this page — redeploy the API.</Notice>;
  }

  const inbox = fresh?.data ?? loaded?.data ?? null;
  const loading = fresh === null;
  const reload = () => setReloads((n) => n + 1);

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
          <p className="mt-1 text-sm text-secondary">
            Questions customers sent from the site. Your replies are emailed to them.
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {inbox && !inbox.mailConfigured && (
        <p className="mt-4 rounded-md bg-warning-tint px-3 py-2 text-sm font-semibold text-warning">
          Customer email isn&rsquo;t set up on the API (RESEND_API_KEY and a sender), so replies show on
          the site but aren&rsquo;t emailed.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Which requests" className="inline-flex max-w-full overflow-x-auto rounded-md bg-element-2 p-1">
          {VIEWS.map((v) => {
            const n = v.key === "all" ? null : inbox?.counts[v.key];
            return (
              <button
                key={v.key}
                type="button"
                aria-pressed={view === v.key}
                onClick={() => {
                  setView(v.key);
                  setOffset(0);
                  setOpenRef(null);
                }}
                className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-3 text-sm font-semibold ${
                  view === v.key ? "bg-surface text-primary shadow-card" : "text-secondary hover:text-primary"
                }`}
              >
                {v.label}
                {n !== undefined && n !== null && (
                  <span
                    className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                      v.key === "open" && n > 0 ? FLAG_TONE.caution.chip : "bg-element text-tertiary"
                    }`}
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
          <span className="sr-only">Search requests</span>
          <span className="flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-3">
            <Search className="size-4 shrink-0 text-secondary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Request number, email, username or subject"
              className="w-full min-w-0 bg-transparent text-sm font-medium outline-none placeholder:text-tertiary"
            />
          </span>
        </label>
      </div>

      <section className="mt-4">
        {fresh?.error && <p className="mb-3 text-sm font-semibold text-no">Couldn&rsquo;t load: {fresh.error}</p>}
        {loading && !inbox ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading requests">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-element-2" />
            ))}
          </div>
        ) : !inbox || inbox.tickets.length === 0 ? (
          <p className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface py-12 text-center text-sm text-secondary shadow-card">
            <Chat className="size-6 text-tertiary" />
            {query
              ? `No requests match “${query}”.`
              : view === "open"
                ? "Nothing waiting — every request has an answer."
                : "No requests here."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {inbox.tickets.map((t) => (
              <TicketItem
                key={t.ref}
                row={t}
                open={openRef === t.ref}
                onToggle={() => setOpenRef(openRef === t.ref ? null : t.ref)}
                onChanged={reload}
              />
            ))}
          </ul>
        )}
        {inbox && inbox.total > PAGE && (
          <div className="mt-4 flex items-center justify-between text-[13px] font-medium text-tertiary">
            <span>
              Showing {offset + 1}–{Math.min(offset + PAGE, inbox.total)} of {inbox.total}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(offset - PAGE, 0))}
                className="h-9 rounded-full border border-border px-4 font-semibold text-secondary disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={offset + PAGE >= inbox.total}
                onClick={() => setOffset(offset + PAGE)}
                className="h-9 rounded-full border border-border px-4 font-semibold text-secondary disabled:opacity-40"
              >
                Next
              </button>
            </span>
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------- one request ---------- */

function TicketItem({
  row,
  open,
  onToggle,
  onChanged,
}: {
  row: SupportTicketRow;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const chip = STATUS_CHIP[row.status];
  return (
    <li className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-element"
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-semibold">{row.subject}</span>
            <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${chip.className}`}>
              {chip.label}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs font-medium text-tertiary">
            {row.ref} · {SUPPORT_CATEGORY_LABEL[row.category]} · {row.username ? `@${row.username}` : ""}
            {row.email ? ` ${row.email}` : ""}
          </span>
          <span className="mt-1 line-clamp-2 block text-[13px] text-secondary">
            {row.lastFrom === "support" && <span className="font-semibold text-primary">You: </span>}
            {row.preview}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="whitespace-nowrap text-xs font-medium text-tertiary">{ago(row.lastMessageAt)}</span>
          <span className="text-[11px] text-tertiary">
            {row.messageCount} message{row.messageCount === 1 ? "" : "s"}
          </span>
          <ChevronDown className={`size-4 text-tertiary transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && <TicketThread ticketRef={row.ref} onChanged={onChanged} />}
    </li>
  );
}

function TicketThread({ ticketRef, onChanged }: { ticketRef: string; onChanged: () => void }) {
  const money = useAdminMoney();
  const [detail, setDetail] = useState<SupportTicketDetail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [reply, setReply] = useState("");
  const [closeAfter, setCloseAfter] = useState(false);
  const [busy, setBusy] = useState<"reply" | "status" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSupportTicket(ticketRef)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setFailed(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setFailed(err instanceof Error ? err.message : "Couldn't load this request");
      });
    return () => {
      cancelled = true;
    };
  }, [ticketRef, version]);

  const send = async () => {
    setBusy("reply");
    setError(null);
    try {
      const res = await replySupport(ticketRef, { message: reply.trim(), close: closeAfter });
      showToast(
        res.emailed ? "Reply sent — the customer has been emailed" : "Reply saved — but the email didn't go out",
        res.emailed ? "success" : "error",
      );
      setReply("");
      setCloseAfter(false);
      setVersion((v) => v + 1);
      onChanged();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Request failed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (status: "open" | "closed") => {
    setBusy("status");
    setError(null);
    try {
      await setSupportStatus(ticketRef, status);
      showToast(status === "closed" ? "Request closed" : "Request reopened", "success");
      setVersion((v) => v + 1);
      onChanged();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Request failed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (failed) {
    return (
      <p className="border-t border-border bg-page px-4 py-3 text-sm text-secondary">
        {failed}{" "}
        <button type="button" onClick={() => setVersion((v) => v + 1)} className="font-semibold text-primary underline">
          Try again
        </button>
      </p>
    );
  }
  if (!detail) {
    return <p className="border-t border-border bg-page px-4 py-3 text-sm text-secondary">Loading…</p>;
  }

  const { ticket, account } = detail;
  return (
    <div className="border-t border-border bg-page px-4 py-3">
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] font-medium text-secondary">
        <Meta label="Customer" value={[ticket.username && `@${ticket.username}`, ticket.email].filter(Boolean).join(" · ")} />
        <Meta label="Balance" value={money.format(account.balanceKobo)} />
        <Meta label="Bets" value={String(account.bets)} />
        <Meta label="Joined" value={day(account.joinedAt)} />
        <Meta label="Opened" value={when(ticket.createdAt)} />
      </dl>
      {account.suspendedAt && (
        <p className={`mt-2 rounded-md border px-3 py-2 text-[13px] ${FLAG_TONE.danger.banner}`}>
          <span className="font-semibold text-no">Suspended since {day(account.suspendedAt)}.</span>{" "}
          {account.suspendedReason && <span className="text-secondary">Reason: {account.suspendedReason}</span>}
        </p>
      )}

      <ol className="mt-3 flex flex-col gap-2">
        {ticket.messages.map((m, i) => (
          <li
            key={`${m.at}-${i}`}
            className={`max-w-[85%] rounded-md border px-3 py-2 ${
              m.from === "support" ? "self-end border-border bg-surface" : "self-start border-transparent bg-element-2"
            }`}
          >
            <p className="text-[11px] font-semibold text-tertiary">
              {m.from === "support" ? `Support${m.by ? ` · ${m.by}` : ""}` : ticket.username || "Customer"} · {when(m.at)}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{m.body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-3">
        <label className="block">
          <span className="text-xs font-medium text-secondary">Your reply — emailed to {ticket.email || "the customer"}</span>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="Write to the customer…"
            className="mt-1 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={send}
            disabled={busy !== null || reply.trim().length === 0}
            className="pressable h-9 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
          >
            {busy === "reply" ? "Sending…" : "Send reply"}
          </button>
          <label className="flex items-center gap-2 text-sm text-secondary">
            <input
              type="checkbox"
              checked={closeAfter}
              onChange={(e) => setCloseAfter(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Close after sending
          </label>
          <span className="flex-1" />
          {ticket.status === "closed" ? (
            <button
              type="button"
              onClick={() => setStatus("open")}
              disabled={busy !== null}
              className="h-9 rounded-sm border border-border px-3 text-sm font-semibold text-secondary hover:text-primary disabled:opacity-40"
            >
              Reopen
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStatus("closed")}
              disabled={busy !== null}
              className="h-9 rounded-sm border border-border px-3 text-sm font-semibold text-secondary hover:text-primary disabled:opacity-40"
            >
              Close without replying
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-sm font-semibold text-no">{error}</p>}
      </div>
    </div>
  );
}

/* ---------- bits ---------- */

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <dt className="shrink-0 text-tertiary">{label}</dt>
      <dd className="min-w-0 break-all">{value || "—"}</dd>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl rounded-xl border border-border bg-surface p-6 text-sm leading-6 text-secondary shadow-card">
      {children}
    </div>
  );
}

function ago(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const m = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return day(iso);
}

function day(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
