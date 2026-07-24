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
  // Local markets book (Bayse-fed, naira-denominated). Spread/caps are
  // integer kobo / basis points; the FX mid rate itself is admin-set at
  // runtime via POST /admin/fx-rate, deliberately not an env var.
  FX_SPREAD_BPS: z.coerce.number().int().min(0).max(2_000).default(100),
  /** Max single stake, kobo (default ₦50,000). */
  TRADE_MAX_STAKE_KOBO: z.coerce.number().int().min(10_000).default(5_000_000),
  /** Max house exposure (payouts beyond stakes) per market, kobo (default ₦2M). */
  TRADE_MAX_MARKET_EXPOSURE_KOBO: z.coerce
    .number()
    .int()
    .min(100_000)
    .default(200_000_000),
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

export const config = {
  ...parsed.data,
  clerkAuthorizedParties: splitList(parsed.data.CLERK_AUTHORIZED_PARTIES),
  corsOrigins: splitList(parsed.data.CORS_ORIGINS),
  alertEmailTo: splitList(parsed.data.ALERT_EMAIL_TO),
};

export type ApiConfig = typeof config;
