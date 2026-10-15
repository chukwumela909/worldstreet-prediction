import { ListPageSkeleton } from "@/components/skeletons";

/** Instant state for the portfolio (dynamic: it reads ?tab=). */
export default function Loading() {
  return <ListPageSkeleton label="Loading portfolio" />;
}
