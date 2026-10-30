import { ApiError } from "../errors.js";
import { User } from "../models.js";
import { getWalletUsdBalance } from "../wallet.js";
import { LedgerEntry, NairaAccount, WithdrawalCheck } from "./models.js";

/**
 * Who had debt written off: read straight from the ledger's debt_writeoff
 * entries, the record of each balance set back to zero, so the list and its
 * totals are exact. Beside each person, how money moved between Predict and
 * their WorldStreet dollar wallet, and what they hold now — asked, never
 * charged. Read-only.
 *
 * We only see Predict's side. The wallet's own history (where a balance came
 * from, what left it) is the wallet team's, so "from Predict" here is always
 * "at most": a wallet's dollars could have come from elsewhere.
 */

export interface WrittenOffRow {
  authUserId: string;
  username: string;
  displayName: string;
  email: string;
  writtenOffKobo: number;
  /** How many separate write-offs that adds up from. */
  times: number;
  firstAt: string;
  lastAt: string;
  /** Who cleared it, from the latest write-off. */
  by: string;
  balanceKobo: number;
  /** In their dollar wallet, cents; null when the wallet couldn't say. */
  walletUsdMinor: number | null;
  walletLockedMinor: number | null;
  suspendedAt: string | null;
  /** All time: brought in from the dollar wallet. */
  addedKobo: number;
  addedUsdMinor: number;
  /** All time: really sent to the dollar wallet — not failed, not still waiting. */
  sentKobo: number;
  sentUsdMinor: number;
  /** The part of that sent before their first write-off. */
  sentBeforeKobo: number;
  sentBeforeUsdMinor: number;
  /** Withdrawals still waiting, not yet sent. */
  waitingKobo: number;
  /** Dollars sent less dollars brought in; above zero, Predict gave their wallet more than it took. */
  netUsdMinor: number;
  /** The most of their wallet that could be Predict's money: the lower of the net and what it holds. */
  fromPredictAtMostUsdMinor: number | null;
}

/** One step of a customer's money flow, with runs of the same thing rolled into one. */
export interface FlowStep {
  kind: "added" | "betting" | "sent" | "failed" | "waiting" | "reversed" | "written_off" | "other";
  at: string;
  until: string;
  /** How many entries it rolls up: bets placed for betting, attempts for failed. */
  count: number;
  /** Change to the Predict balance; 0 for a failed withdrawal, since it came back. */
  amountKobo: number;
  usdMinor: number | null;
  /** The Predict balance afterwards. */
  balanceAfterKobo: number;
}

interface Entry {
  authUserId: string;
  type: string;
  amountKobo: number;
  balanceAfterKobo: number;
  refKey: string;
  description: string;
  metadata?: unknown;
  createdAt: Date;
}

const WAITING = ["unconfirmed", "review", "checking"] as const;
const isReturn = (e: Entry) => e.type === "refund" && /^convert:.*:reversal$/.test(e.refKey);

/** A conversion's dollars: recorded on it, or worked out from the rate in an older entry's description. */
function dollars(e: Entry): number {
  const recorded = (e.metadata as { amountUsdMinor?: unknown } | null | undefined)?.amountUsdMinor;
  if (typeof recorded === "number") return recorded;
  const rate = /@ ₦([\d.,]+)\/\$/.exec(e.description)?.[1];
  const parsed = rate ? Number(rate.replace(/,/g, "")) : 0;
  return parsed > 0 ? Math.floor(Math.abs(e.amountKobo) / parsed) : 0;
}

export async function getWrittenOff(): Promise<{ customers: number; totalKobo: number; rows: WrittenOffRow[] }> {
  const writeOffs = (await LedgerEntry.find({ type: "debt_writeoff" }).sort({ createdAt: 1 }).lean()) as unknown as Entry[];
  const ids = [...new Set(writeOffs.map((e) => e.authUserId))];
  const [users, accounts, wallets, movements, waiting] = await Promise.all([
    User.find(
      { authUserId: { $in: ids } },
      { authUserId: 1, username: 1, displayName: 1, email: 1, suspendedAt: 1 },
    ).lean(),
    NairaAccount.find({ authUserId: { $in: ids } }, { authUserId: 1, balanceKobo: 1 }).lean(),
    Promise.all(ids.map(async (id) => [id, await getWalletUsdBalance(id)] as const)),
    LedgerEntry.find({ authUserId: { $in: ids }, type: { $in: ["conversion_in", "conversion_out", "refund"] } }).lean() as unknown as Promise<Entry[]>,
    WithdrawalCheck.find({ authUserId: { $in: ids }, status: { $in: WAITING } }, { refKey: 1 }).lean(),
  ]);
  const userById = new Map(users.map((u) => [u.authUserId, u]));
  const balanceById = new Map(accounts.map((a) => [a.authUserId, a.balanceKobo]));
  const walletById = new Map(wallets);
  const waitingKeys = new Set(waiting.map((w) => w.refKey));
  const returned = new Set(movements.filter(isReturn).map((e) => e.refKey.replace(/:reversal$/, "")));

  const rows = ids.map((id): WrittenOffRow => {
    const own = writeOffs.filter((e) => e.authUserId === id);
    const first = own[0]!;
    const last = own[own.length - 1]!;
    const user = userById.get(id);
    const wallet = walletById.get(id);
    const usd = wallet?.ok ? wallet.data.balances.USD : null;
    const actor = (last.metadata as { actor?: unknown } | null | undefined)?.actor;

    const mine = movements.filter((e) => e.authUserId === id);
    const added = mine.filter((e) => e.type === "conversion_in");
    const out = mine.filter((e) => e.type === "conversion_out" && !returned.has(e.refKey));
    const sent = out.filter((e) => !waitingKeys.has(e.refKey));
    const before = sent.filter((e) => e.createdAt < first.createdAt);
    const sumKobo = (list: Entry[]) => list.reduce((sum, e) => sum + Math.abs(e.amountKobo), 0);
    const sumUsd = (list: Entry[]) => list.reduce((sum, e) => sum + dollars(e), 0);
    const netUsdMinor = sumUsd(sent) - sumUsd(added);

    return {
      authUserId: id,
      username: user?.username ?? "",
      displayName: user?.displayName ?? "",
      email: user?.email ?? "",
      writtenOffKobo: own.reduce((sum, e) => sum + e.amountKobo, 0),
      times: own.length,
      firstAt: first.createdAt.toISOString(),
      lastAt: last.createdAt.toISOString(),
      by: typeof actor === "string" ? actor : "",
      balanceKobo: balanceById.get(id) ?? 0,
      walletUsdMinor: usd ? usd.availableMinor : null,
      walletLockedMinor: usd ? usd.lockedMinor : null,
      suspendedAt: user?.suspendedAt?.toISOString() ?? null,
      addedKobo: sumKobo(added),
      addedUsdMinor: sumUsd(added),
      sentKobo: sumKobo(sent),
      sentUsdMinor: sumUsd(sent),
      sentBeforeKobo: sumKobo(before),
      sentBeforeUsdMinor: sumUsd(before),
      waitingKobo: sumKobo(out.filter((e) => waitingKeys.has(e.refKey))),
      netUsdMinor,
      fromPredictAtMostUsdMinor: usd ? Math.max(Math.min(netUsdMinor, usd.availableMinor), 0) : null,
    };
  });
  rows.sort((a, b) => b.writtenOffKobo - a.writtenOffKobo);
  return {
    customers: rows.length,
    totalKobo: rows.reduce((sum, r) => sum + r.writtenOffKobo, 0),
    rows,
  };
}

/** One customer's whole money story on Predict, oldest first. */
export async function getMoneyFlow(authUserId: string): Promise<{ steps: FlowStep[] }> {
  if (!(await User.exists({ authUserId }))) throw new ApiError(404, "No such customer", "USER_NOT_FOUND");
  const [entries, waiting] = await Promise.all([
    LedgerEntry.find({ authUserId }).sort({ createdAt: 1, _id: 1 }).lean() as unknown as Promise<Entry[]>,
    WithdrawalCheck.find({ authUserId, status: { $in: WAITING } }, { refKey: 1 }).lean(),
  ]);
  const waitingKeys = new Set(waiting.map((w) => w.refKey));
  const returned = new Set(entries.filter(isReturn).map((e) => e.refKey.replace(/:reversal$/, "")));

  const steps: FlowStep[] = [];
  const add = (kind: FlowStep["kind"], e: Entry, opts: { counts?: boolean; moves?: boolean; usd?: boolean; rolls?: boolean }) => {
    const prev = steps[steps.length - 1];
    const amountKobo = opts.moves === false ? 0 : e.amountKobo;
    const usdMinor = opts.usd ? dollars(e) : null;
    if (opts.rolls && prev?.kind === kind) {
      prev.until = e.createdAt.toISOString();
      prev.amountKobo += amountKobo;
      prev.count += opts.counts === false ? 0 : 1;
      prev.balanceAfterKobo = e.balanceAfterKobo;
      return;
    }
    steps.push({
      kind,
      at: e.createdAt.toISOString(),
      until: e.createdAt.toISOString(),
      count: opts.counts === false ? 0 : 1,
      amountKobo,
      usdMinor,
      balanceAfterKobo: e.balanceAfterKobo,
    });
  };

  for (const e of entries) {
    if (isReturn(e)) {
      // the other half of a failed withdrawal, already shown as one step
      const prev = steps[steps.length - 1];
      if (prev?.kind === "failed") prev.balanceAfterKobo = e.balanceAfterKobo;
    } else if (e.type === "conversion_in") add("added", e, { usd: true });
    else if (e.type === "conversion_out") {
      if (returned.has(e.refKey)) add("failed", e, { moves: false, rolls: true });
      else if (waitingKeys.has(e.refKey)) add("waiting", e, { usd: true });
      else add("sent", e, { usd: true });
    } else if (e.type === "trade_stake") add("betting", e, { rolls: true });
    else if (e.type === "payout" || e.type === "refund") add("betting", e, { counts: false, rolls: true });
    else if (e.type === "reversal") add("reversed", e, { rolls: true });
    else if (e.type === "debt_writeoff") add("written_off", e, {});
    else add("other", e, { rolls: true });
  }
  return { steps };
}
