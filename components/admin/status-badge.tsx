import type { MarketStatus } from "@/lib/admin-store";

const STYLES: Record<MarketStatus, string> = {
  draft: "bg-element-2 text-secondary",
  live: "bg-yes-tint text-yes",
  paused: "bg-no-tint text-no",
  closed: "bg-element-2 text-secondary",
  resolving: "bg-accent/10 text-accent",
  resolved: "bg-accent text-white",
};

const LABELS: Record<MarketStatus, string> = {
  draft: "Draft",
  live: "Live",
  paused: "Paused",
  closed: "Closed",
  resolving: "Resolving",
  resolved: "Resolved",
};

export function StatusBadge({ status }: { status: MarketStatus }) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-sm px-1.5 text-[11px] font-semibold ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
