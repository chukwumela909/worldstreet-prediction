"use client";

import Link from "next/link";
import { NoSymbolIcon as Ban } from "@heroicons/react/24/outline";
import { useAuth } from "@/components/auth/auth-context";
import { useSuspension } from "@/lib/account-status";

/**
 * A strip under the header while the signed-in account is suspended: what
 * it means, the desk's reason, and the way to ask about it. Nothing shows
 * for anyone else.
 */
export function SuspendedNotice() {
  const { user } = useAuth();
  const suspension = useSuspension(user?.email || null);
  if (!suspension) return null;

  return (
    <div role="status" className="border-b border-no/40 bg-no-tint">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm sm:px-6">
        <p className="flex min-w-0 flex-1 basis-72 items-start gap-2">
          <Ban className="mt-0.5 size-4 shrink-0 text-no" aria-hidden />
          <span className="min-w-0">
            <span className="font-semibold text-no">Your account is suspended.</span>{" "}
            <span className="text-primary">You can&rsquo;t place bets or move money right now.</span>
            {suspension.reason && (
              <span className="text-secondary"> Reason: {suspension.reason}</span>
            )}
          </span>
        </p>
        <Link href="/support" className="shrink-0 text-sm font-semibold text-primary underline underline-offset-2">
          Contact support
        </Link>
      </div>
    </div>
  );
}
