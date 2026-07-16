"use client";

import { useState } from "react";
import type { MarketEvent } from "@/types/market";

const TABS = ["Rules", "Comments", "Top Holders", "Activity"] as const;
type Tab = (typeof TABS)[number];

const MOCK_COMMENTS = [
  { user: "market-maven", time: "2h ago", text: "Volume picking up fast on this one. The order book depth looks very one-sided." },
  { user: "0xtrader", time: "5h ago", text: "Priced about right imo. I don't see a catalyst before the deadline." },
  { user: "longshot-larry", time: "1d ago", text: "Buying the dip here. Historically these resolve Yes more often than the market thinks." },
];

/** Rules / Comments / Top Holders / Activity tab strip + panels. */
export function EventTabs({ event }: { event: MarketEvent }) {
  const [tab, setTab] = useState<Tab>("Rules");

  return (
    <section>
      <div className="flex gap-6 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 pb-2.5 text-base font-semibold transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-secondary hover:text-primary"
            }`}
          >
            {t}
            {t === "Comments" && (
              <span className="ml-1 text-secondary">({MOCK_COMMENTS.length})</span>
            )}
          </button>
        ))}
      </div>

      <div className="py-4">
        {tab === "Rules" && <Rules event={event} />}
        {tab === "Comments" && <Comments />}
        {(tab === "Top Holders" || tab === "Activity") && (
          <p className="py-6 text-center text-sm text-secondary">
            {tab} coming in a later slice.
          </p>
        )}
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

function Comments() {
  return (
    <ul className="flex flex-col gap-4">
      {MOCK_COMMENTS.map((c) => (
        <li key={c.user} className="flex gap-3">
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
  );
}
