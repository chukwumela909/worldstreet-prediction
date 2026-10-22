import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { config } from "./config.js";
import { ApiError } from "./errors.js";
import { AlertRecord, AlertState, type AlertKind } from "./models.js";

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
 *
 * Every alert is also kept (AlertRecord) for the desk's Alerts tab, one
 * row per condition counting each firing — emailed or not — so the desk
 * can see what's still happening and mark it settled. Support requests
 * aren't kept here: the Support inbox is their record.
 */

const DELIVERY_TIMEOUT_MS = 5_000;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * What became of one alert. The settlement pass ignores this — it can't
 * do anything about a failed send — but the admin test endpoint reports
 * it, which is the only way to find out whether the mail configuration
 * on a deployed instance actually works before an incident needs it.
 */
export interface AlertDelivery {
  /** True when the quiet window swallowed it; nothing was delivered. */
  throttled: boolean;
  email: "sent" | "failed" | "not_configured";
  emailError?: string;
  webhook: "sent" | "failed" | "not_configured";
}

export interface AlertOptions {
  /**
   * Identifies the ongoing condition, not this occurrence — e.g.
   * `overdue:<eventId>`. Omit to deliver unconditionally.
   */
  throttleKey?: string;
  /** The email's last line: where on the desk to deal with it. */
  footer?: string;
  /** What it's about, for the Alerts tab; "support" isn't kept there. */
  kind?: AlertKind | "support";
  /** The market it's about, when there's one — what the desk's fix acts on. */
  eventId?: string;
  marketId?: string;
}

export async function sendAlert(
  log: FastifyBaseLogger,
  subject: string,
  detail: Record<string, unknown>,
  opts: AlertOptions = {},
): Promise<AlertDelivery> {
  const { throttleKey, footer = "Open the settlement queue to clear it: /admin" } = opts;
  log.warn({ alert: subject, ...detail }, "settlement alert");
  await recordAlert(log, subject, detail, opts);

  const decision = throttleKey
    ? await claimAlert(log, throttleKey, subject)
    : { send: true, suppressedSinceLast: 0 };
  if (!decision.send) {
    return { throttled: true, email: "not_configured", webhook: "not_configured" };
  }

  const body =
    decision.suppressedSinceLast > 0
      ? {
          ...detail,
          alsoSeen: `${decision.suppressedSinceLast} more times since the last alert`,
        }
      : detail;

  const [email, webhook] = await Promise.all([
    emailAlert(log, subject, body, footer),
    webhookAlert(log, subject, body),
  ]);
  return { throttled: false, ...email, webhook };
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
  footer: string,
): Promise<{ email: AlertDelivery["email"]; emailError?: string }> {
  if (!isEmailConfigured()) return { email: "not_configured" };
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
        text: emailBody(subject, detail, footer),
      }),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (res.ok) return { email: "sent" };

    // Resend explains rejections in the body (bad key, unverified
    // sender); without it the log says nothing actionable.
    const body = await res.text().catch(() => "");
    log.error({ status: res.status, body }, "alert email rejected");
    return { email: "failed", emailError: resendMessage(res.status, body) };
  } catch (err) {
    log.error({ err }, "alert email failed");
    return {
      email: "failed",
      emailError: err instanceof Error ? err.message : "Delivery failed",
    };
  }
}

/** Resend's own explanation, which is the actionable part of a rejection. */
function resendMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (parsed.message) return `${status}: ${parsed.message}`;
  } catch {
    // not JSON — fall through to the raw body
  }
  return `${status}: ${body.slice(0, 200) || "no detail"}`;
}

/** Plain text — these are read on a phone at an awkward hour. */
function emailBody(subject: string, detail: Record<string, unknown>, footer: string): string {
  const lines = Object.entries(detail).map(
    ([key, value]) => `${key}: ${format(value)}`,
  );
  return [subject, "", ...lines, "", footer].join("\n");
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
): Promise<AlertDelivery["webhook"]> {
  if (!config.ALERT_WEBHOOK_URL) return "not_configured";
  try {
    const res = await fetch(config.ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject,
        detail,
        service: "worldstreet-prediction-api",
      }),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!res.ok) log.error({ status: res.status }, "alert webhook rejected");
    return res.ok ? "sent" : "failed";
  } catch (err) {
    log.error({ err }, "alert webhook failed");
    return "failed";
  }
}

/* ---------------- the desk's record ---------------- */

/** Keep this firing on its condition's row, reopening it if it had been settled. */
async function recordAlert(
  log: FastifyBaseLogger,
  subject: string,
  detail: Record<string, unknown>,
  opts: AlertOptions,
): Promise<void> {
  if (opts.kind === "support") return;
  const kind = opts.kind ?? "other";
  const now = new Date();
  try {
    await AlertRecord.updateOne(
      // an unkeyed alert is a one-off: a row of its own
      { key: opts.throttleKey ?? `${kind}:${randomUUID()}` },
      {
        $set: {
          kind,
          subject,
          detail,
          lastAt: now,
          status: "open",
          ...(opts.eventId ? { eventId: opts.eventId } : {}),
          ...(opts.marketId ? { marketId: opts.marketId } : {}),
        },
        $setOnInsert: { firstAt: now },
        $inc: { count: 1 },
      },
      { upsert: true },
    );
  } catch (err) {
    // the record is for the desk; never let it stop the alert itself
    log.error({ err, subject }, "could not record alert");
  }
}

/** A condition that fired within this long is still happening. */
const ACTIVE_MS = Math.max(5 * 60_000, config.SETTLEMENT_POLL_SECONDS * 3_000);

export interface AlertView {
  id: string;
  kind: string;
  subject: string;
  detail: Record<string, unknown>;
  eventId: string;
  marketId: string;
  count: number;
  firstAt: string;
  lastAt: string;
  status: "open" | "resolved";
  /** Fired again within the last few minutes — the condition still holds. */
  active: boolean;
  resolvedBy: string;
  resolvedAt: string | null;
  note: string;
}

export async function listAlerts(status: "open" | "resolved" | "all"): Promise<{
  alerts: AlertView[];
  counts: { open: number; resolved: number };
}> {
  const filter = status === "all" ? {} : { status };
  const [rows, counts] = await Promise.all([
    AlertRecord.find(filter).sort({ status: 1, lastAt: -1 }).limit(200).lean(),
    AlertRecord.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
  ]);
  const now = Date.now();
  // live money problems first: open, still happening, risk before the rest
  const rank: Record<string, number> = { risk: 0, settlement: 1, withdrawal: 2, other: 3, test: 4 };
  const alerts: AlertView[] = rows.map((r) => ({
      id: String(r._id),
      kind: r.kind,
      subject: r.subject,
      detail: (r.detail ?? {}) as Record<string, unknown>,
      eventId: r.eventId ?? "",
      marketId: r.marketId ?? "",
      count: r.count ?? 0,
      firstAt: r.firstAt.toISOString(),
      lastAt: r.lastAt.toISOString(),
      status: r.status as "open" | "resolved",
      // only conditions the poller re-checks can be "still happening"
      active: (r.kind === "risk" || r.kind === "settlement") && now - r.lastAt.getTime() < ACTIVE_MS,
      resolvedBy: r.resolvedBy ?? "",
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      note: r.note ?? "",
    }));
  alerts.sort(
    (a, b) =>
      Number(a.status === "resolved") - Number(b.status === "resolved") ||
      Number(b.active) - Number(a.active) ||
      (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3) ||
      b.lastAt.localeCompare(a.lastAt),
  );
  return {
    alerts,
    counts: {
      open: counts.find((c) => c._id === "open")?.n ?? 0,
      resolved: counts.find((c) => c._id === "resolved")?.n ?? 0,
    },
  };
}

/** Mark an alert settled; it opens again on its own if the condition fires again. */
export async function resolveAlert(id: string, actor: string, note: string): Promise<void> {
  const res = await AlertRecord.updateOne(
    { _id: id, status: "open" },
    { $set: { status: "resolved", resolvedBy: actor, resolvedAt: new Date(), note } },
  );
  if (res.matchedCount === 0) {
    if (!(await AlertRecord.exists({ _id: id }))) throw new ApiError(404, "No such alert", "NOT_FOUND");
    throw new ApiError(409, "This alert is already settled", "ALREADY_SETTLED");
  }
}
