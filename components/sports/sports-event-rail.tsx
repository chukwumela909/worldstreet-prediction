"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ChevronLeftIcon as ChevronLeft,
  ChevronRightIcon as ChevronRight,
} from "@heroicons/react/24/outline";
import type { MarketEvent } from "@/types/market";
import { toPercent } from "@/lib/format";
import { EventIcon } from "@/components/market/event-icon";
import { useSportsTicket } from "./sports-ticket";
import {
  LIVE_FRAME,
  gameClock,
  groupByLeague,
  hasTeamRows,
  quoteRows,
  railGames,
  splitScore,
} from "./sports-data";
import { TeamMark } from "./team-mark";

/**
 * The strip of games above the sports page — the reference's
 * SportsEventRail. Games that haven't finished, live first then by
 * kickoff, grouped by league under the league's mark and a count. Each
 * game is a small button: LIVE (with the clock) or Upcoming (with the
 * kickoff), then both teams with their score, or their chance before
 * there is one. Picking a game puts its first outcome in the ticket.
 *
 * Takes every loaded event, not the filtered list, so the rail stays the
 * same while the pills and search narrow the cards under it.
 */
export function SportsEventRail({ events }: { events: MarketEvent[] }) {
  const games = useMemo(() => groupByLeague(railGames(events)), [events]);
  const rail = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const measure = () =>
      setEdges({
        start: el.scrollLeft < 2,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
      });
    // fires once on observe, then whenever the rail or its games resize
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (strip.current) observer.observe(strip.current);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [games.length]);

  if (games.length === 0) return null;

  const move = (direction: 1 | -1) =>
    rail.current?.scrollBy({ left: direction * rail.current.clientWidth * 0.75, behavior: "smooth" });

  return (
    <section
      aria-label="Sports events"
      className="mb-3 flex items-center gap-2 border-b border-border pb-3 sm:mb-6 sm:pb-6"
    >
      <RailButton label="Previous sports events" disabled={edges.start} onClick={() => move(-1)}>
        <ChevronLeft className="size-4" />
      </RailButton>
      <div
        ref={rail}
        className={`min-w-0 flex-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          // fade the far edge while there's more to scroll to (a mask
          // reads only alpha, so any opaque token will do)
          edges.end ? "" : "[mask-image:linear-gradient(to_right,var(--bg-page)_calc(100%_-_32px),transparent)]"
        }`}
      >
        <div ref={strip} className="flex w-max gap-2">
          {games.map(([league, leagueGames]) => (
            <section key={league} aria-label={`${league} events`} className="flex-none">
              <h2 className="mb-3 flex min-h-6 items-center gap-3 text-[10px] uppercase text-secondary">
                {leagueGames[0].iconUrl && (
                  <EventIcon event={leagueGames[0]} className="size-6 rounded-xs" px={24} />
                )}
                {league}
                <small className="opacity-70 [font:inherit]">
                  {leagueGames.length} {leagueGames.length === 1 ? "event" : "events"}
                </small>
              </h2>
              <div className="flex gap-2">
                {leagueGames.map((e) => (
                  <RailGame key={e.id} event={e} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <RailButton label="Next sports events" disabled={edges.end} onClick={() => move(1)}>
        <ChevronRight className="size-4" />
      </RailButton>
    </section>
  );
}

function RailGame({ event }: { event: MarketEvent }) {
  const { pick } = useSportsTicket();
  const game = event.game!;
  const rows = quoteRows(event);
  const teamRows = hasTeamRows(rows);
  const scores = game.live ? splitScore(game.score) : null;
  const sides = game.teams.slice(0, 2).map((team, i) => ({
    team,
    // the card's label when the rows are the teams ("Colorado State",
    // where the feed's team is "Rams"), else the team's own name
    name: teamRows ? rows[i].label : team.name,
    value: scores ? scores[i] : teamRows ? `${toPercent(rows[i].price)}%` : "",
  }));
  const status = game.live ? gameClock(event) : null;

  return (
    <button
      type="button"
      onClick={() => rows[0] && pick(event, rows[0].market.id, rows[0].side)}
      aria-label={`Open ${event.title}${scores ? `, score ${scores.join(" to ")}` : ""}`}
      className={`flex w-56 shrink-0 flex-col gap-2 rounded-xl border p-3 text-left font-medium text-secondary transition-colors hover:text-primary ${
        game.live ? LIVE_FRAME : "border-border hover:bg-surface"
      }`}
    >
      <small className="flex justify-between gap-2 text-[10px]">
        {game.live ? <span className="font-semibold text-live">LIVE</span> : "Upcoming"}
        {game.live ? (
          status && <em className="truncate not-italic text-secondary">{status}</em>
        ) : (
          <Kickoff iso={game.startTime} />
        )}
      </small>
      {sides.map(({ team, name, value }, i) => (
        <strong key={i} className="flex items-center justify-between gap-2 text-xs font-normal">
          <TeamMark team={team} px={24} className="size-6" />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          {value && <b className="font-medium tabular-nums">{value}</b>}
        </strong>
      ))}
    </button>
  );
}

const subscribeNothing = () => () => {};

/**
 * Kickoff in the visitor's own time zone. The server doesn't know it,
 * so this renders after hydration only (empty on the server).
 */
function Kickoff({ iso }: { iso?: string }) {
  const client = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const at = iso ? Date.parse(iso) : NaN;
  if (!client || Number.isNaN(at)) return null;
  return (
    <em className="truncate not-italic text-secondary">
      <time dateTime={iso}>
        {new Date(at).toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })}
      </time>
    </em>
  );
}

function RailButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 shrink-0 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface hover:text-primary disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
