import { randomUUID } from "node:crypto";
import { ApiError } from "../errors.js";
import { User } from "../models.js";
import { getFxQuote } from "./fx.js";
import { getBookSettings } from "./settings.js";
import {
  chargeWallet,
  creditWallet,
  getWalletUsdBalance,
  isWalletConfigured,
  type WalletResult,
} from "../wallet.js";
import { WalletCheckRun } from "./models.js";
import { getNairaBalanceKobo } from "./ledger.js";
import { isDuplicateAnswer, isFlagged } from "./withdrawals.js";

/**
 * Is the central wallet really working for us? The desk runs this against
 * one account of its choice: it adds 1 cent to that account's dollar
 * wallet, asks again under the same reference, takes the cent back, and
 * asks that again too — reading the balance after each step, because the
 * wallet saying yes isn't the same as the money moving. These are the calls
 * a withdrawal from Predict and a deposit into Predict make, so a pass
 * means both work and neither can pay or charge twice.
 *
 * It never touches the Predict balance or ledger, and the amount is fixed.
 * It can't test the wallet's own transfers out to a bank: only the wallet
 * can make those. Every run is kept, with who ran it.
 */

const CENT = 1;
/** The wallet may take a moment to show a change. */
const READS = 4;
const READ_GAP_MS = 500;

export type StepStatus = "pass" | "fail" | "skip";
export type StepKey = "reach" | "credit" | "credit_again" | "charge" | "charge_again";
export interface WalletCheckStep {
  key: StepKey;
  label: string;
  status: StepStatus;
  detail: string;
}

export interface WalletCheckView {
  id: string;
  account: string;
  verdict: "working" | "not_working";
  summary: string;
  steps: WalletCheckStep[];
  /** Cents the check left in that dollar wallet; 0 when it put everything back. */
  leftoverMinor: number;
  ranBy: string;
  ranAt: string;
}

const LABELS: Record<StepKey, string> = {
  reach: "Reach the wallet",
  credit: "Add 1 cent (what a withdrawal from Predict does)",
  credit_again: "Ask again with the same reference (must not pay twice)",
  charge: "Take the cent back (what a deposit into Predict does)",
  charge_again: "Ask again with the same reference (must not charge twice)",
};
const ORDER = Object.keys(LABELS) as StepKey[];

const SUMMARIES: Record<StepKey, string> = {
  reach: "Predict can't reach the wallet, so withdrawals and deposits won't work.",
  credit: "Withdrawals from Predict to the dollar wallet aren't working.",
  credit_again:
    "Withdrawals aren't safe yet: asking the wallet again could pay a customer twice or give back the wrong credit.",
  charge: "Withdrawals work, but deposits into Predict aren't working.",
  charge_again: "Deposits aren't safe yet: asking the wallet again could charge a customer twice.",
};

const WORKING =
  "The wallet is working. Withdrawals from Predict and deposits into Predict both moved the money, and repeat requests didn't pay or charge twice.";
const IN_USE = "If this account was being used during the check, run it again.";

const cents = (minor: number) => `$${(minor / 100).toFixed(2)}`;

/** What the wallet said, word for word — what the wallet team needs to see. */
function said(r: WalletResult<unknown>): string {
  return r.ok ? "OK" : `${r.status ?? "no answer"} ${r.code}: "${r.message}"`;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, READ_GAP_MS));

async function findAccount(account: string) {
  const name = account.trim().replace(/^@/, "");
  const user = await User.findOne({ $or: [{ username: name }, { email: name.toLowerCase() }] })
    .collation({ locale: "en", strength: 2 })
    .lean();
  if (!user) throw new ApiError(404, "No account with that username or email", "NOT_FOUND");
  return user;
}

/** One account's money right now, and anything that would get in the way of testing with it. */
export async function readTestAccount(account: string) {
  const user = await findAccount(account);
  const id = user.authUserId;
  const [wallet, balanceKobo, fx, settings, flagged] = await Promise.all([
    getWalletUsdBalance(id),
    getNairaBalanceKobo(id),
    getFxQuote().catch(() => null),
    getBookSettings(),
    isFlagged(id),
  ]);
  return {
    username: user.username,
    suspended: Boolean(user.suspendedAt),
    flagged,
    dollarsMinor: wallet.ok ? wallet.data.balances.USD.availableMinor : null,
    lockedMinor: wallet.ok ? wallet.data.balances.USD.lockedMinor : null,
    walletError: wallet.ok ? "" : said(wallet),
    balanceKobo,
    usdToNgn: fx?.usdToNgn ?? null,
    ngnToUsd: fx?.ngnToUsd ?? null,
    reviewKobo: settings.withdrawalReviewKobo,
  };
}

export async function runWalletCheck(p: { account: string; actor: string }): Promise<WalletCheckView> {
  if (!isWalletConfigured()) {
    throw new ApiError(503, "The wallet isn't set up on the API", "WALLET_UNAVAILABLE");
  }
  const user = await findAccount(p.account);
  if (user.suspendedAt) {
    throw new ApiError(409, "That account is suspended, and a suspended account moves no money", "ACCOUNT_SUSPENDED");
  }
  const id = user.authUserId;

  const steps: WalletCheckStep[] = [];
  const add = (key: StepKey, status: StepStatus, detail: string) =>
    steps.push({ key, label: LABELS[key], status, detail });
  const balance = async () => {
    const r = await getWalletUsdBalance(id);
    return r.ok ? r.data.balances.USD.availableMinor : null;
  };
  /** The balance once it shows what's expected, or the last one seen. */
  const settledAt = async (expected: number) => {
    let seen = await balance();
    for (let i = 1; i < READS && seen !== expected; i++) {
      await pause();
      seen = await balance();
    }
    return seen;
  };
  const moved = (from: number, to: number | null) =>
    to === null ? "and we couldn't read the balance" : `but the balance went from ${cents(from)} to ${cents(to)}`;

  const first = await getWalletUsdBalance(id);
  const start = first.ok ? first.data.balances.USD.availableMinor : null;
  if (start !== null) add("reach", "pass", `Connected. The dollar wallet shows ${cents(start)}.`);
  else add("reach", "fail", `The wallet answered ${said(first)}.`);

  const reference = `wallet-check:${randomUUID()}`;
  if (start !== null) {
    const credit = () =>
      creditWallet({
        clerkUserId: id,
        amountUsdMinor: CENT,
        description: "Wallet check: 1 cent, taken straight back",
        idempotencyKey: reference,
        metadata: { kind: "wallet_check" },
      });
    const added = await credit();
    let creditPassed = false;
    if (added.ok) {
      const after = await settledAt(start + CENT);
      creditPassed = after === start + CENT;
      if (creditPassed) add("credit", "pass", `The wallet said yes, and the balance went up to ${cents(start + CENT)}.`);
      else add("credit", "fail", `The wallet said yes, ${moved(start, after)}. ${IN_USE}`);
    } else if (isDuplicateAnswer(added)) {
      // a brand-new reference can't really be a duplicate
      add(
        "credit",
        "fail",
        `The wallet answered ${said(added)} to a brand-new reference. Predict reads that answer as "already paid", so it would keep the customer's credit while no dollars arrive.`,
      );
    } else if (added.definite) {
      add("credit", "fail", `The wallet refused it, as it would a customer's withdrawal. It answered ${said(added)}.`);
    } else {
      add(
        "credit",
        "fail",
        `No clear answer from the wallet: ${said(added)}. A customer's withdrawal would be held for the desk.`,
      );
    }

    if (creditPassed) {
      const again = await credit();
      await pause();
      const after = await balance();
      if (after !== null && after > start + CENT) {
        add("credit_again", "fail", `It paid twice: the balance went up to ${cents(after)}. The wallet answered ${said(again)}.`);
      } else if (after === null) {
        add("credit_again", "fail", `We couldn't read the balance afterwards. The wallet answered ${said(again)}.`);
      } else if (again.ok || isDuplicateAnswer(again)) {
        add("credit_again", "pass", `It paid once. The wallet answered ${said(again)}, which Predict reads as already paid.`);
      } else if (again.definite) {
        add(
          "credit_again",
          "fail",
          `It paid once, but the wallet answered ${said(again)}. Predict reads that as a refusal and would give the credit back, so a customer could end up with both.`,
        );
      } else {
        add("credit_again", "fail", `It paid once, but the wallet gave no clear answer: ${said(again)}.`);
      }
    }
  }

  // put back whatever the check added, whichever step failed
  const current = start === null ? null : await balance();
  const extra = start === null || current === null ? 0 : current - start;
  if (start !== null && extra > 0 && extra <= CENT * 2) {
    const chargeKey = `${reference}:back`;
    const charge = () =>
      chargeWallet({
        clerkUserId: id,
        amountUsdMinor: extra,
        description: "Wallet check: taking back the test amount",
        idempotencyKey: chargeKey,
        metadata: { kind: "wallet_check" },
      });
    const taken = await charge();
    let chargePassed = false;
    if (taken.ok) {
      const after = await settledAt(start);
      chargePassed = after === start;
      if (chargePassed) add("charge", "pass", `The wallet said yes, and the balance is back to ${cents(start)}.`);
      else add("charge", "fail", `The wallet said yes, ${moved(start, after)}. ${IN_USE}`);
    } else {
      add("charge", "fail", `The wallet answered ${said(taken)}.`);
    }

    if (chargePassed) {
      const again = await charge();
      await pause();
      const after = await balance();
      if (after === start) add("charge_again", "pass", `It charged once. The wallet answered ${said(again)}.`);
      else {
        const now = after === null ? "unreadable" : cents(after);
        add("charge_again", "fail", `The balance is now ${now}, not ${cents(start)}. The wallet answered ${said(again)}. ${IN_USE}`);
      }
    }
  }

  // anything not reached wasn't tested, so it can't count as a pass
  for (const key of ORDER) {
    if (!steps.some((s) => s.key === key)) add(key, "skip", "Not tested, because an earlier step failed.");
  }
  steps.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

  const failed = steps.find((s) => s.status === "fail");
  const working = steps.every((s) => s.status === "pass");
  const final = start === null ? null : await balance();
  const run = await WalletCheckRun.create({
    authUserId: id,
    account: user.username,
    verdict: working ? "working" : "not_working",
    summary: failed ? SUMMARIES[failed.key] : WORKING,
    steps,
    leftoverMinor: start === null || final === null ? 0 : Math.max(final - start, 0),
    ranBy: p.actor,
  });
  return toView(run);
}

function toView(r: {
  _id: unknown;
  account: string;
  verdict: string;
  summary: string;
  steps: unknown;
  leftoverMinor?: number | null;
  ranBy: string;
  createdAt: Date;
}): WalletCheckView {
  return {
    id: String(r._id),
    account: r.account,
    verdict: r.verdict as WalletCheckView["verdict"],
    summary: r.summary,
    steps: (r.steps as WalletCheckStep[]).map(({ key, label, status, detail }) => ({ key, label, status, detail })),
    leftoverMinor: r.leftoverMinor ?? 0,
    ranBy: r.ranBy,
    ranAt: r.createdAt.toISOString(),
  };
}

/** The latest runs, newest first. */
export async function listWalletChecks(limit = 10): Promise<WalletCheckView[]> {
  const rows = await WalletCheckRun.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map(toView);
}
