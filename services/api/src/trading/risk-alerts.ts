import type { FastifyBaseLogger } from "fastify";
import { sendAlert } from "../alerts.js";
import { getProfitAndLoss } from "./pnl.js";
import { getBookRisk } from "./risk.js";
import { getBookSettings } from "./settings.js";

/**
 * Tell the admins when the book is heading for a loss — run after every
 * settlement pass. Alerts go only to the ops recipients configured on the
 * API (ALERT_EMAIL_TO / ALERT_WEBHOOK_URL, see alerts.ts), never to users.
 *
 * Two conditions:
 *  - a market at 70% ("nearing") or 90% ("at") of its loss limit — the
 *    risk desk's watch / critical flags (trading/risk.ts);
 *  - the whole book's worst case reaching the desk's `lossAlertKobo`
 *    setting (0 turns this one off).
 * Each is throttled per condition by sendAlert (ALERT_REPEAT_HOURS), so a
 * market sitting near its limit reminds rather than floods; a market that
 * moves from watch to critical is a new condition and alerts at once.
 */

const naira = (kobo: number) => `₦${Math.round(kobo / 100).toLocaleString("en-US")}`;

export async function checkRiskAlerts(log: FastifyBaseLogger): Promise<number> {
  const [risk, settings] = await Promise.all([getBookRisk(), getBookSettings()]);
  let raised = 0;

  for (const flag of risk.limitFlags) {
    const critical = flag.level === "critical";
    await sendAlert(
      log,
      critical ? "Market at its loss limit" : "Market nearing its loss limit",
      {
        market: `${flag.eventTitle} — ${flag.marketTitle}`,
        marketId: flag.marketId,
        used: `${naira(flag.usedKobo)} of ${naira(flag.limitKobo)} (${Math.round(flag.share * 100)}%)`,
        whatToDo: critical
          ? "New bets that push it past the limit are already being refused. Reprice the market (our own markets) or raise Maximum loss per market in admin Settings."
          : "Reprice the market toward the side with less money on it (our own markets), or raise Maximum loss per market in admin Settings.",
      },
      `risk:limit:${flag.level}:${flag.marketId}`,
    );
    raised += 1;
  }

  const worstLossKobo = -risk.worstCaseKobo;
  if (settings.lossAlertKobo > 0 && worstLossKobo >= settings.lossAlertKobo) {
    const pnl = await getProfitAndLoss();
    await sendAlert(
      log,
      "The book's possible loss has passed the alert line",
      {
        worstCase: `${naira(risk.worstCaseKobo)} if every open market goes against us`,
        alertLine: naira(settings.lossAlertKobo),
        openBets: `${risk.openPositions} bets on ${risk.openMarkets} markets, ${naira(risk.openStakeKobo)} staked`,
        biggestSingleRisk: risk.worstMarket
          ? `${risk.worstMarket.eventTitle} — ${naira(risk.worstMarket.lossKobo)}`
          : "none",
        profitLast7Days: naira(pnl.last7Days.profitKobo),
        whatToDo:
          "Check the risk desk in admin. Reprice our own markets where the money is one-sided, or lower stake limits in Settings.",
      },
      "risk:book-worst",
    );
    raised += 1;
  }

  return raised;
}
