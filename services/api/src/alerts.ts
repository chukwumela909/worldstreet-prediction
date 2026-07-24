import type { FastifyBaseLogger } from "fastify";
import { config } from "./config.js";

/**
 * Operational alerts for things the automated paths couldn't finish —
 * today that means settlement exceptions (a market Bayse resolved to a
 * label none of its outcomes match, one long overdue, a payout run that
 * failed). Somebody has to look at these; money is sitting behind them.
 *
 * Three channels, all optional and all best-effort: the log always, an
 * email through Resend when it's configured, and the generic webhook
 * that predates it. A failing channel is logged and swallowed — an
 * alert that can't be delivered must not take down the settlement pass
 * that raised it.
 */

const DELIVERY_TIMEOUT_MS = 5_000;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendAlert(
  log: FastifyBaseLogger,
  subject: string,
  detail: Record<string, unknown>,
): Promise<void> {
  log.warn({ alert: subject, ...detail }, "settlement alert");

  await Promise.all([
    emailAlert(log, subject, detail),
    webhookAlert(log, subject, detail),
  ]);
}

function isEmailConfigured(): boolean {
  return Boolean(
    config.RESEND_API_KEY && config.ALERT_EMAIL_FROM && config.alertEmailTo.length,
  );
}

async function emailAlert(
  log: FastifyBaseLogger,
  subject: string,
  detail: Record<string, unknown>,
): Promise<void> {
  if (!isEmailConfigured()) return;
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.ALERT_EMAIL_FROM,
        to: config.alertEmailTo,
        subject: `[Worldstreet Local] ${subject}`,
        text: emailBody(subject, detail),
      }),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Resend explains rejections in the body (bad key, unverified
      // sender); without it the log says nothing actionable.
      log.error(
        { status: res.status, body: await res.text().catch(() => "") },
        "alert email rejected",
      );
    }
  } catch (err) {
    log.error({ err }, "alert email failed");
  }
}

/** Plain text — these are read on a phone at an awkward hour. */
function emailBody(subject: string, detail: Record<string, unknown>): string {
  const lines = Object.entries(detail).map(
    ([key, value]) => `${key}: ${format(value)}`,
  );
  return [
    subject,
    "",
    ...lines,
    "",
    "Open the settlement queue to clear it: /admin",
  ].join("\n");
}

function format(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function webhookAlert(
  log: FastifyBaseLogger,
  subject: string,
  detail: Record<string, unknown>,
): Promise<void> {
  if (!config.ALERT_WEBHOOK_URL) return;
  try {
    await fetch(config.ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject,
        detail,
        service: "worldstreet-prediction-api",
      }),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
  } catch (err) {
    log.error({ err }, "alert webhook failed");
  }
}
