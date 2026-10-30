import { User } from "../models.js";
import { getWalletUsdBalance } from "../wallet.js";
import { LedgerEntry, NairaAccount } from "./models.js";

/**
 * Who had debt written off: read straight from the ledger's debt_writeoff
 * entries, the record of each balance set back to zero, so the list and its
 * totals are exact. Beside each person, what they hold now, on Predict and in
 * their WorldStreet dollar wallet — asked, never charged. Read-only.
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
}

export async function getWrittenOff(): Promise<{ customers: number; totalKobo: number; rows: WrittenOffRow[] }> {
  const entries = await LedgerEntry.find(
    { type: "debt_writeoff" },
    { authUserId: 1, amountKobo: 1, metadata: 1, createdAt: 1 },
  )
    .sort({ createdAt: 1 })
    .lean();
  const ids = [...new Set(entries.map((e) => e.authUserId))];
  const [users, accounts, wallets] = await Promise.all([
    User.find(
      { authUserId: { $in: ids } },
      { authUserId: 1, username: 1, displayName: 1, email: 1, suspendedAt: 1 },
    ).lean(),
    NairaAccount.find({ authUserId: { $in: ids } }, { authUserId: 1, balanceKobo: 1 }).lean(),
    Promise.all(ids.map(async (id) => [id, await getWalletUsdBalance(id)] as const)),
  ]);
  const userById = new Map(users.map((u) => [u.authUserId, u]));
  const balanceById = new Map(accounts.map((a) => [a.authUserId, a.balanceKobo]));
  const walletById = new Map(wallets);

  const rows = ids.map((id): WrittenOffRow => {
    const own = entries.filter((e) => e.authUserId === id);
    const user = userById.get(id);
    const wallet = walletById.get(id);
    const usd = wallet?.ok ? wallet.data.balances.USD : null;
    const actor = (own[own.length - 1]?.metadata as { actor?: unknown } | undefined)?.actor;
    return {
      authUserId: id,
      username: user?.username ?? "",
      displayName: user?.displayName ?? "",
      email: user?.email ?? "",
      writtenOffKobo: own.reduce((sum, e) => sum + e.amountKobo, 0),
      times: own.length,
      firstAt: (own[0] as unknown as { createdAt: Date }).createdAt.toISOString(),
      lastAt: (own[own.length - 1] as unknown as { createdAt: Date }).createdAt.toISOString(),
      by: typeof actor === "string" ? actor : "",
      balanceKobo: balanceById.get(id) ?? 0,
      walletUsdMinor: usd ? usd.availableMinor : null,
      walletLockedMinor: usd ? usd.lockedMinor : null,
      suspendedAt: user?.suspendedAt?.toISOString() ?? null,
    };
  });
  rows.sort((a, b) => b.writtenOffKobo - a.writtenOffKobo);
  return {
    customers: rows.length,
    totalKobo: rows.reduce((sum, r) => sum + r.writtenOffKobo, 0),
    rows,
  };
}
