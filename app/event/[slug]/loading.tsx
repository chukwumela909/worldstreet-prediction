import { MarketDetailSkeleton } from "@/components/skeletons";

/** Instant state for a market page — prefetched with every market link. */
export default function Loading() {
  return <MarketDetailSkeleton />;
}
