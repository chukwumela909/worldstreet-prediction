"use client";

import { useState } from "react";
import { ArrowPathIcon as RefreshCw } from "@heroicons/react/24/outline";
import { isApiConfigured } from "@/lib/api-client";
import {
  fetchBookSettings,
  fetchSettlementQueue,
  fetchSettlements,
  useAdminResource,
  type BookSettingsState,
} from "@/lib/admin-api";
import { MarketControlsCard } from "@/components/admin/market-controls";
import { PausedRefundsReport } from "@/components/admin/paused-refunds";
import { RecentSettlements, SettlementQueue } from "@/components/admin/local-desk";

/**
 * Markets → All open: every market with open bets, ours and Bayse's, and
 * the controls for a whole type of market.
 *
 * Top: Market controls (stop new bets, close and refund, close early, by
 * a word in the markets' names). Then the settlement queue as one list,
 * the flagged events first with their settle controls open, then what
 * was settled lately, then what closing markets has refunded.
 */
export function OpenMarketsDesk() {
  const queue = useAdminResource(fetchSettlementQueue, true);
  const settlements = useAdminResource(fetchSettlements, true);
  const settings = useAdminResource(fetchBookSettings, true);
  // A save answers with the new settings; they stand until the resource
  // itself re-reads (Refresh), which hands back a new object.
  const [saved, setSaved] = useState<{ state: BookSettingsState; over: BookSettingsState | null } | null>(null);
  const state = saved && saved.over === settings.data ? saved.state : settings.data;

  const refresh = () => {
    queue.refresh();
    settlements.refresh();
    settings.refresh();
  };

  if (!isApiConfigured()) {
    return (
      <Notice>
        This desk needs the prediction API. Set <code className="font-mono text-[13px]">NEXT_PUBLIC_API_URL</code> and
        rebuild.
      </Notice>
    );
  }

  // 403 means a signed-in non-admin, not a broken page.
  if (queue.errorCode === "FORBIDDEN" || settlements.errorCode === "FORBIDDEN") {
    return (
      <Notice>
        Your account isn&rsquo;t an admin of the Local book. Ask for the{" "}
        <code className="font-mono text-[13px]">admin</code> role on your central WorldStreet account.
      </Notice>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">All open markets</h1>
          <p className="mt-1 text-sm text-secondary">
            Every market with open bets, ours and Bayse&rsquo;s. Flagged ones come first.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold text-secondary hover:border-border-hover hover:text-primary"
        >
          <RefreshCw className={`size-3.5 ${queue.loading || settings.loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {state ? (
        <MarketControlsCard state={state} onSaved={(next) => setSaved({ state: next, over: settings.data })} />
      ) : settings.error ? (
        <p className="mt-6 rounded-xl border border-border bg-surface p-4 text-sm text-secondary shadow-card">
          Couldn&rsquo;t load Market controls: {settings.error}{" "}
          <button type="button" onClick={settings.refresh} className="font-semibold text-accent-ink hover:underline">
            Try again
          </button>
        </p>
      ) : (
        <div className="mt-6 h-48 animate-pulse rounded-xl bg-element-2" aria-hidden />
      )}

      <SettlementQueue queue={queue.data} loading={queue.loading} error={queue.error} onDone={refresh} mode="all" />

      <RecentSettlements items={settlements.data} />

      <PausedRefundsReport />
    </>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-card">
      <h1 className="text-lg font-semibold">All open markets</h1>
      <p className="mt-2 text-sm text-secondary">{children}</p>
    </div>
  );
}
