"use client";

import { useId, useState } from "react";
import { ArrowPathIcon as Loader, KeyIcon as Key } from "@heroicons/react/24/outline";
import { ApiError, errorMessage, isApiConfigured } from "@/lib/api-client";
import { verifyAdminKey } from "@/lib/admin-api";
import { setAdminKey } from "@/lib/admin-key";

/**
 * The admin desk's front door: an access key (checked with the API,
 * then kept for this tab — lib/admin-key.ts) or, as before, logging in
 * with an account that has the Clerk admin role. `onCancel` is offered
 * when someone already logged in chose "Use an access key" from the desk.
 */
export function AdminUnlock({
  onLogIn,
  onCancel,
}: {
  onLogIn?: () => void;
  onCancel?: () => void;
}) {
  const inputId = useId();
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    const typed = key.trim();
    if (!typed || pending) return;
    if (!isApiConfigured()) {
      setError("This site isn't connected to the admin API (NEXT_PUBLIC_API_URL is not set).");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { label } = await verifyAdminKey(typed);
      setAdminKey({ key: typed, label });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "That access key isn't valid."
          : errorMessage(err, "Couldn't check the key. Try again."),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 shadow-card">
        <div className="text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-element-2">
            <Key className="size-5 text-accent-ink" />
          </span>
          <h1 className="mt-4 text-xl font-semibold">Worldstreet Admin</h1>
          <p className="mt-2 text-sm text-secondary">
            Enter your admin access key to open the desk.
          </p>
        </div>

        <form onSubmit={unlock} className="mt-6 grid gap-3">
          <label htmlFor={inputId} className="sr-only">
            Access key
          </label>
          <input
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Access key"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
            className="h-11 w-full rounded-md border border-border bg-page px-4 text-sm text-primary outline-none transition-[border-color,box-shadow] placeholder:text-tertiary hover:border-border-hover focus:border-accent focus:ring-1 focus:ring-accent"
          />
          {error && (
            <p id={`${inputId}-error`} role="alert" className="text-sm text-no">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={!key.trim() || pending}
            className="pressable flex h-11 w-full items-center justify-center gap-2 rounded-md bg-accent text-base font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50"
          >
            {pending && <Loader className="size-4 animate-spin" />}
            Unlock
          </button>
        </form>

        {(onLogIn || onCancel) && (
          <div className="mt-5 border-t border-border pt-5 text-center text-sm text-secondary">
            {onLogIn && (
              <p>
                Have an admin account?{" "}
                <button
                  type="button"
                  onClick={onLogIn}
                  className="font-semibold text-accent-ink hover:underline"
                >
                  Log in instead
                </button>
              </p>
            )}
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="font-semibold text-secondary hover:text-primary"
              >
                Back to the desk
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
