"use client";

import { useState } from "react";
import {
  BellAlertIcon as Urgent,
  ChatBubbleLeftRightIcon as Support,
  CheckCircleIcon as Check,
  EnvelopeIcon as Inbox,
  ExclamationTriangleIcon as Warn,
  LinkIcon as LinkIcon,
} from "@heroicons/react/24/outline";
import {
  fetchAlertRoutes,
  sendTestAlert,
  useAdminResource,
  type AlertRoute,
  type AlertTestResult,
} from "@/lib/admin-api";
import { isApiConfigured } from "@/lib/api-client";
import { BTN_GHOST, BTN_PRIMARY, Chip, PageHeader } from "@/components/admin/kit";
import { blockedNotice } from "@/components/admin/watch-parts";

/**
 * Alert test: one card per way an alert travels, each sent through the
 * real path, so the set-up is proved before an incident needs it.
 *
 *  - Urgent: the inbox and the paging list (ALERT_URGENT_EMAIL_TO — a
 *    PagerDuty address calls or texts whoever is on duty).
 *  - Regular: the alert inbox (ALERT_EMAIL_TO).
 *  - Support: the support list (SUPPORT_EMAIL_TO, else the alert inbox).
 *
 * Above them, what every email depends on: email itself, the links back
 * to the desk (SITE_URL) and the optional webhook. Each card says which
 * setting to add when its route goes nowhere.
 */

const CARDS: {
  route: AlertRoute;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  what: string;
  check: string;
}[] = [
  {
    route: "urgent",
    title: "Urgent alert",
    icon: Urgent,
    what: "Money at risk right now: a market at its loss limit, bets being refused, a fault, a withdrawal the wallet never confirmed. Goes to the inbox and pages whoever is on duty.",
    check: "Your phone should ring or get a text from PagerDuty within a minute, and the email should arrive tagged URGENT.",
  },
  {
    route: "regular",
    title: "Regular alert",
    icon: Inbox,
    what: "Everything that can wait for working hours: a market to settle, a suspicious customer, a market nearing its limit. Inbox only — never pages.",
    check: "An email tagged Test should arrive, with a link that opens this alert on Today.",
  },
  {
    route: "support",
    title: "Support notice",
    icon: Support,
    what: "A customer opened a request or wrote back. Goes to the support list only, so a question never wakes anyone.",
    check: "An email tagged Support should arrive, with a link to the support inbox.",
  },
];

export function AlertTestDesk() {
  const configured = isApiConfigured();
  const resource = useAdminResource(fetchAlertRoutes, configured);
  const blocked = blockedNotice(configured, resource.errorCode ?? null);
  if (blocked) return blocked;
  const routes = resource.data;

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Tools"
        title="Alert test"
        lede="Send a test down each route and check it lands where it should — before a real problem needs it. Tests are marked as tests and need no action."
      />

      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        <Setup
          label="Email"
          ok={routes?.emailConfigured}
          good="Sending through Resend"
          bad="Add RESEND_API_KEY and ALERT_EMAIL_FROM on the API"
        />
        <Setup
          label="Links to the desk"
          ok={routes?.linksConfigured}
          good={routes?.exampleLink ?? "Set"}
          bad="Add SITE_URL on the API so emails link straight to the request or alert"
          icon={<LinkIcon className="size-4" />}
        />
        <Setup
          label="Webhook"
          ok={routes?.webhookConfigured}
          good="Also posting to ALERT_WEBHOOK_URL"
          bad="Optional — not set"
          optional
        />
      </dl>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {CARDS.map((card) => {
          const r = routes?.routes;
          const count = !r ? null : card.route === "urgent" ? r.urgent.recipients : r[card.route].recipients;
          const hint = !r
            ? null
            : card.route === "urgent" && r.urgent.pagingList === 0
              ? "No paging list — add ALERT_URGENT_EMAIL_TO (your PagerDuty email address) so urgent alerts call or text someone."
              : card.route === "support" && !r.support.ownList
                ? "No support list of its own — add SUPPORT_EMAIL_TO, or questions keep landing in the alert inbox."
                : count === 0
                  ? "Goes nowhere — add ALERT_EMAIL_TO on the API."
                  : null;
          return <RouteCard key={card.route} {...card} count={count} hint={hint} canSend={Boolean(routes?.emailConfigured)} />;
        })}
      </div>
    </div>
  );
}

function Setup({
  label,
  ok,
  good,
  bad,
  icon,
  optional = false,
}: {
  label: string;
  ok: boolean | undefined;
  good: string;
  bad: string;
  icon?: React.ReactNode;
  optional?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <dt className="flex items-center gap-1.5 text-sm text-secondary">
        {icon}
        {label}
      </dt>
      <dd className="mt-1.5 flex items-start gap-2 text-sm">
        {ok === undefined ? (
          <span className="h-5 w-32 animate-pulse rounded-sm bg-element-2" />
        ) : ok ? (
          <>
            <Check className="mt-0.5 size-4 shrink-0 text-yes" />
            <span className="min-w-0 break-all">{good}</span>
          </>
        ) : (
          <>
            {optional ? null : <Warn className="mt-0.5 size-4 shrink-0 text-warning" />}
            <span className={optional ? "text-tertiary" : "text-warning"}>{bad}</span>
          </>
        )}
      </dd>
    </div>
  );
}

function RouteCard({
  route,
  title,
  icon: Icon,
  what,
  check,
  count,
  hint,
  canSend,
}: {
  route: AlertRoute;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  what: string;
  check: string;
  count: number | null;
  hint: string | null;
  canSend: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AlertTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      setResult(await sendTestAlert(route));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't send it");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="flex flex-col rounded-xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex size-9 items-center justify-center rounded-md bg-element-2 text-secondary">
          <Icon className="size-5" />
        </span>
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="flex-1" />
        {count !== null && (
          <Chip tone={count > 0 ? "neutral" : "warning"}>
            {count} address{count === 1 ? "" : "es"}
          </Chip>
        )}
      </div>
      <p className="mt-3 text-sm text-secondary">{what}</p>
      {hint && <p className="mt-3 rounded-md bg-warning-tint px-3 py-2 text-[13px] font-medium text-warning">{hint}</p>}

      <div className="mt-auto pt-4">
        <button
          type="button"
          onClick={() => void send()}
          disabled={pending || !canSend || count === 0}
          className={route === "urgent" ? BTN_PRIMARY : BTN_GHOST}
        >
          {pending ? "Sending…" : "Send a test"}
        </button>
        {result && (
          <div className="mt-3 text-[13px]" role="status">
            <p className={`font-semibold ${result.email === "sent" ? "text-yes" : "text-no"}`}>{describe(result)}</p>
            {result.email === "sent" && <p className="mt-1 text-secondary">{check}</p>}
          </div>
        )}
        {error && <p className="mt-3 text-[13px] font-semibold text-no">{error}</p>}
      </div>
    </section>
  );
}

function describe(r: AlertTestResult): string {
  if (r.email === "sent") {
    const hook = r.webhook === "sent" ? " and the webhook" : "";
    return `Sent to ${r.recipients} address${r.recipients === 1 ? "" : "es"}${hook}.`;
  }
  if (r.email === "not_configured") return "Not sent — this route has no email set up on the API.";
  return `Resend refused it — ${r.emailError ?? "see the API logs"}`;
}
