/**
 * Central WorldStreet auth configuration (build-time constants).
 *
 * The whole Clerk integration is gated on NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
 * unset (local dev before keys exist) the app is permanently signed out,
 * set (staging/prod) it runs as a Clerk satellite of worldstreetgold.com so
 * one central login works across every WorldStreet platform.
 */

export const CLERK_ENABLED = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

/** Primary Clerk domain that owns the session. */
export const CLERK_DOMAIN =
  process.env.NEXT_PUBLIC_CLERK_DOMAIN || "worldstreetgold.com";

/** Central login page all platforms redirect to. */
export const CLERK_SIGN_IN_URL =
  process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ||
  "https://www.worldstreetgold.com/login";

/**
 * Where a user tops up their central WorldStreet dollar wallet — the money
 * the credit dialog converts from. That wallet lives on the main site, not
 * here; point this at its funding page.
 */
export const WALLET_FUND_URL =
  process.env.NEXT_PUBLIC_WALLET_FUND_URL || "https://www.worldstreetgold.com";

/** Base URL of the standalone prediction API; empty = not wired yet. */
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(
  /\/+$/,
  "",
);
