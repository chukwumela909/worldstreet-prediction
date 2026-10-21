"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChatBubbleLeftRightIcon as Chat,
  ChevronDownIcon as ChevronDown,
} from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/auth-context";
import { errorMessage, isApiConfigured } from "@/lib/api-client";
import { showToast } from "@/lib/toast-store";
import {
  SUPPORT_CATEGORIES,
  fetchMyTickets,
  openTicket,
  writeAgain,
  type SupportCategory,
  type SupportStatus,
  type SupportTicket,
} from "@/lib/support";

/**
 * The customer's support page: write to us (what it's about, a subject,
 * the message), and follow every request they've sent — our replies show
 * here and arrive by email too. Writing again on a closed request opens
 * it back up. Signed out, it asks them to log in first: every request is
 * tied to the account it's about.
 */

const STATUS: Record<SupportStatus, { label: string; className: string }> = {
  open: { label: "Awaiting reply", className: "bg-element-2 text-secondary" },
  answered: { label: "Replied", className: "bg-yes-tint text-yes" },
  closed: { label: "Closed", className: "bg-element-2 text-tertiary" },
};

const MIN_MESSAGE = 10;

export function SupportView() {
  const { user, openAuth } = useAuth();

  if (!isApiConfigured()) {
    return <Card>Support isn&rsquo;t available right now. Please try again later.</Card>;
  }
  if (!user) {
    return (
      <Card>
        <p className="text-base font-semibold text-primary">Log in to contact support</p>
        <p className="mt-1">
          Every request is tied to your account, so we can look into your bets and balance.
        </p>
        <button
          type="button"
          onClick={openAuth}
          className="pressable mt-4 h-10 rounded-sm bg-accent px-5 text-sm font-semibold text-on-accent hover:bg-accent-hover"
        >
          Log in
        </button>
      </Card>
    );
  }
  return <SignedIn email={user.email} />;
}

function SignedIn({ email }: { email: string }) {
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openRef, setOpenRef] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchMyTickets()
      .then((t) => {
        setTickets(t);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(errorMessage(err, "Couldn't load your requests")));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const replace = (t: SupportTicket) =>
    setTickets((list) => [t, ...(list ?? []).filter((x) => x.ref !== t.ref)]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start">
      <NewRequest
        email={email}
        onSent={(t) => {
          replace(t);
          setOpenRef(t.ref);
        }}
      />

      <section aria-labelledby="your-requests">
        <h2 id="your-requests" className="text-xl font-semibold">
          Your requests
        </h2>
        {loadError && !tickets ? (
          <p className="mt-3 text-sm text-secondary">
            {loadError}.{" "}
            <button type="button" onClick={load} className="font-semibold text-primary underline">
              Try again
            </button>
          </p>
        ) : !tickets ? (
          <div className="mt-3 flex flex-col gap-2" aria-busy="true" aria-label="Loading your requests">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-element-2" />
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <p className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-border bg-surface py-10 text-center text-sm text-secondary shadow-card">
            <Chat className="size-6 text-tertiary" />
            You haven&rsquo;t sent us anything yet.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {tickets.map((t) => (
              <TicketItem
                key={t.ref}
                ticket={t}
                open={openRef === t.ref}
                onToggle={() => setOpenRef(openRef === t.ref ? null : t.ref)}
                onUpdated={replace}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NewRequest({ email, onSent }: { email: string; onSent: (t: SupportTicket) => void }) {
  const [category, setCategory] = useState<SupportCategory>("money");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = subject.trim().length >= 3 && message.trim().length >= MIN_MESSAGE;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const t = await openTicket({ category, subject: subject.trim(), message: message.trim() });
      showToast(`Sent — your request number is ${t.ref}`, "success");
      setSubject("");
      setMessage("");
      onSent(t);
    } catch (err) {
      setError(errorMessage(err, "Couldn't send your message. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={send} className="rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <h2 className="text-xl font-semibold">Write to us</h2>
      <p className="mt-1 text-sm text-secondary">
        We reply here and by email to <span className="font-semibold text-primary">{email}</span>.
      </p>

      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-secondary">What is it about?</legend>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {SUPPORT_CATEGORIES.map((c) => (
            <label
              key={c.key}
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
                category === c.key ? "border-accent bg-element-2 text-primary" : "border-border text-secondary"
              }`}
            >
              <input
                type="radio"
                name="category"
                checked={category === c.key}
                onChange={() => setCategory(c.key)}
                className="accent-[var(--accent)]"
              />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-3 block">
        <span className="text-xs font-medium text-secondary">Subject</span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={120}
          placeholder="e.g. My withdrawal hasn't arrived"
          className="mt-1 h-10 w-full rounded-md border border-border bg-sunken px-3 text-sm outline-none placeholder:text-tertiary focus:border-accent"
        />
      </label>
      <label className="mt-3 block">
        <span className="text-xs font-medium text-secondary">Message</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          maxLength={4000}
          placeholder="Tell us what happened — the market, the amount and when helps us answer faster."
          className="mt-1 w-full resize-y rounded-md border border-border bg-sunken px-3 py-2 text-sm outline-none placeholder:text-tertiary focus:border-accent"
        />
      </label>
      {error && <p className="mt-2 text-sm font-semibold text-no">{error}</p>}
      <button
        type="submit"
        disabled={!ready || busy}
        className="pressable mt-3 h-10 w-full rounded-sm bg-accent px-5 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40 sm:w-auto"
      >
        {busy ? "Sending…" : "Send"}
      </button>
    </form>
  );
}

function TicketItem({
  ticket,
  open,
  onToggle,
  onUpdated,
}: {
  ticket: SupportTicket;
  open: boolean;
  onToggle: () => void;
  onUpdated: (t: SupportTicket) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chip = STATUS[ticket.status];
  const category = SUPPORT_CATEGORIES.find((c) => c.key === ticket.category)?.label ?? "";

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      onUpdated(await writeAgain(ticket.ref, text.trim()));
      setText("");
    } catch (err) {
      setError(errorMessage(err, "Couldn't send. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-element"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{ticket.subject}</span>
          <span className="mt-0.5 block truncate text-xs font-medium text-tertiary">
            {ticket.ref} · {category} · {when(ticket.lastMessageAt)}
          </span>
        </span>
        <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${chip.className}`}>
          {chip.label}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-tertiary transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-border bg-page px-4 py-3">
          <ol className="flex flex-col gap-2">
            {ticket.messages.map((m, i) => (
              <li
                key={`${m.at}-${i}`}
                className={`max-w-[88%] rounded-md border px-3 py-2 ${
                  m.from === "customer" ? "self-end border-border bg-surface" : "self-start border-transparent bg-element-2"
                }`}
              >
                <p className="text-[11px] font-semibold text-tertiary">
                  {m.from === "customer" ? "You" : "WorldStreet Support"} · {when(m.at)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{m.body}</p>
              </li>
            ))}
          </ol>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-secondary">
              {ticket.status === "closed" ? "Write again — this reopens the request" : "Add a message"}
            </span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={4000}
              className="mt-1 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
          {error && <p className="mt-1 text-sm font-semibold text-no">{error}</p>}
          <button
            type="button"
            onClick={send}
            disabled={busy || !text.trim()}
            className="mt-2 h-9 rounded-sm border border-border px-4 text-sm font-semibold text-primary hover:border-border-hover disabled:opacity-40"
          >
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      )}
    </li>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-xl rounded-xl border border-border bg-surface p-6 text-sm leading-6 text-secondary shadow-card">
      {children}
    </div>
  );
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
