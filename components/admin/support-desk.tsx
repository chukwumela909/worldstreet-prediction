"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowPathIcon as RefreshCw,
  BookmarkIcon as Bookmark,
  ChatBubbleLeftRightIcon as Chat,
  MagnifyingGlassIcon as Search,
  PencilSquareIcon as Pencil,
  TrashIcon as Trash,
} from "@heroicons/react/24/outline";
import { ApiError, isApiConfigured } from "@/lib/api-client";
import {
  SUPPORT_CATEGORY_LABEL,
  assignSupport,
  createSavedReply,
  deleteSavedReply,
  fetchSavedReplies,
  fetchSupportInbox,
  fetchSupportTicket,
  replySupport,
  setSupportStatus,
  updateSavedReply,
  type SavedReply,
  type SupportInbox,
  type SupportOwner,
  type SupportStatus,
  type SupportTicketDetail,
} from "@/lib/admin-api";
import { useAdminMoney } from "@/lib/admin-money";
import { showToast } from "@/lib/toast-store";
import { useLinkedItem } from "@/components/admin/linked-item";
import { FLAG_TONE } from "@/components/admin/risk-flags";
import { when } from "@/components/admin/watch-parts";
import {
  Avatar,
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_QUIET,
  BulkBar,
  Cell,
  Chip,
  DetailPanel,
  DueChip,
  FilterTabs,
  InfoList,
  ListRow,
  ListTable,
  PageHeader,
  PanelSection,
  SearchField,
  StatTile,
  StatTiles,
  adminName,
  ago,
  useNow,
  type Tone,
} from "@/components/admin/kit";

/**
 * The support inbox, run like a helpdesk.
 *
 * Every request waiting on us has a reply-by time (money within the
 * hour; services/api SUPPORT_REPLY_HOURS) and the waiting list is sorted
 * by it, soonest first, late ones in red. Each has an owner — taken with
 * a click or by replying first — so two people never answer one
 * customer; "Mine" and "Unassigned" filter to them. Opening a request
 * slides its panel in: the customer at a glance, the thread, and the
 * reply box with the desk's saved replies. Ticked rows can be taken or
 * closed together.
 *
 * The open request lives in the URL (?ref=WS-…), which is what the
 * support emails link to: following one opens that request here, and
 * the back button closes it.
 */

type View = SupportStatus | "all";

const STATUS: Record<SupportStatus, { label: string; tone: Tone }> = {
  open: { label: "Waiting on us", tone: "warning" },
  answered: { label: "Answered", tone: "good" },
  closed: { label: "Closed", tone: "neutral" },
};

const PAGE = 50;
const REFRESH_MS = 60_000;
const COLUMNS = "24px minmax(0,2.4fr) minmax(0,1.4fr) minmax(0,1fr) 112px 84px";

export function SupportDesk() {
  const router = useRouter();
  const pathname = usePathname();
  const openRef = useLinkedItem("ref").target;
  const [view, setView] = useState<View>("open");
  const [owner, setOwner] = useState<SupportOwner>("anyone");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [reloads, setReloads] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [managing, setManaging] = useState(false);
  const now = useNow();

  // typing is a filter, not a request per keystroke
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // new requests turn up without a refresh
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") setReloads((n) => n + 1);
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const [loaded, setLoaded] = useState<{
    key: string;
    data: SupportInbox | null;
    error: string | null;
    errorCode: string | null;
  } | null>(null);
  const configured = isApiConfigured();
  const key = `${view}|${owner}|${query}|${offset}|${reloads}`;

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    fetchSupportInbox({ status: view, owner, search: query, offset })
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
  const me = inbox?.me ?? "";
  const reload = () => setReloads((n) => n + 1);
  const pick = (next: { view?: View; owner?: SupportOwner }) => {
    if (next.view) setView(next.view);
    if (next.owner) setOwner(next.owner);
    setOffset(0);
    setSelected(new Set());
  };
  const open = (ref: string) => router.replace(`${pathname}?ref=${encodeURIComponent(ref)}`, { scroll: false });
  const close = () => router.replace(pathname, { scroll: false });

  const tickets = inbox?.tickets ?? [];
  const allTicked = tickets.length > 0 && tickets.every((t) => selected.has(t.ref));
  const toggle = (ref: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });

  const bulk = async (what: "take" | "close") => {
    const refs = [...selected];
    setBulkBusy(true);
    const results = await Promise.allSettled(
      refs.map((ref) => (what === "take" ? assignSupport(ref, "me") : setSupportStatus(ref, "closed"))),
    );
    const done = results.filter((r) => r.status === "fulfilled").length;
    showToast(
      `${done} of ${refs.length} ${what === "take" ? "taken" : "closed"}`,
      done === refs.length ? "success" : "error",
    );
    setBulkBusy(false);
    setSelected(new Set());
    reload();
  };

  const waiting = inbox?.waiting;
  return (
    <div className="max-w-6xl">
      <PageHeader
        eyebrow="Inbox"
        title="Support"
        lede="Questions customers sent from the site. Your replies are emailed to them, and every request has a reply-by time — money questions within the hour."
        actions={
          <>
            <button type="button" onClick={() => setManaging(true)} className={BTN_GHOST}>
              <Bookmark className="size-4" />
              Saved replies
            </button>
            <button type="button" onClick={reload} className={BTN_GHOST}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </>
        }
      />

      {inbox && !inbox.mailConfigured && (
        <p className="mt-4 rounded-md bg-warning-tint px-3 py-2 text-sm font-semibold text-warning">
          Customer email isn&rsquo;t set up on the API (RESEND_API_KEY and a sender), so replies show on the site but
          aren&rsquo;t emailed.
        </p>
      )}

      <StatTiles>
        <StatTile
          label="Waiting on us"
          value={inbox?.counts.open ?? "—"}
          tone={inbox && inbox.counts.open > 0 ? "warning" : "neutral"}
          active={view === "open" && owner === "anyone"}
          onClick={() => pick({ view: "open", owner: "anyone" })}
        />
        <StatTile
          label="Late"
          value={waiting?.overdue ?? "—"}
          sub="Past their reply-by time — top of the list"
          tone={waiting && waiting.overdue > 0 ? "danger" : "neutral"}
        />
        <StatTile
          label="Mine"
          value={waiting?.mine ?? "—"}
          sub="Waiting, and yours"
          active={view === "open" && owner === "mine"}
          onClick={() => pick({ view: "open", owner: "mine" })}
        />
        <StatTile
          label="Unassigned"
          value={waiting?.unassigned ?? "—"}
          sub="Waiting, nobody has them"
          active={view === "open" && owner === "unassigned"}
          onClick={() => pick({ view: "open", owner: "unassigned" })}
        />
      </StatTiles>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <FilterTabs
          label="Which requests"
          value={view}
          onChange={(v) => pick({ view: v })}
          items={[
            { key: "open", label: "Waiting on us", count: inbox?.counts.open, alert: true },
            { key: "answered", label: "Answered", count: inbox?.counts.answered },
            { key: "closed", label: "Closed", count: inbox?.counts.closed },
            { key: "all", label: "All" },
          ]}
        />
        <FilterTabs
          label="Whose"
          value={owner}
          onChange={(o) => pick({ owner: o })}
          items={[
            { key: "anyone", label: "Everyone" },
            { key: "mine", label: "Mine" },
            { key: "unassigned", label: "Unassigned" },
          ]}
        />
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Request number, email, username or subject"
          icon={<Search className="size-4" />}
        />
      </div>

      <section className="mt-4">
        {fresh?.error && <p className="mb-3 text-sm font-semibold text-no">Couldn&rsquo;t load: {fresh.error}</p>}
        {loading && !inbox ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading requests">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-md bg-element-2" />
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <p className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface py-12 text-center text-sm text-secondary shadow-card">
            <Chat className="size-6 text-tertiary" />
            {query
              ? `No requests match “${query}”.`
              : view === "open" && owner === "anyone"
                ? "Nothing waiting — every request has an answer."
                : "No requests here."}
          </p>
        ) : (
          <ListTable
            label="Support requests"
            columns={COLUMNS}
            head={[
              <input
                key="all"
                type="checkbox"
                aria-label="Select every request on this page"
                checked={allTicked}
                onChange={() => setSelected(allTicked ? new Set() : new Set(tickets.map((t) => t.ref)))}
                className="size-4 accent-[var(--accent)]"
              />,
              "Request",
              "Customer",
              "Owner",
              view === "open" ? "Reply by" : "Status",
              "Last",
            ]}
          >
            {tickets.map((t) => (
              <ListRow
                key={t.ref}
                selected={t.ref === openRef || selected.has(t.ref)}
                onOpen={() => open(t.ref)}
                openLabel={`Open ${t.ref}: ${t.subject}`}
              >
                <Cell interactive className="hidden md:block">
                  <input
                    type="checkbox"
                    aria-label={`Select ${t.ref}`}
                    checked={selected.has(t.ref)}
                    onChange={() => toggle(t.ref)}
                    className="size-4 accent-[var(--accent)]"
                  />
                </Cell>
                <Cell>
                  <span className="block truncate font-semibold">{t.subject}</span>
                  <span className="block truncate text-xs text-tertiary">
                    {t.ref} · {SUPPORT_CATEGORY_LABEL[t.category]}
                    {t.lastFrom === "support" ? " · you replied last" : ""}
                  </span>
                </Cell>
                <Cell label="Customer">
                  <span className="inline-flex min-w-0 items-center gap-2 align-middle">
                    <Avatar name={t.username || t.email} />
                    <span className="truncate">{t.username ? `@${t.username}` : t.email}</span>
                  </span>
                </Cell>
                <Cell label="Owner">
                  <OwnerName label={t.assignee ?? ""} me={me} />
                </Cell>
                <Cell label={view === "open" ? "Reply by" : "Status"}>
                  {t.status === "open" ? <DueChip dueAt={t.dueAt} /> : <Chip tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Chip>}
                </Cell>
                <Cell label="Last" className="text-xs text-tertiary">
                  {ago(t.lastMessageAt, now)}
                </Cell>
              </ListRow>
            ))}
          </ListTable>
        )}

        {inbox && inbox.total > PAGE && (
          <div className="mt-4 flex items-center justify-between text-[13px] font-medium text-tertiary">
            <span>
              Showing {offset + 1}–{Math.min(offset + PAGE, inbox.total)} of {inbox.total}
            </span>
            <span className="flex gap-2">
              <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(offset - PAGE, 0))} className={BTN_GHOST}>
                Previous
              </button>
              <button type="button" disabled={offset + PAGE >= inbox.total} onClick={() => setOffset(offset + PAGE)} className={BTN_GHOST}>
                Next
              </button>
            </span>
          </div>
        )}

        <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
          <button type="button" disabled={bulkBusy} onClick={() => void bulk("take")} className={BTN_GHOST}>
            Take them
          </button>
          <button type="button" disabled={bulkBusy} onClick={() => void bulk("close")} className={BTN_GHOST}>
            Close them
          </button>
        </BulkBar>
      </section>

      {openRef && <TicketPanel key={openRef} ticketRef={openRef} me={me} onClose={close} onChanged={reload} />}
      <SavedRepliesPanel open={managing} onClose={() => setManaging(false)} />
    </div>
  );
}

/* ---------- one request, in the panel ---------- */

function TicketPanel({
  ticketRef,
  me,
  onClose,
  onChanged,
}: {
  ticketRef: string;
  me: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const money = useAdminMoney();
  const [detail, setDetail] = useState<SupportTicketDetail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [reply, setReply] = useState("");
  const [closeAfter, setCloseAfter] = useState(false);
  const [busy, setBusy] = useState<"reply" | "status" | "owner" | null>(null);
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
        if (cancelled) return;
        setFailed(
          err instanceof ApiError && err.code === "TICKET_NOT_FOUND"
            ? `There's no request ${ticketRef}.`
            : err instanceof Error
              ? err.message
              : "Couldn't load this request",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [ticketRef, version]);

  /** Run a write, then show its result here and in the list. */
  const act = async (kind: "reply" | "status" | "owner", write: () => Promise<unknown>, done: string) => {
    setBusy(kind);
    setError(null);
    try {
      await write();
      showToast(done, "success");
      setVersion((v) => v + 1);
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Request failed. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  };

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

  const ticket = detail?.ticket;
  const account = detail?.account;
  const owner = ticket?.assignee ?? "";
  const mine = owner !== "" && owner === me;

  return (
    <DetailPanel
      open
      onClose={onClose}
      wide
      eyebrow={
        <span className="inline-flex flex-wrap items-center gap-2">
          {ticketRef}
          {ticket && <Chip tone={STATUS[ticket.status].tone}>{STATUS[ticket.status].label}</Chip>}
          {ticket?.status === "open" && <DueChip dueAt={ticket.dueAt} />}
        </span>
      }
      title={ticket?.subject ?? (failed ? "Request not found" : "Loading…")}
      actions={
        ticket && (
          <>
            {mine ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void act("owner", () => assignSupport(ticketRef, "nobody"), "Put back for someone else")}
                className={BTN_GHOST}
              >
                Put back
              </button>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void act("owner", () => assignSupport(ticketRef, "me"), "It's yours")}
                className={BTN_GHOST}
              >
                {owner ? `Take it from ${adminName(owner)}` : "Take it"}
              </button>
            )}
            {ticket.status === "closed" ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void act("status", () => setSupportStatus(ticketRef, "open"), "Request reopened")}
                className={BTN_GHOST}
              >
                Reopen
              </button>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void act("status", () => setSupportStatus(ticketRef, "closed"), "Request closed")}
                className={BTN_GHOST}
              >
                Close without replying
              </button>
            )}
            {ticket.username && (
              <Link href={`/admin/customers?search=${encodeURIComponent(ticket.username)}`} className={BTN_QUIET}>
                Customer&rsquo;s page
              </Link>
            )}
          </>
        )
      }
    >
      {failed ? (
        <p className="text-sm text-secondary">
          {failed}{" "}
          <button type="button" onClick={() => setVersion((v) => v + 1)} className="font-semibold text-primary underline">
            Try again
          </button>
        </p>
      ) : !ticket || !account ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-element-2" />
          ))}
        </div>
      ) : (
        <>
          <PanelSection title="Customer">
            <InfoList
              items={[
                ["Customer", ticket.username ? `@${ticket.username}` : ""],
                ["Email", ticket.email],
                ["Balance", money.format(account.balanceKobo)],
                ["Bets", String(account.bets)],
                ["Joined", account.joinedAt ? when(account.joinedAt) : ""],
              ]}
            />
            {account.suspendedAt && (
              <p className={`mt-3 rounded-md border px-3 py-2 text-[13px] ${FLAG_TONE.danger.banner}`}>
                <span className="font-semibold text-no">Suspended since {when(account.suspendedAt)}.</span>{" "}
                {account.suspendedReason && <span className="text-secondary">Reason: {account.suspendedReason}</span>}
              </p>
            )}
          </PanelSection>

          <PanelSection title="Request">
            <InfoList
              items={[
                ["Topic", SUPPORT_CATEGORY_LABEL[ticket.category]],
                ["Opened", ticket.createdAt ? when(ticket.createdAt) : ""],
                ["Reply by", ticket.status === "open" && ticket.dueAt ? when(ticket.dueAt) : "—"],
                ["Owner", <OwnerName key="o" label={owner} me={me} />],
              ]}
            />
          </PanelSection>

          <PanelSection title="Conversation">
            <ol className="flex flex-col gap-2">
              {ticket.messages.map((m, i) => (
                <li
                  key={`${m.at}-${i}`}
                  className={`max-w-[88%] rounded-xl border px-3 py-2 ${
                    m.from === "support" ? "self-end border-border bg-page" : "self-start border-transparent bg-element-2"
                  }`}
                >
                  <p className="text-[11px] font-semibold text-tertiary">
                    {m.from === "support" ? `Support${m.by ? ` · ${adminName(m.by)}` : ""}` : ticket.username || "Customer"} ·{" "}
                    {when(m.at)}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{m.body}</p>
                </li>
              ))}
            </ol>
          </PanelSection>

          <section className="pt-4">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`reply-${ticketRef}`} className="text-xs font-medium text-secondary">
                Your reply — emailed to {ticket.email || "the customer"}
              </label>
              <SavedReplyPicker
                current={reply}
                fill={{ name: ticket.username, ref: ticketRef }}
                onInsert={(text) => setReply((r) => (r.trim() ? `${r.trimEnd()}\n\n${text}` : text))}
              />
            </div>
            <textarea
              id={`reply-${ticketRef}`}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={5}
              maxLength={4000}
              placeholder="Write to the customer…"
              className="mt-1.5 w-full resize-y rounded-md border border-border bg-page px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void send()} disabled={busy !== null || reply.trim().length === 0} className={BTN_PRIMARY}>
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
            </div>
            {!owner && <p className="mt-2 text-xs text-tertiary">Nobody has this yet — replying makes it yours.</p>}
            {error && <p className="mt-2 text-sm font-semibold text-no">{error}</p>}
          </section>
        </>
      )}
    </DetailPanel>
  );
}

function OwnerName({ label, me }: { label: string; me: string }) {
  if (!label) return <span className="text-tertiary">Unassigned</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-2 align-middle">
      <Avatar name={label} />
      <span className="truncate">{label === me ? "You" : adminName(label)}</span>
    </span>
  );
}

/* ---------- saved replies ---------- */

/*
 * One list for the whole desk, read once and shared by every picker and
 * the manage panel, so an edit shows everywhere at once.
 */
let savedReplies: SavedReply[] | null = null;
let savedLoading = false;
const savedListeners = new Set<() => void>();

function loadSavedReplies(force = false) {
  if (savedLoading || (savedReplies && !force)) return;
  savedLoading = true;
  fetchSavedReplies()
    .then((r) => {
      savedReplies = r;
    })
    .catch(() => {
      savedReplies ??= [];
    })
    .finally(() => {
      savedLoading = false;
      for (const l of savedListeners) l();
    });
}

function useSavedReplies(): SavedReply[] | null {
  const list = useSyncExternalStore(
    (l) => {
      savedListeners.add(l);
      return () => savedListeners.delete(l);
    },
    () => savedReplies,
    () => null,
  );
  useEffect(() => loadSavedReplies(), []);
  return list;
}

/** `{name}` → the customer's name, `{ref}` → the request number. */
function fillReply(body: string, fill: { name: string; ref: string }): string {
  return body.replaceAll("{name}", fill.name || "there").replaceAll("{ref}", fill.ref);
}

function SavedReplyPicker({
  current,
  fill,
  onInsert,
}: {
  current: string;
  fill: { name: string; ref: string };
  onInsert: (text: string) => void;
}) {
  const list = useSavedReplies();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (list ?? []).filter((r) => !f || r.title.toLowerCase().includes(f) || r.body.toLowerCase().includes(f));
  }, [list, filter]);

  const saveCurrent = async () => {
    setBusy(true);
    try {
      // keep the placeholders: what was written for this customer goes back to {name}/{ref}
      const body = current
        .trim()
        .replaceAll(fill.ref, "{ref}")
        .replace(fill.name ? new RegExp(`\\b${fill.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g") : /$^/, "{name}");
      await createSavedReply({ title: title.trim(), body });
      showToast("Saved for the whole desk", "success");
      loadSavedReplies(true);
      setSaving(false);
      setTitle("");
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : "Couldn't save it", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={`${BTN_QUIET} h-8 text-xs`}>
        <Bookmark className="size-4" />
        Saved replies
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-2 w-[min(22rem,80vw)] rounded-xl border border-border bg-surface p-2 shadow-popover">
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a saved reply"
            className="h-9 w-full rounded-md border border-border bg-page px-3 text-sm outline-none focus:border-accent"
          />
          <ul className="mt-2 max-h-64 overflow-y-auto">
            {list === null ? (
              <li className="px-2 py-3 text-sm text-tertiary">Loading…</li>
            ) : shown.length === 0 ? (
              <li className="px-2 py-3 text-sm text-tertiary">
                {list.length === 0 ? "No saved replies yet. Write one, then save it below." : "None match."}
              </li>
            ) : (
              shown.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onInsert(fillReply(r.body, fill));
                      setOpen(false);
                      setFilter("");
                    }}
                    className="w-full rounded-md px-2 py-2 text-left hover:bg-element-2"
                  >
                    <span className="block text-sm font-semibold">{r.title}</span>
                    <span className="line-clamp-1 block text-xs text-tertiary">{r.body}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="mt-1 border-t border-border pt-2">
            {saving ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (title.trim().length >= 2) void saveCurrent();
                }}
                className="flex gap-2"
              >
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Name it, e.g. Withdrawal delays"
                  maxLength={80}
                  className="h-9 min-w-0 flex-1 rounded-md border border-border bg-page px-3 text-sm outline-none focus:border-accent"
                />
                <button type="submit" disabled={busy || title.trim().length < 2} className={BTN_GHOST}>
                  Save
                </button>
              </form>
            ) : (
              <button
                type="button"
                disabled={current.trim().length < 2}
                onClick={() => setSaving(true)}
                className={`${BTN_QUIET} w-full justify-start`}
                title={current.trim() ? "" : "Write a reply first"}
              >
                Save this reply for the desk
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SavedRepliesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const list = useSavedReplies();
  const [editing, setEditing] = useState<string | "new" | null>(null);

  return (
    <DetailPanel
      open={open}
      onClose={onClose}
      eyebrow="Shared by the whole desk"
      title="Saved replies"
      actions={
        <button type="button" onClick={() => setEditing("new")} className={BTN_PRIMARY}>
          New saved reply
        </button>
      }
    >
      <p className="text-sm text-secondary">
        Answers to the questions that keep coming. Write <code className="font-mono text-xs">{"{name}"}</code> for the
        customer&rsquo;s name and <code className="font-mono text-xs">{"{ref}"}</code> for the request number — they&rsquo;re
        filled in when a reply is used.
      </p>
      {editing === "new" && (
        <div className="mt-4">
          <SavedReplyForm onDone={() => setEditing(null)} />
        </div>
      )}
      <ul className="mt-4 flex flex-col gap-2">
        {list === null ? (
          <li className="h-16 animate-pulse rounded-md bg-element-2" />
        ) : list.length === 0 && editing !== "new" ? (
          <li className="rounded-xl border border-border px-4 py-6 text-center text-sm text-tertiary">No saved replies yet.</li>
        ) : (
          list.map((r) =>
            editing === r.id ? (
              <li key={r.id}>
                <SavedReplyForm reply={r} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={r.id} className="rounded-xl border border-border px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{r.title}</p>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => setEditing(r.id)} aria-label={`Edit ${r.title}`} className={`${BTN_QUIET} h-8 w-8 px-0`}>
                      <Pencil className="size-4" />
                    </button>
                    <DeleteSavedReply reply={r} />
                  </span>
                </div>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-secondary">{r.body}</p>
                {r.updatedBy && <p className="mt-1 text-xs text-tertiary">Last changed by {adminName(r.updatedBy)}</p>}
              </li>
            ),
          )
        )}
      </ul>
    </DetailPanel>
  );
}

function SavedReplyForm({ reply, onDone }: { reply?: SavedReply; onDone: () => void }) {
  const [title, setTitle] = useState(reply?.title ?? "");
  const [body, setBody] = useState(reply?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const fields = { title: title.trim(), body: body.trim() };
      if (reply) await updateSavedReply(reply.id, fields);
      else await createSavedReply(fields);
      showToast(reply ? "Saved reply updated" : "Saved reply added", "success");
      loadSavedReplies(true);
      onDone();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't save it");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="rounded-xl border border-accent px-4 py-3"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Name, e.g. Withdrawal delays"
        maxLength={80}
        className="h-9 w-full rounded-md border border-border bg-page px-3 text-sm font-semibold outline-none focus:border-accent"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        maxLength={4000}
        placeholder="Hi {name}, …"
        className="mt-2 w-full resize-y rounded-md border border-border bg-page px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {error && <p className="mt-1 text-sm font-semibold text-no">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button type="submit" disabled={busy || title.trim().length < 2 || body.trim().length < 2} className={BTN_GHOST}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className={BTN_QUIET}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DeleteSavedReply({ reply }: { reply: SavedReply }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} aria-label={`Delete ${reply.title}`} className={`${BTN_QUIET} h-8 w-8 px-0`}>
        <Trash className="size-4" />
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={() =>
          void deleteSavedReply(reply.id)
            .then(() => {
              showToast("Saved reply deleted", "success");
              loadSavedReplies(true);
            })
            .catch((err: unknown) => showToast(err instanceof Error ? err.message : "Couldn't delete it", "error"))
        }
        className="h-8 rounded-sm bg-no-solid px-2.5 text-xs font-semibold text-white"
      >
        Delete
      </button>
      <button type="button" onClick={() => setConfirming(false)} className={`${BTN_QUIET} h-8 text-xs`}>
        Keep
      </button>
    </span>
  );
}

/* ---------- bits ---------- */

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl rounded-xl border border-border bg-surface p-6 text-sm leading-6 text-secondary shadow-card">
      {children}
    </div>
  );
}
