"use client";

import { useMemo, useState } from "react";
import type { MarketEvent } from "@/types/market";
import { useAuth } from "@/components/auth/auth-context";
import { usePortfolio } from "@/lib/portfolio-store";
import { avatarGradient } from "@/lib/mock-leaderboard";

const TABS = ["Rules", "Comments", "Top Holders", "Activity"] as const;
type Tab = (typeof TABS)[number];

interface Comment {
  user: string;
  time: string;
  text: string;
}

const MOCK_COMMENTS: Comment[] = [
  { user: "market-maven", time: "2h ago", text: "Volume picking up fast on this one. The order book depth looks very one-sided." },
  { user: "0xtrader", time: "5h ago", text: "Priced about right imo. I don't see a catalyst before the deadline." },
  { user: "longshot-larry", time: "1d ago", text: "Buying the dip here. Historically these resolve Yes more often than the market thinks." },
];

/** Rules / Comments / Top Holders / Activity tab strip + panels. */
export function EventTabs({ event }: { event: MarketEvent }) {
  const [tab, setTab] = useState<Tab>("Rules");
  const [comments, setComments] = useState<Comment[]>(MOCK_COMMENTS);

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
            {t === "Comments" && (
              <span className="ml-1 text-secondary">({comments.length})</span>
            )}
          </button>
        ))}
      </div>

      <div className="py-4">
        {tab === "Rules" && <Rules event={event} />}
        {tab === "Comments" && (
          <Comments
            comments={comments}
            onPost={(c) => setComments((prev) => [c, ...prev])}
          />
        )}
        {tab === "Top Holders" && <TopHolders event={event} />}
        {tab === "Activity" && <ActivityFeed event={event} />}
      </div>
    </section>
  );
}

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
  comments,
  onPost,
}: {
  comments: Comment[];
  onPost: (c: Comment) => void;
}) {
  const { user, openAuth } = useAuth();
  const [draft, setDraft] = useState("");

  const post = () => {
    const text = draft.trim();
    if (!text || !user) return;
    onPost({ user: user.name, time: "just now", text });
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

      <ul className="flex flex-col gap-4">
        {comments.map((c, i) => (
          <li key={`${c.user}-${i}`} className="flex gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-element-2 text-xs font-bold uppercase text-secondary">
              {c.user[0]}
            </span>
            <div>
              <p className="text-sm">
                <span className="font-semibold">{c.user}</span>{" "}
                <span className="text-xs text-tertiary">{c.time}</span>
              </p>
              <p className="mt-0.5 text-sm text-secondary">{c.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- top holders ---------- */

const HOLDER_NAMES = [
  "deepvalue", "swisstony", "candlehammer", "maz26", "sparkling8899",
  "muchobliged", "weatherman12", "palegrit", "hot2trot", "cnyek",
];

/** Deterministic pseudo-random holders per event so the list is stable. */
function holdersFor(eventId: string, side: "yes" | "no") {
  let h = side === "yes" ? 7 : 13;
  for (let i = 0; i < eventId.length; i++) h = (h * 31 + eventId.charCodeAt(i)) % 9973;
  const start = h % HOLDER_NAMES.length;
  return Array.from({ length: 5 }, (_, i) => {
    h = (h * 48271) % 2147483647;
    // step 3 is coprime to the name-list length, so 5 picks stay distinct
    const name = HOLDER_NAMES[(start + i * 3) % HOLDER_NAMES.length];
    const shares = 12000 + (h % 880000);
    return { name, shares };
  }).sort((a, b) => b.shares - a.shares);
}

function TopHolders({ event }: { event: MarketEvent }) {
  const yes = useMemo(() => holdersFor(event.id, "yes"), [event.id]);
  const no = useMemo(() => holdersFor(event.id, "no"), [event.id]);

  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
      {[
        { label: "Yes holders", tone: "text-yes", rows: yes },
        { label: "No holders", tone: "text-no", rows: no },
      ].map(({ label, tone, rows }) => (
        <div key={label}>
          <h3 className={`text-sm font-semibold ${tone}`}>{label}</h3>
          <ul className="mt-2">
            {rows.map((r, i) => (
              <li
                key={r.name + i}
                className="flex items-center gap-3 border-b border-border py-2.5 last:border-0"
              >
                <span className="w-4 text-xs font-medium text-tertiary">{i + 1}</span>
                <span
                  className="size-7 shrink-0 rounded-full"
                  style={{ background: avatarGradient(r.name) }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {r.name}
                </span>
                <span className="text-sm font-medium text-secondary">
                  {r.shares.toLocaleString("en-US")} shares
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ---------- activity ---------- */

const FEED_SEED = [
  { user: "tankjack", side: "yes" as const, amount: 2480 },
  { user: "jsram", side: "no" as const, amount: 310 },
  { user: "myzbsq", side: "yes" as const, amount: 5900 },
  { user: "allezpapa", side: "yes" as const, amount: 120 },
  { user: "latetotheparty", side: "no" as const, amount: 1750 },
];
const FEED_TIMES = ["2m ago", "9m ago", "24m ago", "1h ago", "3h ago"];

function ActivityFeed({ event }: { event: MarketEvent }) {
  const { user } = useAuth();
  const portfolio = usePortfolio();

  const own = portfolio.activity
    .filter((a) => a.eventSlug === event.slug && a.type !== "deposit")
    .slice(0, 10);

  const market = event.markets[0];
  const rows = [
    ...own.map((a) => ({
      user: user?.name ?? "you",
      you: true,
      verb: a.type === "buy" ? "bought" : "sold",
      side: a.side!,
      amount: a.amount,
      price: a.price!,
      time: "just now",
      outcome: a.outcomeLabel,
    })),
    ...FEED_SEED.map((f, i) => ({
      user: f.user,
      you: false,
      verb: "bought",
      side: f.side,
      amount: f.amount,
      price: parseFloat(market.outcomePrices[f.side === "yes" ? 0 : 1]),
      time: FEED_TIMES[i],
      outcome: market.groupItemTitle ?? event.title,
    })),
  ];

  return (
    <ul className="flex flex-col">
      {rows.map((r, i) => (
        <li
          key={i}
          className="flex items-center gap-3 border-b border-border py-3 last:border-0"
        >
          <span
            className="size-8 shrink-0 rounded-full"
            style={{ background: avatarGradient(r.user) }}
            aria-hidden
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
              {r.side === "yes" ? "Yes" : "No"}
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
