"use client";

import type { ReactNode } from "react";
import {
  ChevronDownIcon as ChevronDown,
  ChevronUpIcon as ChevronUp,
} from "@heroicons/react/24/outline";
import { isBinary, type MarketEvent } from "@/types/market";
import { formatVolume, toCents, toPercent } from "@/lib/format";
import { dayDelta } from "@/lib/series";
import {
  NO_TONE,
  ProbabilityBar,
  QuotePill,
  YES_TONE,
  outcomeTone,
} from "@/components/market/outcome-quote";
import { useTradeSelection } from "./trade-context";
import { DetailCard, useRevealTicket } from "./market-detail";

/**
 * "Outcomes" block for Polymarket events: one row per market — name over
 * a chance bar in its chart colour, the chance, then outlined Yes / No
 * price pills. A pill selects that market+side, which the trade panel
 * and chart follow; on narrow screens it also opens the panel's sheet.
 *
 * The pills read "Yes 58¢" rather than "Buy Yes 58¢" because these
 * mirrored markets aren't tradeable here — see trade-panel.tsx. The
 * Local rows keep "Buy", since those orders are real.
 */
export function OutcomeList({ event }: { event: MarketEvent }) {
  const { marketId, side, select } = useTradeSelection();
  const reveal = useRevealTicket();
  const binary = isBinary(event);
  const choose = (id: string, s: "yes" | "no") => {
    select(id, s);
    reveal();
  };

  return (
    <OutcomesCard>
      {event.markets.map((m, i) => {
        // a binary event's one row would only repeat the title as its name
        const name = binary ? (m.outcomeLabels?.[0] ?? "Yes") : (m.groupItemTitle ?? m.question);
        const [yesLabel, noLabel] = m.outcomeLabels ?? ["Yes", "No"];
        const yes = `${yesLabel} ${toCents(m.outcomePrices[0])}`;
        const no = `${noLabel} ${toCents(m.outcomePrices[1])}`;
        return (
          <OutcomeQuoteRow
            key={m.id}
            label={name}
            caption={formatVolume(m.volume)}
            pct={toPercent(m.outcomePrices[0])}
            delta={dayDelta(m)}
            tone={binary ? YES_TONE : outcomeTone(i)}
            highlighted={!binary && marketId === m.id}
            yes={{
              text: yes,
              label: binary ? yes : `${yes} · ${name}`,
              pressed: marketId === m.id && side === "yes",
              onClick: () => choose(m.id, "yes"),
            }}
            no={{
              text: no,
              label: binary ? no : `${no} · ${name}`,
              pressed: marketId === m.id && side === "no",
              onClick: () => choose(m.id, "no"),
            }}
          />
        );
      })}
    </OutcomesCard>
  );
}

/** The card around a list of outcome rows — shared with the Local page. */
export function OutcomesCard({ children }: { children: ReactNode }) {
  return (
    <DetailCard title="Outcomes" caption="Chance · Price per share" flush>
      <ul>{children}</ul>
    </DetailCard>
  );
}

interface PillSpec {
  /** Visible text, e.g. "Yes 58.2¢". */
  text: string;
  /** Accessible name — starts with the visible text. */
  label: string;
  pressed: boolean;
  onClick: () => void;
}

/**
 * One outcome: name (+ caption) over its chance bar, the chance in big
 * type, and the two side pills. The selected market's row takes a faint
 * accent wash.
 */
export function OutcomeQuoteRow({
  label,
  caption,
  pct,
  delta = 0,
  tone,
  highlighted,
  yes,
  no,
}: {
  label: string;
  caption?: string;
  pct: number;
  /** Day change in percentage points; 0 hides it. */
  delta?: number;
  tone: string;
  highlighted: boolean;
  yes: PillSpec;
  no: PillSpec;
}) {
  return (
    <li
      className={`flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border px-4 py-4 transition-colors sm:flex-nowrap sm:px-5 ${
        highlighted ? "bg-accent/10" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold">{label}</p>
        {caption && <p className="mt-0.5 text-xs text-secondary">{caption}</p>}
        <ProbabilityBar pct={pct} tone={tone} className="mt-2" />
      </div>

      <div className="flex min-w-14 shrink-0 items-center justify-end gap-1.5">
        <span className="text-2xl font-bold leading-none tabular-nums">{pct}%</span>
        {delta !== 0 && (
          <span
            className={`flex items-center text-xs font-semibold ${
              delta > 0 ? "text-yes" : "text-no"
            }`}
          >
            {delta > 0 ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
            {Math.abs(delta)}%
          </span>
        )}
      </div>

      <div className="flex w-full gap-2 sm:w-auto">
        {[
          { spec: yes, tone: YES_TONE },
          { spec: no, tone: NO_TONE },
        ].map(({ spec, tone: sideTone }) => (
          <QuotePill
            key={sideTone}
            tone={sideTone}
            variant="side"
            size="md"
            label={spec.label}
            pressed={spec.pressed}
            onClick={spec.onClick}
            className="flex-1 whitespace-nowrap sm:min-w-[92px] sm:flex-none"
          >
            {spec.text}
          </QuotePill>
        ))}
      </div>
    </li>
  );
}
