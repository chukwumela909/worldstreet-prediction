import type { FastifyBaseLogger } from "fastify";
import { sendAlert } from "../alerts.js";
import { getAbuseWatch } from "./abuse.js";

/**
 * Abuse watch, run on its own: once an hour the settlement worker scans
 * the last week (trading/abuse.ts) and alerts the admins about anyone
 * newly beating the odds, buying near-certain sides, moving in a pair, or
 * whose balance is off its ledger. Each person is one alert condition
 * (`abuse:<scan>:<id>`): it lands on the Alerts tab, is emailed at most
 * once per ALERT_REPEAT_HOURS, and — while it's open — puts that
 * person's withdrawals on hold for an admin's approval
 * (isFlagged, trading/withdrawals.ts). Settling the alert lifts the hold; someone
 * still matching fires it again on the next scan. Suspended accounts
 * are left out: they're already dealt with.
 */

const EVERY_MS = 60 * 60_000;
const SCAN_DAYS = 7;
let lastRun = 0;

const FOOTER = "Review them in the admin desk: Admin → Abuse watch.";
const naira = (kobo: number) =>
  `${kobo < 0 ? "−" : ""}₦${Math.round(Math.abs(kobo) / 100).toLocaleString("en-US")}`;

/** Run the scans if an hour has passed since the last; how many alerts it raised. */
export async function checkAbuseAlerts(log: FastifyBaseLogger, opts: { force?: boolean } = {}): Promise<number> {
  const now = Date.now();
  if (!opts.force && now - lastRun < EVERY_MS) return 0;
  lastRun = now;

  const watch = await getAbuseWatch(SCAN_DAYS, { wallets: false });
  let raised = 0;
  const alert = async (
    key: string,
    ids: string[],
    subject: string,
    detail: Record<string, unknown>,
    kind: "abuse" | "fault" = "abuse",
  ) => {
    await sendAlert(log, subject, detail, {
      throttleKey: key,
      kind,
      authUserIds: ids,
      footer: FOOTER,
    });
    raised += 1;
  };

  for (const r of watch.beatingOdds) {
    if (r.suspendedAt) continue;
    await alert(`abuse:odds:${r.authUserId}`, [r.authUserId], `Winning more than the odds allow: @${r.username}`, {
      customer: `@${r.username}${r.email ? ` (${r.email})` : ""}`,
      record: `Won ${r.won} of ${r.bets} bets in the last ${SCAN_DAYS} days — the prices said about ${r.expectedWins}`,
      theirProfit: naira(r.profitKobo),
      mostlyOn: r.markets.join(" · "),
      whatToDo: "Their withdrawals wait for approval while this is open. Check their bets; suspend them if they're betting on results already known, or mark this settled if they're fine.",
    });
  }
  for (const r of watch.nearCertain) {
    if (r.suspendedAt) continue;
    await alert(`abuse:near:${r.authUserId}`, [r.authUserId], `Buying near-certain sides: @${r.username}`, {
      customer: `@${r.username}${r.email ? ` (${r.email})` : ""}`,
      record: `${r.bets} bets at ₦90+ (avg ₦${(r.avgPriceKobo / 100).toFixed(2)}), won ${r.won}`,
      theirProfit: naira(r.profitKobo),
      mostlyOn: r.markets.join(" · "),
      whatToDo: "Their withdrawals wait for approval while this is open. Suspend them, or reverse those markets from Recovery, or mark this settled if they're fine.",
    });
  }
  for (const t of watch.twins) {
    if (t.a.suspendedAt && t.b.suspendedAt) continue;
    await alert(
      `abuse:twins:${t.a.authUserId}|${t.b.authUserId}`,
      [t.a.authUserId, t.b.authUserId],
      `Accounts moving in a pair: @${t.a.username} and @${t.b.username}`,
      {
        accounts: `@${t.a.username} (${t.a.email}) · @${t.b.username} (${t.b.email})`,
        record: `Backed the same side of ${t.sharedMarkets} markets within two minutes`,
        mostlyOn: t.examples.join(" · "),
        whatToDo: "Both accounts' withdrawals wait for approval while this is open. Check whether it's one person; suspend both if so.",
      },
    );
  }
  // our fault, not the customer's — filed apart from abuse, but it still
  // holds their withdrawals until someone has looked
  for (const g of watch.ledgerGaps) {
    await alert(
      `abuse:ledger:${g.authUserId}`,
      [g.authUserId],
      `Balance doesn't match the ledger: @${g.username}`,
      {
        customer: `@${g.username}${g.email ? ` (${g.email})` : ""}`,
        gap: `${naira(g.gapKobo)} more on the balance than its ledger explains`,
        whatToDo: "Money moved outside the ledger — this should never happen, and it isn't the customer's doing. Their withdrawals wait for approval; tell the developers.",
      },
      "fault",
    );
  }
  return raised;
}
