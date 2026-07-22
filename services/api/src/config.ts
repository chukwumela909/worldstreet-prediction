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
};

export type ApiConfig = typeof config;
