import "dotenv/config";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  TRUST_PROXY: booleanString,
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().min(1).default("worldstreet-prediction"),
  // Central WorldStreet auth (Clerk on worldstreetgold.com). Same keys as the
  // other satellite platforms — the session JWT is verified Clerk-side.
  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_AUTHORIZED_PARTIES: z.string().default(""),
  CORS_ORIGINS: z.string().default(""),
  // Central wallet service. Leave unset to boot without money features —
  // wallet routes then respond 503 instead of blocking the whole API.
  WALLET_API_URL: z.string().default(""),
  WALLET_SERVICE_TOKEN: z.string().default(""),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(200),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  // The book's pricing and limits. Spread/caps are integer kobo / basis
  // points. These are only STARTING DEFAULTS: the admin desk's Settings
  // page overrides each of them at runtime (trading/settings.ts), and an
  // override wins over the env until it's changed back. The FX mid rate
  // itself is admin-set via POST /admin/fx-rate, deliberately not an env
  // var.
  FX_SPREAD_BPS: z.coerce.number().int().min(0).max(2_000).default(100),
  /** Max single stake, kobo (default ₦50,000). */
  TRADE_MAX_STAKE_KOBO: z.coerce.number().int().min(10_000).default(5_000_000),
  /** Max house exposure (payouts beyond stakes) per market, kobo (default ₦2M). */
  TRADE_MAX_MARKET_EXPOSURE_KOBO: z.coerce
    .number()
    .int()
    .min(100_000)
    .default(200_000_000),
  /**
   * House spread on international (Polymarket) prices, in basis points of
   * a ₦100 share added to Polymarket's price on each side (default 300 =
   * 3 percentage points: a 60% outcome sells at 63). See
   * trading/polymarket/pricing.ts.
   */
  POLYMARKET_SPREAD_BPS: z.coerce.number().int().min(0).max(2_000).default(300),
  /** No new trades this close to a countdown market's close (default 90s). */
  TRADE_COUNTDOWN_CUTOFF_SECONDS: z.coerce.number().int().min(0).default(90),
  /** Auto-settlement poll cadence; 0 disables the worker. */
  SETTLEMENT_POLL_SECONDS: z.coerce.number().int().min(0).default(60),
  /** Alert when a market is unresolved this long past its resolution date. */
  SETTLEMENT_OVERDUE_HOURS: z.coerce.number().int().min(1).default(6),
  /** Optional generic webhook for settlement alerts. */
  ALERT_WEBHOOK_URL: z.string().default(""),
  // Settlement alert email (Resend). All three must be set for mail to
  // go out; the sender's domain has to be verified in Resend first.
  RESEND_API_KEY: z.string().default(""),
  ALERT_EMAIL_FROM: z.string().default(""),
  /** Comma-separated recipients. */
  ALERT_EMAIL_TO: z.string().default(""),
  /**
   * Sender for notices to customers (a refunded bet), e.g.
   * "WorldStreet <support@worldstreetgold.com>". Falls back to
   * ALERT_EMAIL_FROM; needs RESEND_API_KEY either way (customer-mail.ts).
   */
  CUSTOMER_EMAIL_FROM: z.string().default(""),
  /**
   * How long the same alert condition stays quiet after being sent. The
   * poller re-detects a stuck market every pass; without this it would
   * mail on every one. 0 sends every time.
   */
  ALERT_REPEAT_HOURS: z.coerce.number().min(0).default(6),
  /**
   * Admin desk access keys, `name:key` pairs separated by commas, e.g.
   * `josh:Xq3…,wisdom:9fB…`. Each key opens the desk without the Clerk
   * admin role; the name is what the audit trail records. Empty (the
   * default) turns key access off and leaves only the Clerk role — that
   * IS the revert. Keys must be at least 32 characters; generate one with
   * `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`.
   */
  ADMIN_ACCESS_KEYS: z.string().default(""),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const missing = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid API environment:\n${missing}`);
}

const splitList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** Shortest admin access key accepted — long enough that guessing is hopeless. */
const MIN_ADMIN_KEY_LENGTH = 32;

/**
 * ADMIN_ACCESS_KEYS as name → key pairs. A malformed entry, a short key,
 * or a repeated name or key stops the boot: a typo here should never
 * quietly open (or quietly lock) the admin desk.
 */
function parseAdminKeys(raw: string): { name: string; key: string }[] {
  const entries = splitList(raw).map((entry) => {
    const at = entry.indexOf(":");
    const name = at > 0 ? entry.slice(0, at).trim() : "";
    const key = at > 0 ? entry.slice(at + 1).trim() : "";
    if (!/^[a-z0-9_-]{1,40}$/i.test(name)) {
      throw new Error("Invalid API environment:\nADMIN_ACCESS_KEYS: each entry must be name:key");
    }
    if (key.length < MIN_ADMIN_KEY_LENGTH) {
      throw new Error(
        `Invalid API environment:\nADMIN_ACCESS_KEYS: the key for "${name}" must be at least ${MIN_ADMIN_KEY_LENGTH} characters`,
      );
    }
    return { name, key };
  });
  const names = new Set(entries.map((e) => e.name.toLowerCase()));
  const keys = new Set(entries.map((e) => e.key));
  if (names.size !== entries.length || keys.size !== entries.length) {
    throw new Error("Invalid API environment:\nADMIN_ACCESS_KEYS: names and keys must be unique");
  }
  return entries;
}

export const config = {
  ...parsed.data,
  clerkAuthorizedParties: splitList(parsed.data.CLERK_AUTHORIZED_PARTIES),
  corsOrigins: splitList(parsed.data.CORS_ORIGINS),
  alertEmailTo: splitList(parsed.data.ALERT_EMAIL_TO),
  adminAccessKeys: parseAdminKeys(parsed.data.ADMIN_ACCESS_KEYS),
};

export type ApiConfig = typeof config;
