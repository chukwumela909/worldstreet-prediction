import { isBinary, isLocalBook, type MarketEvent } from "@/types/market";
import { formatNaira } from "@/lib/format";
import { COUNTDOWN_CUTOFF_MS, formatCountdown } from "@/lib/countdown";
import { Disclosure } from "./market-detail";

/**
 * "Market rules" and "Timeline and payout", as collapsible blocks in one
 * card. Built only from fields the event carries — the Local book's
 * description / per-market rules / resolution source, and the close
 * date — with a block left out when there is nothing real to put in it.
 *
 * Gamma events carry no rules text here, so a Polymarket page keeps the
 * plain-language rule it has always shown, stated from its end date.
 */
export function MarketInfo({ event }: { event: MarketEvent }) {
  return (
    <section
      aria-label="Rules and timeline"
      className="divide-y divide-border rounded-xl border border-border bg-surface shadow-card"
    >
      {rulesAvailable(event) && (
        <Disclosure title="Market rules" defaultOpen>
          <RulesBody event={event} />
        </Disclosure>
      )}
      <Disclosure title="Timeline and payout">
        <TimelineBody event={event} />
      </Disclosure>
    </section>
  );
}

/* ---------- rules ---------- */

/** Relay rules/description are lightly markdown-ish; render as plain text. */
function plainText(raw: string): string {
  return raw.replace(/\*\*/g, "").replace(/\r\n/g, "\n").trim();
}

function ruleSections(event: MarketEvent) {
  const binary = isBinary(event);
  return [
    ...(event.description
      ? [{ id: "about", title: "About this market", body: event.description }]
      : []),
    ...event.markets
      .filter((m) => m.rules)
      .map((m) => ({
        id: m.id,
        title: binary ? "Rules" : `Rules — ${m.groupItemTitle ?? m.question}`,
        body: m.rules!,
      })),
  ];
}

function rulesAvailable(event: MarketEvent): boolean {
  if (ruleSections(event).length > 0 || event.resolutionSource) return true;
  // the Polymarket fallback needs a real end date to state
  return !isLocalBook(event) && endDateLong(event) !== null;
}

function RulesBody({ event }: { event: MarketEvent }) {
  const sections = ruleSections(event);
  const end = endDateLong(event);

  return (
    <>
      {sections.length === 0 && !isLocalBook(event) && end && (
        <>
          <p>
            This market will resolve to &ldquo;Yes&rdquo; if the outcome described in
            &ldquo;{event.title}&rdquo; occurs by {end}. Otherwise, it will resolve to
            &ldquo;No&rdquo;.
          </p>
          <p>
            The primary resolution source will be official announcements and a
            consensus of credible reporting.
          </p>
        </>
      )}
      {sections.map((s) => (
        <div key={s.id}>
          <h3 className="text-sm font-semibold text-primary">{s.title}</h3>
          <p className="mt-1 whitespace-pre-line">{plainText(s.body)}</p>
        </div>
      ))}
      {event.resolutionSource && (
        <p>
          Resolution source:{" "}
          <a
            href={event.resolutionSource}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-accent-ink hover:underline"
          >
            {event.resolutionSource}
          </a>
        </p>
      )}
    </>
  );
}

/* ---------- timeline ---------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "October 15, 2026" from the date-only `endDate`, or null when absent. */
function endDateLong(event: MarketEvent): string | null {
  if (!event.endDate) return null;
  const at = Date.parse(`${event.endDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(at)) return null;
  return new Date(at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "Oct 15, 2026, 14:45 UTC". Built by hand in UTC so the server render and
 * the browser agree — a locale/timezone-dependent string would differ
 * between the two and fail hydration.
 */
function closeTimeUtc(iso: string): string | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())} UTC`;
}

function TimelineBody({ event }: { event: MarketEvent }) {
  const closes = event.closesAt ? closeTimeUtc(event.closesAt) : null;
  const end = endDateLong(event);

  if (!isLocalBook(event)) {
    return (
      <>
        {end && <p>Ends {end}.</p>}
        <p>
          Winning shares pay $1 and losing shares pay $0, so a share&rsquo;s price in
          cents is the market&rsquo;s implied chance of that outcome.
        </p>
      </>
    );
  }

  return (
    <>
      {closes ? <p>Trading closes {closes}.</p> : end && <p>Ends {end}.</p>}
      {event.countdown && (
        <p>
          This is an automated short-cycle market: trading stops{" "}
          {formatCountdown(COUNTDOWN_CUTOFF_MS)} before the close.
        </p>
      )}
      {event.tradingOpen === false && (
        <p>Trading has closed and the result is not in yet.</p>
      )}
      <p>
        Each winning share pays {formatNaira(10_000)} at settlement and a losing
        share pays nothing. Positions are held to settlement.
      </p>
    </>
  );
}
