"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { MarketEvent } from "@/types/market";
import type { EventComment, EventTrade, MarketHolder } from "@/lib/polymarket";
import { timeAgo } from "@/lib/format";
import { useAuth } from "@/components/auth/auth-context";
import { usePortfolio } from "@/lib/portfolio-store";

const TABS = ["Rules", "Comments", "Top Holders", "Activity"] as const;
type Tab = (typeof TABS)[number];

/** Rules / Comments / Top Holders / Activity tab strip + panels. */
export function EventTabs({ event }: { event: MarketEvent }) {
  const [tab, setTab] = useState<Tab>("Rules");
  const comments = useFetched<EventComment[]>(
    `/api/comments?eventId=${encodeURIComponent(event.id)}`,
    (body: { comments?: EventComment[] }) => body.comments ?? [],
  );
  // local, unsent comments the signed-in demo user posted this session
  const [posted, setPosted] = useState<{ user: string; text: string }[]>([]);

  const commentCount =
    comments.data === null ? null : comments.data.length + posted.length;

  return (
    <section>
      <div className="flex gap-6 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 border-b-2 pb-2.5 text-base font-semibold transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-secondary hover:text-primary"
            }`}
          >
            {t}
            {t === "Comments" && commentCount !== null && (
              <span className="ml-1 text-secondary">({commentCount})</span>
            )}
          </button>
        ))}
      </div>

      <div className="py-4">
        {tab === "Rules" && <Rules event={event} />}
        {tab === "Comments" && (
          <Comments
            state={comments}
            posted={posted}
            onPost={(c) => setPosted((prev) => [c, ...prev])}
          />
        )}
        {tab === "Top Holders" && <TopHolders event={event} />}
        {tab === "Activity" && <ActivityFeed event={event} />}
      </div>
    </section>
  );
}

/* ---------- shared fetch state ---------- */

interface Fetched<T> {
  /** null while loading */
  data: T | null;
  failed: boolean;
}

function useFetched<T>(
  url: string,
  pick: (body: never) => T,
): Fetched<T> {
  // the url is part of the stored state, so a changed url reads as
  // "loading" on the very next render — no synchronous reset needed
  const [state, setState] = useState<Fetched<T> & { url: string }>({
    url,
    data: null,
    failed: false,
  });

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((body) => {
        if (!cancelled) setState({ url, data: pick(body as never), failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url, data: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
    // pick is a stable inline mapper; url captures everything that matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return state.url === url ? state : { data: null, failed: false };
}

function PanelNote({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-secondary">{children}</p>;
}

/* ---------- avatars ---------- */

function TraderAvatar({
  name,
  avatarUrl,
  hue,
  className,
  px,
}: {
  name: string;
  avatarUrl?: string;
  hue: number;
  className: string;
  px: number;
}) {
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt=""
        width={px}
        height={px}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <span
      className={`shrink-0 rounded-full ${className}`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 60% 55%), hsl(${hue + 60} 60% 45%))`,
      }}
      aria-hidden
      title={name}
    />
  );
}

/* ---------- rules ---------- */

function Rules({ event }: { event: MarketEvent }) {
  return (
    <div className="text-sm leading-6 text-secondary">
      <p>
        This market will resolve to &ldquo;Yes&rdquo; if the outcome described in
        &ldquo;{event.title}&rdquo; occurs by{" "}
        {new Date(event.endDate + "T00:00:00Z").toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })}
        . Otherwise, it will resolve to &ldquo;No&rdquo;.
      </p>
      <p className="mt-2">
        The primary resolution source will be official announcements and a
        consensus of credible reporting.
      </p>
    </div>
  );
}

/* ---------- comments ---------- */

function Comments({
  state,
  posted,
  onPost,
}: {
  state: Fetched<EventComment[]>;
  posted: { user: string; text: string }[];
  onPost: (c: { user: string; text: string }) => void;
}) {
  const { user, openAuth } = useAuth();
  const [draft, setDraft] = useState("");

  const post = () => {
    const text = draft.trim();
    if (!text || !user) return;
    onPost({ user: user.name, text });
    setDraft("");
  };

  return (
    <div>
      {user ? (
        <div className="mb-5 flex gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-bold uppercase text-accent">
            {user.name[0]}
          </span>
          <div className="flex-1">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  post();
                }
              }}
              placeholder="Add a comment"
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-page px-3 py-2 text-sm outline-none placeholder:text-tertiary focus:border-border-active"
            />
            <div className="mt-1.5 flex justify-end">
              <button
                onClick={post}
                disabled={!draft.trim()}
                className="h-8 rounded-md bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                Post
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={openAuth}
          className="mb-5 w-full rounded-md border border-border bg-page px-3 py-2.5 text-left text-sm text-tertiary hover:border-border-hover"
        >
          Log in to comment
        </button>
      )}

      {state.failed ? (
        <PanelNote>Comments are unavailable right now.</PanelNote>
      ) : state.data === null ? (
        <PanelNote>Loading comments…</PanelNote>
      ) : state.data.length + posted.length === 0 ? (
        <PanelNote>No comments yet.</PanelNote>
      ) : (
        <ul className="flex flex-col gap-4">
          {posted.map((c, i) => (
            <CommentRow
              key={`own-${i}`}
              user={c.user}
              time="just now"
              text={c.text}
              hue={200}
            />
          ))}
          {state.data.map((c) => (
            <CommentRow
              key={c.id}
              user={c.user}
              time={c.createdAt ? timeAgo(c.createdAt) : ""}
              text={c.text}
              hue={c.hue}
              avatarUrl={c.avatarUrl}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CommentRow({
  user,
  time,
  text,
  hue,
  avatarUrl,
}: {
  user: string;
  time: string;
  text: string;
  hue: number;
  avatarUrl?: string;
}) {
  return (
    <li className="flex gap-3">
      <TraderAvatar name={user} avatarUrl={avatarUrl} hue={hue} className="mt-0.5 size-8" px={32} />
      <div>
        <p className="text-sm">
          <span className="font-semibold">{user}</span>{" "}
          {time && <span className="text-xs text-tertiary">{time}</span>}
        </p>
        <p className="mt-0.5 text-sm text-secondary">{text}</p>
      </div>
    </li>
  );
}

/* ---------- top holders ---------- */

function TopHolders({ event }: { event: MarketEvent }) {
  const conditionId = event.markets[0]?.conditionId;
  const state = useFetched<{ yes: MarketHolder[]; no: MarketHolder[] }>(
    `/api/holders?market=${encodeURIComponent(conditionId ?? "")}`,
    (body: { yes?: MarketHolder[]; no?: MarketHolder[] }) => ({
      yes: body.yes ?? [],
      no: body.no ?? [],
    }),
  );

  if (!conditionId || state.failed)
    return <PanelNote>Holder data is unavailable right now.</PanelNote>;
  if (state.data === null) return <PanelNote>Loading holders…</PanelNote>;

  const sides = [
    { label: "Yes holders", tone: "text-yes", rows: state.data.yes },
    { label: "No holders", tone: "text-no", rows: state.data.no },
  ];

  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
      {sides.map(({ label, tone, rows }) => (
        <div key={label}>
          <h3 className={`text-sm font-semibold ${tone}`}>{label}</h3>
          {rows.length === 0 ? (
            <PanelNote>No holders yet.</PanelNote>
          ) : (
            <ul className="mt-2">
              {rows.map((r, i) => (
                <li
                  key={r.name + i}
                  className="flex items-center gap-3 border-b border-border py-2.5 last:border-0"
                >
                  <span className="w-4 text-xs font-medium text-tertiary">{i + 1}</span>
                  <TraderAvatar
                    name={r.name}
                    avatarUrl={r.avatarUrl}
                    hue={r.hue}
                    className="size-7"
                    px={28}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {r.name}
                  </span>
                  <span className="text-sm font-medium text-secondary">
                    {Math.round(r.amount).toLocaleString("en-US")} shares
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- activity ---------- */

function ActivityFeed({ event }: { event: MarketEvent }) {
  const { user } = useAuth();
  const portfolio = usePortfolio();
  const state = useFetched<EventTrade[]>(
    `/api/trades?event=${encodeURIComponent(event.id)}`,
    (body: { trades?: EventTrade[] }) => body.trades ?? [],
  );

  // the user's own demo trades on this event, newest first
  const own = portfolio.activity
    .filter((a) => a.eventSlug === event.slug && a.type !== "deposit")
    .slice(0, 10)
    .map((a) => ({
      id: `own-${a.id}`,
      user: user?.name ?? "you",
      you: true,
      verb: a.type === "buy" ? "bought" : "sold",
      side: a.side!,
      amount: a.amount,
      price: a.price!,
      time: "just now",
      avatarUrl: undefined as string | undefined,
      hue: 200,
    }));

  if (state.failed && own.length === 0)
    return <PanelNote>Activity is unavailable right now.</PanelNote>;
  if (state.data === null && own.length === 0)
    return <PanelNote>Loading activity…</PanelNote>;

  const live = (state.data ?? []).map((t) => ({
    id: t.id,
    user: t.name,
    you: false,
    verb: t.side === "BUY" ? "bought" : "sold",
    side: (t.outcomeIndex === 1 ? "no" : "yes") as "yes" | "no",
    sideLabel: t.outcome,
    amount: t.size * t.price,
    price: t.price,
    time: timeAgo(t.timestamp),
    avatarUrl: t.avatarUrl,
    hue: t.hue,
  }));

  const rows = [
    ...own.map((o) => ({ ...o, sideLabel: o.side === "yes" ? "Yes" : "No" })),
    ...live,
  ];

  if (rows.length === 0) return <PanelNote>No recent activity.</PanelNote>;

  return (
    <ul className="flex flex-col">
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex items-center gap-3 border-b border-border py-3 last:border-0"
        >
          <TraderAvatar
            name={r.user}
            avatarUrl={r.avatarUrl}
            hue={r.hue}
            className="size-8"
            px={32}
          />
          <p className="min-w-0 flex-1 truncate text-sm">
            <span className="font-semibold">{r.user}</span>
            {r.you && (
              <span className="ml-1 rounded-sm bg-accent/20 px-1.5 py-0.5 text-xs font-semibold text-accent">
                You
              </span>
            )}{" "}
            <span className="text-secondary">{r.verb}</span>{" "}
            <span className={r.side === "yes" ? "text-yes" : "text-no"}>
              {r.sideLabel}
            </span>{" "}
            <span className="text-secondary">
              at {(r.price * 100).toFixed(0)}¢ ($
              {r.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })})
            </span>
          </p>
          <span className="shrink-0 text-xs font-medium text-tertiary">{r.time}</span>
        </li>
      ))}
    </ul>
  );
}
