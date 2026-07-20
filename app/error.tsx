"use client";

/**
 * App-level error boundary. With no fixture fallbacks anywhere, an
 * unreachable Polymarket API surfaces here instead of as fake data.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-lg font-semibold">Live market data is unavailable</p>
      <p className="max-w-md text-sm text-secondary">
        We couldn&apos;t reach Polymarket&apos;s public API. Nothing is shown
        here unless it&apos;s real market data — try again in a moment.
      </p>
      <button
        onClick={reset}
        className="mt-2 h-10 rounded-md bg-accent px-5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
      >
        Try again
      </button>
    </main>
  );
}
