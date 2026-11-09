"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * The admin's own error boundary. The site-wide one blames Polymarket for
 * anything, which tells the desk nothing; this one says what broke, so it
 * can be passed to the developers.
 */
export default function AdminError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="max-w-2xl rounded-xl border border-border bg-surface p-6 shadow-card">
      <h1 className="text-xl font-semibold">This admin page hit an error</h1>
      <p className="mt-1 text-sm text-secondary">
        Try again first. If it keeps happening, send the message below to the developers.
      </p>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-element-2 p-3 text-xs text-primary">
        {error.message || "No message"}
        {error.digest ? `\nReference: ${error.digest}` : ""}
      </pre>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="pressable h-9 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover"
        >
          Try again
        </button>
        <Link
          href="/admin"
          className="inline-flex h-9 items-center rounded-sm border border-border px-4 text-sm font-semibold text-secondary hover:text-primary"
        >
          Back to the Local book
        </Link>
      </div>
    </div>
  );
}
