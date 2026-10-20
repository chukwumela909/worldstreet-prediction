import type { FastifyBaseLogger } from "fastify";
import { config } from "./config.js";

/**
 * Plain notices to customers about their own money — a refund they
 * didn't ask for, say — through the same Resend account as the admin
 * alerts (alerts.ts). Sent from CUSTOMER_EMAIL_FROM, else from
 * ALERT_EMAIL_FROM; with no Resend key or no sender nothing goes out and
 * the caller carries on. Recipients are never logged.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;
/** Resend's default allowance is a couple of sends a second. */
const GAP_MS = 600;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function sender(): string {
  return config.CUSTOMER_EMAIL_FROM || config.ALERT_EMAIL_FROM;
}

export function isCustomerMailConfigured(): boolean {
  return Boolean(config.RESEND_API_KEY && sender());
}

export interface CustomerEmail {
  to: string;
  subject: string;
  text: string;
}

/** Send each in turn, spaced for Resend's rate; whether Resend accepted each. */
export async function sendCustomerEmails(
  log: FastifyBaseLogger,
  emails: CustomerEmail[],
): Promise<boolean[]> {
  if (emails.length === 0) return [];
  if (!isCustomerMailConfigured()) {
    log.warn({ count: emails.length }, "customer emails not sent: Resend isn't configured");
    return emails.map(() => false);
  }
  const sent: boolean[] = [];
  for (const [i, mail] of emails.entries()) {
    if (i > 0) await sleep(GAP_MS);
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: sender(), to: [mail.to], subject: mail.subject, text: mail.text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      sent.push(res.ok);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        log.error({ status: res.status, body: body.slice(0, 300) }, "customer email rejected");
      }
    } catch (err) {
      sent.push(false);
      log.error({ err }, "customer email failed");
    }
  }
  return sent;
}
