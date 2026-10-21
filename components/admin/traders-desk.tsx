"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowDownIcon as ArrowDown,
  ChevronDownIcon as ChevronDown,
  ArrowPathIcon as RefreshCw,
  MagnifyingGlassIcon as Search,
  UsersIcon as Users,
} from "@heroicons/react/24/outline";
import { bookHref } from "@/lib/book";
import { isApiConfigured, ApiError } from "@/lib/api-client";
import {
  TRADER_SORTS,
  fetchTrader,
  fetchTraders,
  type MoneyTotal,
  type TraderDetail,
  type TraderList,
  type TraderRow,
  type TraderSort,
} from "@/lib/admin-api";
import { useAdminMoney, type AdminMoney } from "@/lib/admin-money";
import { localPref, useLocalPref } from "@/lib/admin-prefs";
import { UsdRateNote } from "@/components/admin/currency-switch";
import { AccountControl } from "@/components/admin/account-control";
import { FLAG_TONE } from "@/components/admin/risk-flags";

/**
 * Who is playing the book, written for the owner rather than an engineer.
 *
 * Two views: "Active traders" (people who have placed at least one bet —
 * the default, because that is who the business question is about) and
 * "All accounts" (everyone who signed up, the never-staked included).
 * Each person shows when they last bet, how many bets, what they have
 * staked, what is still in play, how they have done on finished bets
 * (from their side: "Won ₦12,000" / "Lost ₦4,500"), and the credit they
 * are sitting on. Opening one asks the API for their actual bets,
 * because "₦40,000 staked" doesn't say on what.
 *
 * Desktop gets a real table with column headers; phones get one card
 * per person with every one of those values — nothing is hidden on a
 * small screen. The tab and sort are remembered in this browser.
 *
 * Nothing here moves anyone's money. The one action is on a person, not
 * a market: suspending an account (and lifting it), from the opened
 * person — with a third view, "Suspended", listing who is. Settlement is
 * the Local book desk. Amounts follow the desk's ₦/$ switch
 * (useAdminMoney).
 */

type TraderTab = "active" | "all" | "suspended";

const TABS: { key: TraderTab; label: string; blurb: string }[] = [
  {
    key: "active",
    label: "Active traders",
    blurb: "People who have placed at least one bet.",
  },
  {
    key: "all",
    label: "All accounts",
    blurb: "Everyone who has signed up, whether they have placed a bet or not.",
  },
  {
    key: "suspended",
    label: "Suspended",
    blurb: "Accounts that can't bet or move money until the suspension is lifted.",
  },
];

const SORTS: { key: TraderSort; label: string }[] = [
  { key: "recent", label: "Most recent bet" },
  { key: "staked", label: "Most staked" },
  { key: "open", label: "Most in play now" },
  { key: "trades", label: "Most bets" },
  { key: "pnl", label: "Biggest winners" },
  { key: "losers", label: "Biggest losers" },
  { key: "balance", label: "Highest balance" },
  { key: "joined", label: "Newest accounts" },
];

type Column = "trader" | "last" | "bets" | "staked" | "open" | "result" | "balance";

/** The column each sort orders by — its header is marked. */
const SORT_COLUMN: Record<TraderSort, Column> = {
  recent: "last",
  staked: "staked",
  open: "open",
  trades: "bets",
  pnl: "result",
  losers: "result",
  balance: "balance",
  joined: "trader",
};

interface TradersView {
  tab: TraderTab;
  sort: TraderSort;
}

const DEFAULT_VIEW: TradersView = { tab: "active", sort: "recent" };

const viewPref = localPref<TradersView>("ws-admin-traders-view", DEFAULT_VIEW, (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const { tab, sort } = raw as { tab?: unknown; sort?: unknown };
  return {
    tab: tab === "all" || tab === "suspended" ? tab : "active",
    sort: (TRADER_SORTS as readonly unknown[]).includes(sort)
      ? (sort as TraderSort)
      : DEFAULT_VIEW.sort,
  };
});

const PAGE = 50;

export function TradersDesk() {
  const money = useAdminMoney();
  const view = useLocalPref(viewPref);
  const { tab, sort } = view;
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [reloads, setReloads] = useState(0);

  const setView = (patch: Partial<TradersView>) => {
    viewPref.set({ ...view, ...patch });
    setOffset(0);
  };

  // typing is a filter, not a request per keystroke
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  /**
   * One state object keyed by the request that produced it, set only
   * from the fetch's own callbacks. An effect that setStates in its
   * body cascades renders (and the lint rule says so); comparing the
   * loaded key against the current one gives "loading" for free, and
   * keeps the previous page on screen while the next one lands. `at`
   * is when it landed — "5 min ago" is measured from there.
   */
  const [loaded, setLoaded] = useState<{
    key: string;
    at: number;
    data: TraderList | null;
    error: string | null;
    errorCode: string | null;
  } | null>(null);

  const configured = isApiConfigured();
  const key = `${query}|${sort}|${offset}|${tab}|${reloads}`;

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    fetchTraders({
      search: query,
      sort,
      offset,
      limit: PAGE,
      activeOnly: tab === "active",
      suspendedOnly: tab === "suspended",
    })
      .then((data) => {
        if (!cancelled) {
          setLoaded({ key, at: Date.now(), data, error: null, errorCode: null });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoaded({
          key,
          at: Date.now(),
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

  const fresh = loaded?.key === key ? loaded : null;
  const loading = fresh === null;
  const error = fresh?.error ?? null;
  const errorCode = fresh?.errorCode ?? null;

  if (!configured) {
    return (
      <Notice>
        This desk needs the prediction API. Set{" "}
        <code className="font-mono text-[13px]">NEXT_PUBLIC_API_URL</code> and
        rebuild.
      </Notice>
    );
  }

  if (errorCode === "FORBIDDEN") {
    return (
      <Notice>
        Your account isn&rsquo;t an admin of the Local book. Ask for the{" "}
        <code className="font-mono text-[13px]">admin</code> role on your
        central WorldStreet account.
      </Notice>
    );
  }

  // the last page that loaded stays visible while the next one is in flight
  const list = fresh?.data ?? loaded?.data ?? null;
  const rows = list?.traders ?? [];
  const summary = list?.summary;
  const now = loaded?.at ?? 0;
  const activeTab = TABS.find((t) => t.key === tab)!;
  const sortColumn = SORT_COLUMN[sort];
  // the house's side of what these traders realized
  const houseKobo = summary ? -summary.realizedPnlKobo : 0;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Traders</h1>
          <p className="mt-1 text-sm text-secondary">
            Who is betting, how much they&rsquo;ve staked, and how they&rsquo;re doing.
          </p>
        </div>
        <button
          onClick={() => setReloads((n) => n + 1)}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* the two views */}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div
          role="group"
          aria-label="Which people"
          className="inline-flex max-w-full rounded-md bg-element-2 p-1"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={tab === t.key}
              onClick={() => setView({ tab: t.key })}
              className={`h-9 shrink-0 whitespace-nowrap rounded-sm px-4 text-sm font-semibold transition-colors ${
                tab === t.key
                  ? "bg-surface text-primary shadow-card"
                  : "text-secondary hover:text-primary"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-[13px] font-medium text-tertiary">{activeTab.blurb}</p>
      </div>

      {summary && (
        <section className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 shadow-card lg:grid-cols-4">
          <Stat
            label="People"
            value={count(summary.users)}
            note={`${count(summary.traders)} have staked`}
          />
          <Stat
            label="Total staked"
            value={money.formatHeadline(summary.stakedKobo)}
            exact={money.format(summary.stakedKobo)}
            note={`${money.format(summary.openStakeKobo)} in play now`}
          />
          <Stat
            label="House result from these traders"
            value={money.formatHeadline(houseKobo, { signed: true })}
            exact={money.formatSigned(houseKobo)}
            valueClass={houseKobo > 0 ? "text-yes" : houseKobo < 0 ? "text-no" : ""}
            note={
              houseKobo > 0
                ? "the house is up, on finished bets"
                : houseKobo < 0
                  ? "the house is down, on finished bets"
                  : "on finished bets"
            }
          />
          <Stat
            label="Credit held"
            value={money.formatHeadline(summary.balanceKobo)}
            exact={money.format(summary.balanceKobo)}
            note="unspent balances"
          />
          <UsdRateNote className="col-span-2 lg:col-span-4" />
        </section>
      )}

      {/* search + sort */}
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
          <span className="text-xs font-medium text-secondary">Search</span>
          <span className="flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-3">
            <Search className="size-4 shrink-0 text-secondary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, username or email"
              className="w-full min-w-0 bg-transparent text-sm font-medium outline-none placeholder:text-tertiary"
            />
          </span>
        </label>
        <label className="flex w-full flex-col gap-1 sm:w-auto">
          <span className="text-xs font-medium text-secondary">Sort by</span>
          <select
            value={sort}
            onChange={(e) => setView({ sort: e.target.value as TraderSort })}
            className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm font-semibold text-primary sm:w-56"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* rows */}
      <section className="mt-4">
        {error && errorCode !== "FORBIDDEN" && (
          <p className="mb-3 rounded-md border border-border bg-surface px-4 py-3 text-sm font-medium text-no">
            {error}
          </p>
        )}

        {loading && !list ? (
          <RowsSkeleton />
        ) : rows.length === 0 ? (
          <p className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface py-12 text-center text-sm leading-6 text-secondary shadow-card">
            <Users className="size-6 text-tertiary" />
            {query
              ? `Nobody matches “${query}”.`
              : tab === "active"
                ? "Nobody has staked yet."
                : tab === "suspended"
                  ? "No accounts are suspended."
                  : "No accounts yet."}
          </p>
        ) : (
          <>
            {/* desktop: a real table */}
            <div className="hidden overflow-hidden rounded-xl border border-border bg-surface shadow-card md:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <thead>
                    <tr className="text-xs font-semibold text-secondary">
                      <HeadCell column="trader" sortColumn={sortColumn} sort={sort} className="pl-4">
                        Trader
                      </HeadCell>
                      <HeadCell column="last" sortColumn={sortColumn} sort={sort}>
                        Last bet
                      </HeadCell>
                      <HeadCell column="bets" sortColumn={sortColumn} sort={sort} right>
                        Bets
                      </HeadCell>
                      <HeadCell column="staked" sortColumn={sortColumn} sort={sort} right>
                        Total staked
                      </HeadCell>
                      <HeadCell column="open" sortColumn={sortColumn} sort={sort} right>
                        In play
                      </HeadCell>
                      <HeadCell column="result" sortColumn={sortColumn} sort={sort} right>
                        Their result
                      </HeadCell>
                      <HeadCell column="balance" sortColumn={sortColumn} sort={sort} right>
                        Balance
                      </HeadCell>
                      <th scope="col" className="w-10 py-2.5 pr-3">
                        <span className="sr-only">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => (
                      <TraderTableRow
                        key={t.authUserId}
                        trader={t}
                        now={now}
                        money={money}
                        onChanged={() => setReloads((n) => n + 1)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* phones: one card per person, every value shown */}
            <ul className="flex flex-col gap-3 md:hidden">
              {rows.map((t) => (
                <TraderCard
                  key={t.authUserId}
                  trader={t}
                  now={now}
                  money={money}
                  onChanged={() => setReloads((n) => n + 1)}
                />
              ))}
            </ul>
          </>
        )}

        {list && list.total > PAGE && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] font-medium text-tertiary">
              Showing {offset + 1}–{Math.min(offset + PAGE, list.total)} of{" "}
              {count(list.total)}
              {list.truncated && " (list capped)"}
            </p>
            <div className="flex gap-2">
              <PageButton
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(offset - PAGE, 0))}
              >
                Previous
              </PageButton>
              <PageButton
                disabled={offset + PAGE >= list.total}
                onClick={() => setOffset(offset + PAGE)}
              >
                Next
              </PageButton>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

/* ---------- one person ---------- */

/**
 * Opening a person fetches their bets — the list endpoint deliberately
 * doesn't carry them, since 50 people's worth of bets is a payload
 * nobody reads.
 */
function useTraderDetail(authUserId: string) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<TraderDetail | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    fetchTrader(authUserId)
      .then(setDetail)
      .catch(() => setFailed(true));
  }, [authUserId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) load();
  };

  return { open, toggle, detail, failed, load };
}

type DetailState = ReturnType<typeof useTraderDetail>;

function nameOf(t: TraderRow): string {
  return t.displayName || t.username || "Unnamed";
}

function TraderTableRow({
  trader,
  now,
  money,
  onChanged,
}: {
  trader: TraderRow;
  now: number;
  money: AdminMoney;
  onChanged: () => void;
}) {
  const d = useTraderDetail(trader.authUserId);
  const result = theirResult(trader, money);
  const name = nameOf(trader);

  return (
    <>
      <tr
        onClick={d.toggle}
        className="cursor-pointer border-t border-border transition-colors hover:bg-element"
      >
        <td className="w-full max-w-0 py-3 pl-4 pr-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={name} />
            <div className="min-w-0">
              <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                <span className="truncate">{name}</span>
                {trader.suspendedAt && <SuspendedChip />}
              </p>
              <p className="truncate text-xs font-medium text-tertiary">
                {[trader.username && `@${trader.username}`, trader.email]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
        </td>
        <td
          className="whitespace-nowrap px-3 py-3 text-sm font-medium"
          title={fullDateTime(trader.lastTradeAt)}
        >
          {relativeTime(trader.lastTradeAt, now)}
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-right">
          <span className="block text-sm font-semibold tabular-nums">
            {count(trader.trades)}
          </span>
          <span className="block text-xs font-medium text-tertiary">
            {count(trader.openPositions)} open
          </span>
        </td>
        <MoneyCell>{money.format(trader.stakedKobo)}</MoneyCell>
        <MoneyCell muted={trader.openStakeKobo === 0}>
          {money.format(trader.openStakeKobo)}
        </MoneyCell>
        <MoneyCell className={result.tone} title={result.title}>
          {result.text}
        </MoneyCell>
        <MoneyCell>{money.format(trader.balanceKobo)}</MoneyCell>
        <td className="py-3 pr-3 text-right">
          <button
            type="button"
            aria-expanded={d.open}
            aria-label={`${d.open ? "Hide" : "Show"} ${name}'s bets`}
            onClick={(e) => {
              e.stopPropagation();
              d.toggle();
            }}
            className="inline-flex size-7 items-center justify-center rounded-sm text-tertiary hover:bg-element-2 hover:text-primary"
          >
            <ChevronDown
              className={`size-4 transition-transform ${d.open ? "rotate-180" : ""}`}
            />
          </button>
        </td>
      </tr>
      {d.open && (
        <tr>
          <td colSpan={8} className="border-t border-border bg-page px-4 py-3">
            <TraderDetailPanel trader={trader} state={d} money={money} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

function TraderCard({
  trader,
  now,
  money,
  onChanged,
}: {
  trader: TraderRow;
  now: number;
  money: AdminMoney;
  onChanged: () => void;
}) {
  const d = useTraderDetail(trader.authUserId);
  const result = theirResult(trader, money);
  const name = nameOf(trader);

  return (
    <li className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="flex min-w-0 items-center gap-3 px-4 pt-3">
        <Avatar name={name} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <span className="truncate">{name}</span>
            {trader.suspendedAt && <SuspendedChip />}
          </p>
          {trader.username && (
            <p className="truncate text-xs font-medium text-tertiary">
              @{trader.username}
            </p>
          )}
          {trader.email && (
            <p className="truncate text-xs font-medium text-tertiary">{trader.email}</p>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3">
        <Field
          label="Last bet"
          value={relativeTime(trader.lastTradeAt, now)}
          title={fullDateTime(trader.lastTradeAt)}
        />
        <Field
          label="Bets"
          value={count(trader.trades)}
          sub={`${count(trader.openPositions)} open`}
        />
        <Field label="Total staked" value={money.format(trader.stakedKobo)} />
        <Field
          label="In play"
          value={money.format(trader.openStakeKobo)}
          valueClass={trader.openStakeKobo === 0 ? "text-tertiary" : undefined}
        />
        <Field
          label="Their result"
          value={result.text}
          valueClass={result.tone}
          title={result.title}
        />
        <Field label="Balance" value={money.format(trader.balanceKobo)} />
      </dl>

      <button
        type="button"
        aria-expanded={d.open}
        onClick={d.toggle}
        className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2.5 text-sm font-semibold text-secondary transition-colors hover:bg-element hover:text-primary"
      >
        {d.open ? "Hide their bets" : "Show their bets"}
        <ChevronDown className={`size-4 transition-transform ${d.open ? "rotate-180" : ""}`} />
      </button>

      {d.open && (
        <div className="border-t border-border bg-page px-4 py-3">
          <TraderDetailPanel trader={trader} state={d} money={money} onChanged={onChanged} />
        </div>
      )}
    </li>
  );
}

/** Opened: the person's record, the suspend control, and every bet they have placed. */
function TraderDetailPanel({
  trader,
  state,
  money,
  onChanged,
}: {
  trader: TraderRow;
  state: DetailState;
  money: AdminMoney;
  onChanged: () => void;
}) {
  const { detail, failed, load } = state;
  return (
    <>
      <dl className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px] font-medium text-secondary">
        <Meta label="Joined" value={shortDate(trader.joinedAt)} />
        <Meta label="Last bet" value={fullDateTime(trader.lastTradeAt)} />
        <Meta
          label="Record"
          value={`${count(trader.wonPositions)} won · ${count(trader.lostPositions)} lost · ${count(
            trader.voidedPositions,
          )} refunded`}
        />
        <Meta
          label="In play"
          value={`${money.format(trader.openStakeKobo)} staked, could pay out ${money.format(
            trader.openPayoutKobo,
          )}`}
        />
        <Meta label="User id" value={trader.authUserId} mono />
      </dl>

      <AccountControl
        trader={trader}
        actions={detail?.accountActions}
        onChanged={() => {
          load();
          onChanged();
        }}
      />

      {detail?.money && (
        <BalanceBreakdown totals={detail.money} balanceKobo={trader.balanceKobo} money={money} />
      )}

      {failed ? (
        <p className="py-3 text-sm text-secondary">
          Couldn&rsquo;t load this trader&rsquo;s bets.{" "}
          <button type="button" onClick={load} className="font-semibold text-primary underline">
            Try again
          </button>
        </p>
      ) : !detail ? (
        <p className="py-3 text-sm text-secondary">Loading bets…</p>
      ) : detail.positions.length === 0 ? (
        <p className="py-3 text-sm text-secondary">This account has never placed a bet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {detail.positions.map((p) => (
            <li
              key={p.id}
              className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-surface px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <Link
                  href={bookHref(p.eventSlug, p.eventId)}
                  className="block truncate text-[13px] font-semibold hover:underline"
                >
                  {p.eventTitle}
                </Link>
                <span className="block truncate text-xs font-medium text-tertiary">
                  {p.marketTitle} · {p.outcomeLabel} @ {(p.priceKobo / 100).toFixed(0)}¢ ·{" "}
                  {shortDate(p.createdAt)}
                </span>
              </span>
              <span className="shrink-0 text-right text-[13px] font-semibold tabular-nums">
                {money.format(p.stakeKobo)}
              </span>
              <StatusPill status={p.reversedFrom ? "reversed" : p.status} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * How a person has done on their finished bets, from their side:
 * "Won ₦12,000" / "Lost ₦4,500" — net, across every won and lost bet.
 */
function theirResult(
  t: TraderRow,
  money: AdminMoney,
): { text: string; tone: string; title?: string } {
  const settled = t.wonPositions + t.lostPositions;
  if (settled === 0) {
    return { text: "—", tone: "text-tertiary", title: "No finished bets yet" };
  }
  const title = `Overall, on ${count(t.wonPositions)} won and ${count(t.lostPositions)} lost bets`;
  if (t.realizedPnlKobo > 0) {
    return { text: `Won ${money.format(t.realizedPnlKobo)}`, tone: "text-yes", title };
  }
  if (t.realizedPnlKobo < 0) {
    return { text: `Lost ${money.format(-t.realizedPnlKobo)}`, tone: "text-no", title };
  }
  return { text: "Broke even", tone: "text-secondary", title };
}

/* ---------- bits ---------- */

function HeadCell({
  column,
  sortColumn,
  sort,
  right,
  className = "",
  children,
}: {
  column: Column;
  sortColumn: Column;
  sort: TraderSort;
  right?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const sorted = column === sortColumn;
  return (
    <th
      scope="col"
      aria-sort={sorted ? (sort === "losers" ? "ascending" : "descending") : undefined}
      className={`whitespace-nowrap px-3 py-2.5 font-semibold ${right ? "text-right" : ""} ${
        sorted ? "text-primary" : ""
      } ${className}`}
    >
      <span className={`inline-flex items-center gap-1 ${right ? "flex-row-reverse" : ""}`}>
        {children}
        {sorted && <ArrowDown className="size-3" aria-hidden />}
      </span>
    </th>
  );
}

function MoneyCell({
  children,
  muted,
  className = "",
  title,
}: {
  children: React.ReactNode;
  muted?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <td
      title={title}
      className={`whitespace-nowrap px-3 py-3 text-right text-sm font-semibold tabular-nums ${
        muted ? "text-tertiary" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}

function Field({
  label,
  value,
  sub,
  valueClass,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
  title?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-tertiary">{label}</dt>
      <dd
        title={title}
        className={`mt-0.5 break-words text-sm font-semibold tabular-nums ${valueClass ?? ""}`}
      >
        {value}
        {sub && <span className="font-medium text-tertiary"> · {sub}</span>}
      </dd>
    </div>
  );
}

/** Each kind of money movement, in the order a balance is built up. */
const MONEY_KINDS: { type: string; label: string; hint: string }[] = [
  { type: "conversion_in", label: "Added from their wallet", hint: "dollars converted to credit" },
  { type: "conversion_out", label: "Withdrawn to their wallet", hint: "credit converted to dollars" },
  { type: "trade_stake", label: "Staked on bets", hint: "every bet placed" },
  { type: "payout", label: "Winnings paid", hint: "bets that won" },
  { type: "refund", label: "Refunds", hint: "voided bets and failed withdrawals" },
  { type: "reversal", label: "Reversals", hint: "stakes returned, winnings taken back" },
  { type: "debt_writeoff", label: "Debts waived", hint: "negative balances cleared" },
];

/**
 * Where an account's balance comes from: every movement since it opened,
 * by kind, adding up to the balance. The answer to "why is my balance
 * what it is" — the movements list below only shows the latest 50. If
 * the sum and the balance ever disagree, it says so: that is a bug.
 */
function BalanceBreakdown({
  totals,
  balanceKobo,
  money,
}: {
  totals: MoneyTotal[];
  balanceKobo: number;
  money: AdminMoney;
}) {
  const known = new Set(MONEY_KINDS.map((k) => k.type));
  const rows = [
    ...MONEY_KINDS.map((k) => ({ ...k, total: totals.find((t) => t.type === k.type) })),
    ...totals
      .filter((t) => !known.has(t.type))
      .map((t) => ({ type: t.type, label: t.type, hint: "", total: t })),
  ].filter((r) => r.total && r.total.count > 0);
  const sumKobo = totals.reduce((s, t) => s + t.amountKobo, 0);
  const gapKobo = balanceKobo - sumKobo;

  if (rows.length === 0) return null;
  return (
    <details className="mb-3 rounded-md border border-border bg-surface px-3 py-2.5" open>
      <summary className="cursor-pointer text-[13px] font-semibold">Where the balance comes from</summary>
      <table className="mt-2 w-full text-[13px]">
        <tbody>
          {rows.map((r) => (
            <tr key={r.type} className="border-b border-border last:border-0">
              <td className="py-1.5 pr-3">
                <span className="font-medium text-primary">{r.label}</span>
                <span className="ml-1.5 text-xs text-tertiary">
                  {count(r.total!.count)} {r.total!.count === 1 ? "time" : "times"}
                  {r.hint && ` · ${r.hint}`}
                </span>
              </td>
              <td
                className={`whitespace-nowrap py-1.5 text-right font-semibold tabular-nums ${
                  r.total!.amountKobo > 0 ? "text-yes" : r.total!.amountKobo < 0 ? "text-no" : ""
                }`}
              >
                {money.formatSigned(r.total!.amountKobo)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-2 pr-3 font-semibold">Balance now</td>
            <td
              className={`whitespace-nowrap pt-2 text-right text-base font-semibold tabular-nums ${
                balanceKobo < 0 ? "text-no" : ""
              }`}
            >
              {money.format(balanceKobo)}
            </td>
          </tr>
        </tfoot>
      </table>
      {gapKobo !== 0 && (
        <p className={`mt-2 rounded-md px-2.5 py-1.5 text-xs font-semibold ${FLAG_TONE.caution.chip}`}>
          These add up to {money.format(sumKobo)}, {money.format(Math.abs(gapKobo))}{" "}
          {gapKobo > 0 ? "less" : "more"} than the balance — something moved it outside the ledger.
          Tell the developers.
        </p>
      )}
    </details>
  );
}

function SuspendedChip() {
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${FLAG_TONE.danger.chip}`}
    >
      Suspended
    </span>
  );
}

const STATUS: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-element-2 text-secondary" },
  won: { label: "Won", className: "bg-yes-tint text-yes" },
  lost: { label: "Lost", className: "bg-no-tint text-no" },
  voided: { label: "Refunded", className: "bg-element-2 text-tertiary" },
  reversed: { label: "Reversed", className: FLAG_TONE.caution.chip },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, className: "bg-element-2 text-secondary" };
  return (
    <span
      className={`min-w-16 shrink-0 rounded-sm px-1.5 py-1 text-center text-[11px] font-bold uppercase tracking-wide ${s.className}`}
    >
      {s.label}
    </span>
  );
}

/** Initials on a name-derived hue — no remote avatar host to configure. */
function Avatar({ name }: { name: string }) {
  let hue = 0;
  for (let i = 0; i < name.length; i++) hue = (hue * 31 + name.charCodeAt(i)) % 360;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 60% 50%), hsl(${(hue + 60) % 360} 60% 40%))`,
      }}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}

function Stat({
  label,
  value,
  exact,
  note,
  valueClass,
}: {
  label: string;
  value: string;
  /** The unabbreviated amount, when `value` may be shortened ("₦1.2M"). */
  exact?: string;
  note: string;
  valueClass?: string;
}) {
  const shortened = exact !== undefined && exact !== value;
  return (
    <div className="min-w-0 rounded-md border border-border bg-page px-3 py-2.5">
      <p className="text-xs font-medium text-secondary">{label}</p>
      <p
        className={`mt-0.5 break-words text-lg font-semibold tabular-nums sm:text-xl ${valueClass ?? ""}`}
        title={shortened ? exact : undefined}
      >
        {value}
        {shortened && <span className="sr-only"> ({exact})</span>}
      </p>
      <p className="mt-0.5 break-words text-xs font-medium leading-4 text-tertiary">{note}</p>
    </div>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <dt className="shrink-0 text-tertiary">{label}</dt>
      <dd className={`min-w-0 ${mono ? "break-all font-mono text-[12px]" : ""}`}>{value}</dd>
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading traders">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-md bg-element-2" />
      ))}
    </div>
  );
}

function count(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "0";
}

/** "just now", "5 min ago", "3 hours ago", "2 days ago", then the date. */
function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  if (!now) return shortDate(iso);
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  if (d < 30) {
    const w = Math.floor(d / 7);
    return `${w} week${w === 1 ? "" : "s"} ago`;
  }
  return shortDate(iso);
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "19 Oct 2026, 14:05" — for hovers, where the relative time isn't enough. */
function fullDateTime(iso: string | null): string {
  if (!iso) return "No bets yet";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PageButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-9 rounded-full border border-border px-4 text-sm font-semibold text-secondary transition-colors hover:border-border-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-secondary"
    >
      {children}
    </button>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6 text-sm leading-6 text-secondary shadow-card">
      {children}
    </div>
  );
}
