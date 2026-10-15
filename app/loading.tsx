import { BoardSkeleton } from "@/components/skeletons";

/**
 * Instant state for "/" (every home tab). Because this boundary exists,
 * links to the home page prefetch it, so a click paints this skeleton
 * under the persistent header immediately instead of waiting on the
 * server render.
 */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      <BoardSkeleton />
    </main>
  );
}
