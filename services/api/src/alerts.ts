import type { FastifyBaseLogger } from "fastify";
import { config } from "./config.js";
import { AlertState } from "./models.js";

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
 *
 * Delivery is throttled per condition. The poller re-detects a stuck
 * market on every pass — once a minute by default — and mailing that
 * would bury the one alert that matters and get the sending domain
 * marked as spam. The log still records every occurrence.
 */

const DELIVERY_TIMEOUT_MS = 5_000;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendAlert(
  log: FastifyBaseLogger,
  subject: string,
  detail: Record<string, unknown>,
  /**
   * Identifies the ongoing condition, not this occurrence — e.g.
   * `overdue:<eventId>`. Omit to deliver unconditionally.
   */
  throttleKey?: string,
): Promise<void> {
  log.warn({ alert: subject, ...detail }, "settlement alert");

  const decision = throttleKey
    ? await claimAlert(log, throttleKey, subject)
    : { send: true, suppressedSinceLast: 0 };
  if (!decision.send) return;

  const body =
    decision.suppressedSinceLast > 0
      ? {
          ...detail,
          alsoSeen: `${decision.suppressedSinceLast} more times since the last alert`,
        }
      : detail;

  await Promise.all([
    emailAlert(log, subject, body),
    webhookAlert(log, subject, body),
  ]);
}

/**
 * Win the right to deliver this condition, or count the occurrence and
 * stay quiet. Both paths are single conditional writes, so two instances
 * polling at once still produce exactly one alert per window.
 */
async function claimAlert(
  log: FastifyBaseLogger,
  key: string,
  subject: string,
): Promise<{ send: boolean; suppressedSinceLast: number }> {
  const windowMs = config.ALERT_REPEAT_HOURS * 3_600_000;
  if (windowMs === 0) return { send: true, suppressedSinceLast: 0 };

  try {
    // claim it if the quiet window has passed, taking the suppressed
    // count with us (the pre-update doc still carries it)
    const claimed = await AlertState.findOneAndUpdate(
      { key, lastSentAt: { $lte: new Date(Date.now() - windowMs) } },
      { $set: { lastSentAt: new Date(), subject, suppressedCount: 0 } },
      { returnDocument: "before" },
    );
    if (claimed) {
      return { send: true, suppressedSinceLast: claimed.suppressedCount ?? 0 };
    }

    // no row yet? first sighting: insert and deliver
    try {
      await AlertState.create({ key, subject, lastSentAt: new Date() });
      return { send: true, suppressedSinceLast: 0 };
    } catch (err) {
      const duplicate =
        err && typeof err === "object" && "code" in err && err.code === 11000;
      if (!duplicate) throw err;
    }

    // inside the window — record that it's still happening
    await AlertState.updateOne({ key }, { $inc: { suppressedCount: 1 } });
    return { send: false, suppressedSinceLast: 0 };
  } catch (err) {
    // never let bookkeeping swallow an alert
    log.error({ err, key }, "alert throttle failed; delivering anyway");
    return { send: true, suppressedSinceLast: 0 };
  }
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
