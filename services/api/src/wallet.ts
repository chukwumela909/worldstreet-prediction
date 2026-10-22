import { config } from "./config.js";

/**
 * Server-to-server client for the central WorldStreet wallet service.
 * Auth is the service-principal token (X-Wallet-Service-Token) — it can act
 * for any user, which is exactly why it lives HERE and never in a client app.
 * All amounts are USD in integer minor units (cents). Same integration shape
 * as xtreme-livestream and worldshop-server.
 */

/**
 * A failure is `definite` when the wallet answered and said no (a 4xx):
 * nothing happened on its side. Anything else — no answer in time, a
 * network error, a 5xx or a body that isn't the wallet's — leaves it
 * unknown whether the request went through, and money must not be put
 * back on a guess (trading/withdrawals.ts).
 */
export type WalletResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; definite: boolean; status?: number };

export type WalletCharge = {
  id: string;
  amountMinor: number;
  currency: string;
  description: string;
  createdAt: string;
};

export type WalletCurrencyBalance = {
  availableMinor: number;
  lockedMinor: number;
  available: number;
  locked: number;
};

export function isWalletConfigured(): boolean {
  return Boolean(config.WALLET_API_URL && config.WALLET_SERVICE_TOKEN);
}

/**
 * A trade holds an HTTP connection open while this runs. A wallet that
 * hangs rather than refusing would hold it indefinitely — the user's
 * Buy button spins with no result and no error. Failing at a deadline
 * gives them UNREACHABLE, which every caller already handles.
 */
const WALLET_TIMEOUT_MS = 15_000;

async function walletCall<T>(
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; idempotencyKey?: string } = {},
): Promise<WalletResult<T>> {
  if (!isWalletConfigured()) {
    return { ok: false, code: "NOT_CONFIGURED", message: "Wallet is not configured", definite: true };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Wallet-Service-Token": config.WALLET_SERVICE_TOKEN,
  };
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  let json: (Record<string, unknown> & { ok?: boolean; code?: string; error?: string }) | null;
  let status: number;
  try {
    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(WALLET_TIMEOUT_MS),
    };
    if (opts.body != null) init.body = JSON.stringify(opts.body);
    const res = await fetch(`${config.WALLET_API_URL.replace(/\/+$/, "")}${path}`, init);
    status = res.status;
    json = (await res.json().catch(() => null)) as typeof json;
  } catch (err) {
    return { ok: false, code: "UNREACHABLE", message: (err as Error).message, definite: false };
  }

  if (!json || json.ok !== true) {
    return {
      ok: false,
      code: json?.code || "UNKNOWN",
      message: json?.error || "Wallet service request failed",
      // only the wallet's own refusal says nothing happened
      definite: Boolean(json) && status >= 400 && status < 500,
      status,
    };
  }
  return { ok: true, data: json as unknown as T };
}

/**
 * The user's spendable USD balance — what they can actually trade with.
 * `availableMinor` excludes funds locked by pending holds.
 */
export function getWalletUsdBalance(
  clerkUserId: string,
): Promise<WalletResult<{ balances: { USD: WalletCurrencyBalance } }>> {
  return walletCall("GET", `/v1/wallet/${encodeURIComponent(clerkUserId)}/balances`);
}

/**
 * Instant debit of the user's USD balance (e.g. buying into a market).
 * Idempotent per idempotencyKey; the wallet dedupes on its side too.
 */
export function chargeWallet(params: {
  clerkUserId: string;
  amountUsdMinor: number;
  description: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): Promise<WalletResult<{ charge: WalletCharge }>> {
  return walletCall("POST", `/v1/wallet/${encodeURIComponent(params.clerkUserId)}/charges`, {
    idempotencyKey: params.idempotencyKey,
    body: {
      amountMinor: params.amountUsdMinor,
      currency: "USD",
      description: params.description,
      metadata: params.metadata ?? {},
    },
  });
}

/**
 * Credit the user's USD balance (e.g. sell proceeds or a winning payout).
 * Idempotent per idempotencyKey.
 */
export function creditWallet(params: {
  clerkUserId: string;
  amountUsdMinor: number;
  description: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): Promise<WalletResult<unknown>> {
  return walletCall("POST", `/v1/wallet/${encodeURIComponent(params.clerkUserId)}/credits`, {
    idempotencyKey: params.idempotencyKey,
    body: {
      amountMinor: params.amountUsdMinor,
      currency: "USD",
      // the wallet requires a reference on platform credits and dedupes on it
      reference: params.idempotencyKey,
      description: params.description,
      metadata: params.metadata ?? {},
    },
  });
}

/** Compensation path: refund a charge when our own bookkeeping fails after it. */
export function refundWalletCharge(params: {
  clerkUserId: string;
  chargeId: string;
  reason: string;
}): Promise<WalletResult<unknown>> {
  return walletCall(
    "POST",
    `/v1/wallet/${encodeURIComponent(params.clerkUserId)}/charges/${encodeURIComponent(params.chargeId)}/refund`,
    { body: { reason: params.reason } },
  );
}
