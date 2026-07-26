"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { CATEGORIES } from "@/types/market";
import { CREDIT, formatNaira, formatNairaSigned } from "@/lib/format";
import { isApiConfigured } from "@/lib/api-client";
import { BookRiskStrip } from "@/components/admin/book-risk";
import { PAYOUT_PER_SHARE_KOBO } from "@/lib/local-trades";
import {
  addWsMarket,
  createWsEvent,
  deleteWsEvent,
  deleteWsMarket,
  fetchWsEvents,
  updateWsEvent,
  updateWsMarket,
  useAdminResource,
  type WsEvent,
  type WsEventStatus,
  type WsMarket,
  type WsMarketInput,
  type WsOutcomeInput,
} from "@/lib/admin-api";

/**
 * The Markets desk — where Worldstreet's own markets get written.
 *
 * These are fixed odds. There is no maker and no book: the desk types
 * what each side costs per ₩100 share, and that is what a trader pays
 * until the desk types something else. The two prices normally sum to
 * more than ₩100, and that overround is the house's margin — shown on
 * every market here, because a market published at 100% is one the
 * house makes nothing on and one published under it pays anyone who
 * buys both sides.
 *
 * Publishing is deliberate: a market is a draft until someone opens it,
 * and only open ones reach the site. Settling them is the Local book
 * desk's job — this one never touches money, which is also why it can
 * delete an untraded market outright but refuses once a stake exists.
 */

const MIN_PRICE_KOBO = 100;
const MAX_PRICE_KOBO = 9_900;
const MAX_MARGIN_BPS = 3_000;

export function MarketsDesk() {
  const events = useAdminResource(fetchWsEvents, true);
  const [creating, setCreating] = useState(false);

  if (!isApiConfigured()) {
    return (
      <Notice>
        This desk needs the prediction API. Set{" "}
        <code className="font-mono text-[13px]">NEXT_PUBLIC_API_URL</code> and
        rebuild.
      </Notice>
    );
  }

  if (events.errorCode === "FORBIDDEN") {
    return (
      <Notice>
        Your account isn&rsquo;t an admin of the Local book. Ask for the{" "}
        <code className="font-mono text-[13px]">admin</code> role on your
        central WorldStreet account.
      </Notice>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Worldstreet markets
          </h1>
          <p className="mt-1 text-sm text-secondary">
            Our own fixed-odds markets. You set the price; the house takes the
            overround.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={events.refresh}
            className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
          >
            <RefreshCw className={`size-3.5 ${events.loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => setCreating((v) => !v)}
            className="flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover"
          >
            {creating ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
            {creating ? "Cancel" : "New market"}
          </button>
        </div>
      </div>

      <BookRiskStrip />

      {creating && (
        <CreateForm
          onDone={() => {
            setCreating(false);
            events.refresh();
          }}
        />
      )}

      {events.error && (
        <p className="mt-4 text-sm font-semibold text-no">{events.error}</p>
      )}
      {events.loading && !events.data && (
        <p className="py-10 text-center text-sm text-secondary">Loading…</p>
      )}
      {events.data?.length === 0 && !creating && (
        <p className="py-16 text-center text-sm text-secondary">
          No markets yet. Write the first one.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {events.data?.map((event) => (
          <EventCard key={event.id} event={event} onChanged={events.refresh} />
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* One event                                                           */
/* ------------------------------------------------------------------ */

const STATUS_STYLE: Record<WsEventStatus, string> = {
  draft: "bg-element-2 text-secondary",
  open: "bg-yes-tint text-yes",
  closed: "bg-accent/10 text-accent",
  resolved: "bg-element-2 text-secondary",
  cancelled: "bg-no-tint text-no",
};

function EventCard({
  event: initial,
  onChanged,
}: {
  event: WsEvent;
  onChanged: () => void;
}) {
  // Every write returns the whole event, so the card can show the result
  // immediately and leave the list refresh to catch up behind it.
  const [event, setEvent] = useState(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const settled = event.status === "resolved" || event.status === "cancelled";
  const traded = event.markets.some((m) => m.exposure.totalPositions > 0);

  const run = useCallback(
    async (action: () => Promise<WsEvent | void>) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const next = await action();
        if (next) setEvent(next);
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : "That didn't work");
      } finally {
        setBusy(false);
      }
    },
    [busy, onChanged],
  );

  const setStatus = (status: "draft" | "open" | "closed" | "cancelled") => {
    const warning =
      status === "cancelled"
        ? `Cancel "${event.title}"?\n\nEvery open position on it is refunded by the settlement worker. This can't be undone.`
        : status === "closed"
          ? `Stop taking stakes on "${event.title}"? It stays on the site until you settle it.`
          : null;
    if (warning && !window.confirm(warning)) return;
    void run(() => updateWsEvent(event.id, { status }));
  };

  const remove = () => {
    if (
      !window.confirm(
        `Delete "${event.title}" and its markets for good?\n\nOnly possible because nobody has traded it.`,
      )
    ) {
      return;
    }
    void run(async () => {
      await deleteWsEvent(event.id);
      onChanged();
    });
  };

  return (
    <article className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex min-w-0 items-center gap-1 text-left text-[15px] font-semibold hover:text-accent"
            >
              {open ? (
                <ChevronDown className="size-4 shrink-0" />
              ) : (
                <ChevronRight className="size-4 shrink-0" />
              )}
              <span className="truncate">{event.title}</span>
            </button>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[event.status]}`}
            >
              {event.status}
            </span>
          </div>
          <p className="mt-1 pl-5 text-[13px] font-medium text-tertiary">
            {event.category} · {event.markets.length} market
            {event.markets.length === 1 ? "" : "s"} · {event.trades} trade
            {event.trades === 1 ? "" : "s"} · {formatNaira(event.stakedKobo)} staked
            {event.closesAt && ` · closes ${fmtDateTime(event.closesAt)}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {event.status === "draft" && (
            <SmallButton onClick={() => setStatus("open")} tone="accent">
              Publish
            </SmallButton>
          )}
          {event.status === "open" && (
            <>
              <SmallButton onClick={() => setStatus("closed")}>Close</SmallButton>
              <SmallButton onClick={() => setStatus("draft")}>Unlist</SmallButton>
            </>
          )}
          {event.status === "closed" && (
            <SmallButton onClick={() => setStatus("open")}>Reopen</SmallButton>
          )}
          {!settled && (
            <SmallButton onClick={() => setStatus("cancelled")} tone="danger">
              Cancel
            </SmallButton>
          )}
          {!traded && (
            <button
              onClick={remove}
              title="Delete — only while nothing has been traded"
              className="flex size-9 items-center justify-center rounded-sm text-tertiary hover:bg-no-tint hover:text-no"
            >
              <Trash2 className="size-4" />
            </button>
          )}
          {busy && <Loader2 className="size-4 animate-spin text-secondary" />}
        </div>
      </div>

      {error && <p className="mt-2 text-[13px] font-semibold text-no">{error}</p>}

      {open && (
        <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
          <EventDetails event={event} onSaved={setEvent} onChanged={onChanged} />

          <div className="flex flex-col gap-2">
            {event.markets.map((market) => (
              <MarketRow
                key={market.id}
                eventId={event.id}
                market={market}
                deletable={
                  market.exposure.totalPositions === 0 && event.markets.length > 1
                }
                onSaved={setEvent}
                onChanged={onChanged}
              />
            ))}
          </div>

          {!settled &&
            (adding ? (
              <MarketEditor
                heading="New market on this event"
                submitLabel="Add market"
                onCancel={() => setAdding(false)}
                onSubmit={async (input) => {
                  const next = await addWsMarket(event.id, input);
                  setEvent(next);
                  onChanged();
                  setAdding(false);
                }}
              />
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="flex h-9 w-fit items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-semibold text-secondary hover:border-border-hover hover:text-primary"
              >
                <Plus className="size-3.5" />
                Add a market
              </button>
            ))}

          <p className="text-[13px] text-tertiary">
            {event.status === "draft" ? (
              "Draft — not on the site yet."
            ) : (
              <>
                Live at{" "}
                <Link
                  href={`/local/${event.slug}`}
                  className="font-semibold text-accent hover:underline"
                >
                  /local/{event.slug}
                </Link>
              </>
            )}
            . Settle it from the Local book desk.
          </p>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Editing the event's own fields                                      */
/* ------------------------------------------------------------------ */

function EventDetails({
  event,
  onSaved,
  onChanged,
}: {
  event: WsEvent;
  onSaved: (event: WsEvent) => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [category, setCategory] = useState(event.category);
  const [description, setDescription] = useState(event.description);
  const [imageUrl, setImageUrl] = useState(event.imageUrl);
  const [resolutionSource, setResolutionSource] = useState(event.resolutionSource);
  const [closesAt, setClosesAt] = useState(toLocalInput(event.closesAt));
  const [resolutionDate, setResolutionDate] = useState(
    toLocalInput(event.resolutionDate),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const locked = event.status === "resolved";

  const save = async () => {
    if (pending || locked) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(
        await updateWsEvent(event.id, {
          title: title.trim(),
          category,
          description: description.trim(),
          imageUrl: imageUrl.trim(),
          resolutionSource: resolutionSource.trim(),
          closesAt: fromLocalInput(closesAt),
          resolutionDate: fromLocalInput(resolutionDate),
        }),
      );
      setSaved(true);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="rounded-md bg-element-2 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Question" className="sm:col-span-2">
          <TextInput value={title} onChange={setTitle} disabled={locked} />
        </Field>
        <Field label="Category">
          <select
            value={category}
            disabled={locked}
            onChange={(e) => setCategory(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-page px-2 text-sm font-semibold disabled:opacity-50"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Icon image URL" hint="https only; blank uses the 🏛️ tile">
          <TextInput value={imageUrl} onChange={setImageUrl} disabled={locked} />
        </Field>
        <Field label="Trading closes" hint="Blank = open until you close it">
          <DateInput value={closesAt} onChange={setClosesAt} disabled={locked} />
        </Field>
        <Field label="Result expected" hint="Drives the overdue alert">
          <DateInput
            value={resolutionDate}
            onChange={setResolutionDate}
            disabled={locked}
          />
        </Field>
        <Field label="About this market" className="sm:col-span-2">
          <textarea
            value={description}
            disabled={locked}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-border bg-page px-3 py-2 text-sm outline-none disabled:opacity-50"
          />
        </Field>
        <Field
          label="Resolution source"
          hint="https URL shown to traders"
          className="sm:col-span-2"
        >
          <TextInput
            value={resolutionSource}
            onChange={setResolutionSource}
            disabled={locked}
          />
        </Field>
      </div>

      {!locked && (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => void save()}
            disabled={pending}
            className="flex h-9 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Save details
          </button>
          {saved && !error && (
            <p className="text-[13px] font-semibold text-yes">Saved.</p>
          )}
          {error && <p className="text-[13px] font-semibold text-no">{error}</p>}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* One market: prices, status, deletion                                */
/* ------------------------------------------------------------------ */

function MarketRow({
  eventId,
  market,
  deletable,
  onSaved,
  onChanged,
}: {
  eventId: string;
  market: WsMarket;
  deletable: boolean;
  onSaved: (event: WsEvent) => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(market.title);
  const [rules, setRules] = useState(market.rules);
  const [prices, setPrices] = useState(() =>
    market.outcomes.map((o) => ({
      label: o.label,
      price: koboNaira(o.priceKobo),
    })),
  );
  const [pending, setPending] = useState<"save" | "status" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const outcomes = useMemo(() => parseOutcomes(prices), [prices]);
  const settled = market.status === "resolved" || market.status === "cancelled";

  const run = async (
    kind: "save" | "status" | "delete",
    action: () => Promise<WsEvent>,
  ) => {
    if (pending) return;
    setPending(kind);
    setError(null);
    try {
      onSaved(await action());
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="rounded-md border border-border bg-page p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          {market.title}
        </p>
        <span className="text-[13px] font-medium text-tertiary">
          {market.status}
          {market.exposure.openPositions > 0 &&
            ` · ${market.exposure.openPositions} open · ${formatNaira(
              market.exposure.openStakeKobo,
            )} staked`}
        </span>
      </div>

      <SideBook market={market} />

      {settled ? (
        <p className="mt-2 text-[13px] font-medium text-tertiary">
          {market.outcomes.map((o) => `${o.label} ${formatNaira(o.priceKobo)}`).join(" · ")}
          {market.resolvedOutcomeId &&
            ` → ${
              market.outcomes.find((o) => o.id === market.resolvedOutcomeId)?.label
            } won`}
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Market title">
              <TextInput value={title} onChange={setTitle} />
            </Field>
            <Field label="Rules">
              <TextInput value={rules} onChange={setRules} />
            </Field>
          </div>

          <PriceFields value={prices} onChange={setPrices} />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() =>
                outcomes &&
                void run("save", () =>
                  updateWsMarket(eventId, market.id, {
                    title: title.trim(),
                    rules: rules.trim(),
                    outcomes,
                  }),
                )
              }
              disabled={pending !== null || outcomes === null}
              className="flex h-9 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
            >
              {pending === "save" && <Loader2 className="size-3.5 animate-spin" />}
              Save market
            </button>
            <SmallButton
              onClick={() =>
                void run("status", () =>
                  updateWsMarket(eventId, market.id, {
                    status: market.status === "open" ? "closed" : "open",
                  }),
                )
              }
            >
              {market.status === "open" ? "Stop trading" : "Reopen"}
            </SmallButton>
            {deletable && (
              <SmallButton
                tone="danger"
                onClick={() => {
                  if (!window.confirm(`Delete the "${market.title}" market?`)) return;
                  void run("delete", () => deleteWsMarket(eventId, market.id));
                }}
              >
                Delete
              </SmallButton>
            )}
          </div>
        </>
      )}

      {error && <p className="mt-2 text-[13px] font-semibold text-no">{error}</p>}
    </div>
  );
}

/**
 * Where the money actually is on one market.
 *
 * A market total says nothing on its own: ₦58,000 staked is a 5%
 * earner if it's split across both sides and a ₦42,000 bet if it isn't.
 * So this is per side, and the column that matters is the last one —
 * everything collected on the market, less what that side would pay
 * out. Red there means the house is short it, and the answer is to make
 * that side dearer and the other cheaper until the two pay for each
 * other.
 */
function SideBook({ market }: { market: WsMarket }) {
  const { openPositions, openStakeKobo, outcomes, worstOutcomeId } = market.exposure;
  if (openPositions === 0) return null;

  const staked = new Map(outcomes.map((o) => [o.outcomeId, o]));

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-[13px]">
        <thead>
          <tr className="text-xs font-semibold text-tertiary">
            <th className="pb-1 font-semibold">Side</th>
            <th className="pb-1 text-right font-semibold">Staked on it</th>
            <th className="pb-1 text-right font-semibold">You&rsquo;d pay out</th>
            <th className="pb-1 text-right font-semibold">You&rsquo;d end up</th>
          </tr>
        </thead>
        <tbody>
          {market.outcomes.map((outcome) => {
            // a side nobody has backed pays nothing, so the house keeps
            // the lot if it lands
            const side = staked.get(outcome.id);
            const payoutKobo = side?.payoutKobo ?? 0;
            const resultKobo = openStakeKobo - payoutKobo;
            const short = resultKobo < 0;
            return (
              <tr
                key={outcome.id}
                className={`border-t border-border ${
                  outcome.id === worstOutcomeId ? "font-semibold" : ""
                }`}
              >
                <td className="py-1.5">
                  {outcome.label}{" "}
                  <span className="font-medium text-tertiary">
                    at {formatNaira(outcome.priceKobo)}
                  </span>
                </td>
                <td className="py-1.5 text-right">
                  {side ? (
                    <>
                      {formatNaira(side.stakeKobo)}{" "}
                      <span className="font-medium text-tertiary">
                        ({side.positions})
                      </span>
                    </>
                  ) : (
                    <span className="text-tertiary">—</span>
                  )}
                </td>
                <td className="py-1.5 text-right">{formatNaira(payoutKobo)}</td>
                <td
                  className={`py-1.5 text-right font-semibold ${
                    short ? "text-no" : "text-yes"
                  }`}
                >
                  {formatNairaSigned(resultKobo)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Creating an event                                                   */
/* ------------------------------------------------------------------ */

function CreateForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("Trending");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [resolutionSource, setResolutionSource] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [resolutionDate, setResolutionDate] = useState("");
  const [publish, setPublish] = useState(false);
  const [markets, setMarkets] = useState<DraftMarket[]>([blankMarket()]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = markets.map((m) => parseOutcomes(m.prices));
  const ready =
    title.trim().length >= 3 &&
    markets.every((m) => m.title.trim().length > 0) &&
    parsed.every((o) => o !== null);

  const submit = async () => {
    if (!ready || pending) return;
    setPending(true);
    setError(null);
    try {
      await createWsEvent({
        title: title.trim(),
        category,
        description: description.trim(),
        imageUrl: imageUrl.trim(),
        resolutionSource: resolutionSource.trim(),
        closesAt: fromLocalInput(closesAt),
        resolutionDate: fromLocalInput(resolutionDate),
        status: publish ? "open" : "draft",
        markets: markets.map((m, i) => ({
          title: m.title.trim(),
          rules: m.rules.trim(),
          outcomes: parsed[i]!,
        })),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the market");
    } finally {
      setPending(false);
    }
  };

  const single = markets.length === 1;

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4 shadow-card">
      <h2 className="text-lg font-semibold">New market</h2>
      <p className="mt-0.5 text-sm text-secondary">
        One question with two priced sides. Add more markets for a grouped
        event — a race with several runners, say.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Question"
          hint="What traders see as the headline"
          className="sm:col-span-2"
        >
          <TextInput
            value={title}
            onChange={setTitle}
            placeholder="Will the CBN hold rates in September?"
          />
        </Field>
        <Field label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-page px-2 text-sm font-semibold"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Icon image URL" hint="https only; blank uses the 🏛️ tile">
          <TextInput value={imageUrl} onChange={setImageUrl} />
        </Field>
        <Field label="Trading closes" hint="Blank = open until you close it">
          <DateInput value={closesAt} onChange={setClosesAt} />
        </Field>
        <Field label="Result expected" hint="Drives the overdue alert">
          <DateInput value={resolutionDate} onChange={setResolutionDate} />
        </Field>
        <Field label="About this market" className="sm:col-span-2">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-border bg-page px-3 py-2 text-sm outline-none"
          />
        </Field>
        <Field
          label="Resolution source"
          hint="https URL shown to traders"
          className="sm:col-span-2"
        >
          <TextInput value={resolutionSource} onChange={setResolutionSource} />
        </Field>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {markets.map((market, index) => (
          <div key={market.key} className="rounded-md bg-element-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {single ? "The market" : `Market ${index + 1}`}
              </h3>
              {!single && (
                <button
                  onClick={() =>
                    setMarkets((ms) => ms.filter((m) => m.key !== market.key))
                  }
                  className="flex size-8 items-center justify-center rounded-sm text-tertiary hover:bg-no-tint hover:text-no"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>

            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Market title"
                hint={single ? "Usually the question again" : "e.g. the runner's name"}
              >
                <TextInput
                  value={market.title}
                  onChange={(v) => patchMarket(setMarkets, market.key, { title: v })}
                  placeholder={single ? title : undefined}
                />
              </Field>
              <Field label="Rules" hint="How this one resolves">
                <TextInput
                  value={market.rules}
                  onChange={(v) => patchMarket(setMarkets, market.key, { rules: v })}
                />
              </Field>
            </div>

            <PriceFields
              value={market.prices}
              onChange={(prices) => patchMarket(setMarkets, market.key, { prices })}
            />
          </div>
        ))}

        <button
          onClick={() => setMarkets((ms) => [...ms, blankMarket()])}
          className="flex h-9 w-fit items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-semibold text-secondary hover:border-border-hover hover:text-primary"
        >
          <Plus className="size-3.5" />
          Another market
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void submit()}
          disabled={!ready || pending}
          className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {publish ? "Create and publish" : "Create draft"}
        </button>
        <label className="flex items-center gap-2 text-sm font-semibold text-secondary">
          <input
            type="checkbox"
            checked={publish}
            onChange={(e) => setPublish(e.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          Publish to the site straight away
        </label>
      </div>

      {error && <p className="mt-3 text-sm font-semibold text-no">{error}</p>}
    </section>
  );
}

/**
 * The market half of the create form, reused when adding one to an
 * event that already exists.
 */
function MarketEditor({
  heading,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  heading: string;
  submitLabel: string;
  onSubmit: (input: WsMarketInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(blankMarket);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outcomes = parseOutcomes(draft.prices);
  const ready = draft.title.trim().length > 0 && outcomes !== null;

  return (
    <section className="rounded-md bg-element-2 p-3">
      <h3 className="text-sm font-semibold">{heading}</h3>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Market title">
          <TextInput
            value={draft.title}
            onChange={(title) => setDraft((d) => ({ ...d, title }))}
          />
        </Field>
        <Field label="Rules">
          <TextInput
            value={draft.rules}
            onChange={(rules) => setDraft((d) => ({ ...d, rules }))}
          />
        </Field>
      </div>
      <PriceFields
        value={draft.prices}
        onChange={(prices) => setDraft((d) => ({ ...d, prices }))}
      />
      <div className="mt-3 flex items-center gap-2">
        <button
          disabled={!ready || pending}
          onClick={() => {
            if (!ready || pending) return;
            setPending(true);
            setError(null);
            onSubmit({
              title: draft.title.trim(),
              rules: draft.rules.trim(),
              outcomes: outcomes!,
            })
              .catch((err: unknown) =>
                setError(err instanceof Error ? err.message : "Could not add it"),
              )
              .finally(() => setPending(false));
          }}
          className="flex h-9 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {submitLabel}
        </button>
        <SmallButton onClick={onCancel}>Cancel</SmallButton>
      </div>
      {error && <p className="mt-2 text-[13px] font-semibold text-no">{error}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Prices                                                              */
/* ------------------------------------------------------------------ */

interface PriceDraft {
  label: string;
  /** Naira per share as typed, e.g. "55" or "62.5". */
  price: string;
}

/**
 * The two sides of a market, with the margin they imply spelled out.
 * The sum is the whole story: 100% is a book the house breaks even on,
 * under 100% is one it loses on no matter what happens.
 */
function PriceFields({
  value,
  onChange,
}: {
  value: PriceDraft[];
  onChange: (value: PriceDraft[]) => void;
}) {
  const totalKobo = value.reduce((sum, side) => sum + (toKobo(side.price) ?? 0), 0);
  const complete = value.every((side) => toKobo(side.price) !== null);
  const marginBps = totalKobo - PAYOUT_PER_SHARE_KOBO;
  const problem = !complete
    ? null
    : value.some((side) => {
          const kobo = toKobo(side.price)!;
          return kobo < MIN_PRICE_KOBO || kobo > MAX_PRICE_KOBO;
        })
      ? `Each price must be between ${CREDIT}1 and ${CREDIT}99.`
      : marginBps < 0
        ? "Under 100% — anyone could buy both sides and profit."
        : marginBps > MAX_MARGIN_BPS
          ? `Over the ${MAX_MARGIN_BPS / 100}% margin cap.`
          : null;

  const patch = (index: number, side: Partial<PriceDraft>) =>
    onChange(value.map((s, i) => (i === index ? { ...s, ...side } : s)));

  return (
    <>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {value.map((side, index) => (
          <div key={index} className="flex items-end gap-2">
            <Field label={index === 0 ? "Outcome A" : "Outcome B"} className="flex-1">
              <TextInput
                value={side.label}
                onChange={(label) => patch(index, { label })}
                placeholder={index === 0 ? "Yes" : "No"}
              />
            </Field>
            <Field label="Price" hint={`per ${CREDIT}100 share`}>
              <div className="flex h-10 w-28 items-center gap-1 rounded-md border border-border bg-page px-2">
                <span className="text-sm font-semibold text-tertiary">{CREDIT}</span>
                <input
                  inputMode="decimal"
                  aria-label={`Price for outcome ${index === 0 ? "A" : "B"}`}
                  value={side.price}
                  onChange={(e) =>
                    patch(index, {
                      price: e.target.value.replace(/[^0-9.]/g, "").slice(0, 6),
                    })
                  }
                  className="w-full bg-transparent text-sm font-semibold outline-none"
                />
              </div>
            </Field>
          </div>
        ))}
      </div>

      <p
        className={`mt-2 text-[13px] font-semibold ${problem ? "text-no" : "text-secondary"}`}
      >
        {complete ? (
          <>
            Book {(totalKobo / 100).toFixed(2)}% · house margin{" "}
            <span className={marginBps > 0 && !problem ? "text-yes" : undefined}>
              {(marginBps / 100).toFixed(2)}%
            </span>
            {problem ? ` — ${problem}` : ""}
          </>
        ) : (
          "Price both sides to see the margin."
        )}
      </p>
    </>
  );
}

/** Naira text → kobo, or null when it isn't a usable number. */
function toKobo(price: string): number | null {
  const naira = parseFloat(price);
  if (!Number.isFinite(naira) || naira <= 0) return null;
  return Math.round(naira * 100);
}

function koboNaira(kobo: number): string {
  return String(kobo / 100);
}

/** The drafts as the API wants them, or null when they aren't valid yet. */
function parseOutcomes(sides: PriceDraft[]): WsOutcomeInput[] | null {
  const out: WsOutcomeInput[] = [];
  let total = 0;
  for (const side of sides) {
    const priceKobo = toKobo(side.price);
    const label = side.label.trim();
    if (
      !label ||
      priceKobo === null ||
      priceKobo < MIN_PRICE_KOBO ||
      priceKobo > MAX_PRICE_KOBO
    ) {
      return null;
    }
    total += priceKobo;
    out.push({ label, priceKobo });
  }
  if (out.length !== 2) return null;
  if (out[0]!.label.toLowerCase() === out[1]!.label.toLowerCase()) return null;
  const marginBps = total - PAYOUT_PER_SHARE_KOBO;
  if (marginBps < 0 || marginBps > MAX_MARGIN_BPS) return null;
  return out;
}

/* ------------------------------------------------------------------ */
/* Draft markets in the create form                                    */
/* ------------------------------------------------------------------ */

interface DraftMarket {
  key: string;
  title: string;
  rules: string;
  prices: PriceDraft[];
}

let draftCounter = 0;

function blankMarket(): DraftMarket {
  draftCounter += 1;
  return {
    key: `draft-${draftCounter}`,
    title: "",
    rules: "",
    // a 105% book — the shape most of these should start at
    prices: [
      { label: "Yes", price: "55" },
      { label: "No", price: "50" },
    ],
  };
}

function patchMarket(
  setMarkets: React.Dispatch<React.SetStateAction<DraftMarket[]>>,
  key: string,
  patch: Partial<DraftMarket>,
) {
  setMarkets((ms) => ms.map((m) => (m.key === key ? { ...m, ...patch } : m)));
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-xs font-semibold text-secondary">
        {label}
        {hint && <span className="ml-1.5 font-medium text-tertiary">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-md border border-border bg-page px-3 text-sm outline-none placeholder:text-tertiary disabled:opacity-50"
    />
  );
}

function DateInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="datetime-local"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-md border border-border bg-page px-3 text-sm outline-none disabled:opacity-50"
    />
  );
}

function SmallButton({
  children,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "accent" | "danger";
}) {
  const style =
    tone === "accent"
      ? "bg-accent text-on-accent hover:bg-accent-hover"
      : tone === "danger"
        ? "border border-border text-secondary hover:border-no hover:text-no"
        : "border border-border text-secondary hover:border-border-hover hover:text-primary";
  return (
    <button
      onClick={onClick}
      className={`flex h-9 items-center rounded-full px-3 text-[13px] font-semibold ${style}`}
    >
      {children}
    </button>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-card">
      <h1 className="text-lg font-semibold">Worldstreet markets</h1>
      <p className="mt-2 text-sm text-secondary">{children}</p>
    </div>
  );
}

/** ISO → the value a datetime-local input wants (local wall clock). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** …and back. Empty clears the field rather than leaving it alone. */
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function fmtDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
