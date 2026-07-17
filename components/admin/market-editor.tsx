"use client";

import Link from "next/link";
import { MarketForm } from "@/components/admin/market-form";
import { useAdminState } from "@/lib/admin-store";

/** Loads an admin-created event from the store and renders the form. */
export function MarketEditor({ id }: { id: string }) {
  const { created } = useAdminState();
  const event = created.find((e) => e.id === id);

  if (!event) {
    // Store is client-side: SSR (and unknown ids) land here.
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
        <p className="text-sm text-secondary">
          Market not found — only admin-created markets can be edited.
        </p>
        <Link
          href="/admin/markets"
          className="mt-3 inline-block text-sm font-semibold text-accent hover:underline"
        >
          Back to markets
        </Link>
      </div>
    );
  }

  return <MarketForm key={event.id} initial={event} />;
}
