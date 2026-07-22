import { API_BASE } from "@/lib/auth-config";

/**
 * Client-side helper for the standalone prediction API (services/api).
 *
 * Cross-origin requests carry the Clerk session JWT as a Bearer token
 * (cookies won't ride along); when NEXT_PUBLIC_API_URL is unset, calls fall
 * back to same-origin paths. Same shape as xtreme-livestream's api-client.
 */

interface ClerkGlobal {
  session?: { getToken(): Promise<string | null> } | null;
}

/** Clerk session JWT for cross-origin requests to the API service. */
async function getSessionToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const clerk = (window as { Clerk?: ClerkGlobal }).Clerk;
    return (await clerk?.session?.getToken()) ?? null;
  } catch {
    return null;
  }
}

interface FetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

export function isApiConfigured(): boolean {
  return Boolean(API_BASE);
}

/** Fetch wrapper that attaches auth and returns the parsed JSON body. */
export async function apiFetch<T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  const target = API_BASE && url.startsWith("/") ? `${API_BASE}${url}` : url;

  if (API_BASE) {
    const token = await getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(target, {
    ...options,
    headers,
    credentials: "include",
  });

  // Parse defensively: gateway failures and error pages return HTML or an
  // empty body, and res.json() there throws an opaque "Unexpected token '<'"
  // that hides the real HTTP status.
  const raw = await res.text();
  let data: unknown = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      if (res.ok) {
        throw new ApiError(
          "The server returned an unexpected response.",
          res.status,
          raw,
        );
      }
    }
  }

  if (!res.ok) {
    const message =
      (data && typeof data === "object" && "message" in data
        ? (data as { message?: string }).message
        : undefined) ?? `Request failed (${res.status} ${res.statusText})`;
    throw new ApiError(message, res.status, data ?? raw);
  }

  return data as T;
}

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}
