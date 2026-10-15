/**
 * Loading skeletons — the instant state a navigation lands on while the
 * page's data streams in. Each one mirrors the real layout's boxes (same
 * container, grid and card sizes), so content swaps in without the page
 * jumping. Server-safe: no hooks, no data.
 */

/** One placeholder block. Pulses unless the visitor asked for less motion. */
export function Bone({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-md bg-element-2 motion-reduce:animate-none ${className}`}
    />
  );
}

/** Screen-reader announcement shared by every skeleton. */
function Busy({ label }: { label: string }) {
  return (
    <p role="status" className="sr-only">
      {label}
    </p>
  );
}

/** Same footprint as MarketCard: icon strip, title, two quote rows, footer. */
export function CardSkeleton() {
  return (
    <div className="flex min-h-[260px] flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <Bone className="size-8" />
        <Bone className="h-3 w-24" />
      </div>
      <div className="space-y-2">
        <Bone className="h-4 w-11/12" />
        <Bone className="h-4 w-2/3" />
        <Bone className="h-3 w-20" />
      </div>
      <div className="my-auto space-y-4">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="flex-1 space-y-2">
              <Bone className="h-3.5 w-1/2" />
              <Bone className="h-0.5 w-2/5" />
            </div>
            <Bone className="h-3 w-9" />
            <Bone className="h-8 w-14 rounded-full" />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Bone className="mr-auto h-3 w-16" />
        <Bone className="h-3 w-20" />
      </div>
    </div>
  );
}

/** The featured-market card: header, quote rows on the left, chart on the right. */
export function FeaturedSkeleton({ className = "h-[480px]" }: { className?: string }) {
  return (
    <div className={`flex flex-col rounded-xl border border-border bg-surface p-6 ${className}`}>
      <div className="flex items-center gap-3">
        <Bone className="size-12" />
        <div className="flex-1 space-y-2">
          <Bone className="h-3 w-32" />
          <Bone className="h-5 w-3/4" />
        </div>
      </div>
      <div className="mt-6 grid flex-1 gap-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="flex-1 space-y-2">
                <Bone className="h-4 w-3/5" />
                <Bone className="h-0.5 w-1/2" />
              </div>
              <Bone className="h-10 w-16 rounded-full" />
            </div>
          ))}
        </div>
        <Bone className="hidden h-full min-h-48 md:block" />
      </div>
    </div>
  );
}

/** Right rail beside the hero: two promo cards and the hot-topics list. */
export function RailSkeleton() {
  return (
    <div className="hidden flex-col gap-3 lg:flex">
      <Bone className="h-[118px] rounded-xl" />
      <Bone className="h-[118px] rounded-xl" />
      <div className="space-y-3 pt-2">
        <Bone className="h-4 w-24" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Bone key={i} className="h-6 w-full" />
        ))}
      </div>
    </div>
  );
}

/** Hero + rail row of the home board. */
export function LeadSkeleton() {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2.5fr)_minmax(0,1fr)]">
      <div>
        <FeaturedSkeleton />
        <div className="h-12" />
      </div>
      <RailSkeleton />
    </div>
  );
}

/** Section heading + two rows of cards, beside the rankings column. */
export function GridSkeleton() {
  return (
    <div className="mt-7">
      <Bone className="h-6 w-40" />
      <div className="mt-4 flex gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Bone key={i} className="h-8 w-20" />
        ))}
      </div>
      <div className="grid items-start gap-6 pt-5 lg:grid-cols-[minmax(0,2.5fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <div className="hidden flex-col gap-6 lg:flex">
          <Bone className="h-64 rounded-xl" />
          <Bone className="h-64 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/** Whole home board (Trending / Local). */
export function BoardSkeleton() {
  return (
    <>
      <Busy label="Loading markets" />
      <LeadSkeleton />
      <GridSkeleton />
    </>
  );
}

/** A category page: subgroup sidebar, heading and tools, featured, grid. */
export function CategorySkeleton() {
  return (
    <section className="grid items-start gap-4 md:grid-cols-[160px_minmax(0,1fr)] md:gap-5 xl:grid-cols-[192px_minmax(0,1fr)] xl:gap-6">
      <Busy label="Loading markets" />
      <div className="flex gap-2 border-b border-border pb-3 md:flex-col md:border-0">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Bone key={i} className="h-11 w-24 shrink-0 md:h-12 md:w-full" />
        ))}
      </div>
      <div className="min-w-0">
        <div className="mb-4 flex min-h-12 items-center justify-between gap-4">
          <Bone className="h-6 w-32" />
          <Bone className="h-9 w-32" />
        </div>
        <FeaturedSkeleton className="h-[440px]" />
        <div className="h-12" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

/** A market page: breadcrumb, lockup, chart and outcome cards, trade aside. */
export function MarketDetailSkeleton() {
  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      <Busy label="Loading market" />
      <div className="flex items-center justify-between">
        <Bone className="h-4 w-36" />
        <Bone className="h-4 w-28" />
      </div>
      <div className="mt-6 flex gap-6 lg:gap-10">
        <div className="min-w-0 flex-1 space-y-6">
          <div className="flex items-center gap-4">
            <Bone className="size-12 sm:size-14" />
            <div className="flex-1 space-y-2">
              <Bone className="h-3 w-40" />
              <Bone className="h-7 w-3/4" />
            </div>
          </div>
          <Bone className="h-[360px] rounded-xl" />
          <Bone className="h-72 rounded-xl" />
        </div>
        <Bone className="hidden h-[420px] w-[360px] shrink-0 rounded-xl lg:block" />
      </div>
    </main>
  );
}

/** Leaderboard / portfolio: page title, a tile row, and a list card. */
export function ListPageSkeleton({ label }: { label: string }) {
  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      <Busy label={label} />
      <Bone className="h-8 w-48" />
      <Bone className="mt-2 h-4 w-72" />
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Bone key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Bone className="mt-6 h-96 rounded-xl" />
    </main>
  );
}
