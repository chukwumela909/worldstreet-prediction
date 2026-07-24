/**
 * End-to-end smoke test for the Local (naira) book.
 *
 * Walks the whole money path against a deployed API — set an FX rate,
 * convert dollars to naira, stake on a live Bayse market, prove the
 * idempotency key blocks a double stake, and read the position back out
 * of the portfolio. Every step asserts on the numbers, not just on the
 * status code, so a silently wrong balance fails here rather than in
 * front of a user.
 *
 * It moves REAL money through the central wallet. Point it at staging.
 *
 *   API_BASE=https://prediction-api.example.com \
 *   ADMIN_TOKEN=<clerk session jwt of an admin> \
 *   npx tsx scripts/smoke-local-book.ts --fx 1500 --yes
 *
 * Tokens: sign in to the web app and run `await window.Clerk.session.getToken()`
 * in the browser console. They expire in about a minute, so grab one
 * immediately before running. ADMIN_TOKEN needs Clerk
 * `publicMetadata.role === "admin"`; USER_TOKEN (optional) is the account
 * that trades, defaulting to the admin.
 *
 * Flags:
 *   --fx <rate>      set the USD/NGN mid rate first (skip to use the existing one)
 *   --usd <amount>   dollars to convert, default 5
 *   --stake <naira>  stake per trade, default 100 (the server's floor)
 *   --event <slug>   Bayse event to trade, default: first suitable open one
 *   --settle         also settle the market — see the warning below
 *   --yes            required; without it the script only reports what it would do
 */

import { pathToFileURL } from "node:url";

const RELAY_BASE = "https://relay.bayse.markets";

interface Args {
  fx?: number;
  usd: number;
  stakeNaira: number;
  event?: string;
  settle: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { usd: 5, stakeNaira: 100, settle: false, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    /** The next argv entry, for flags that take one. */
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${flag} needs a value`);
      }
      i += 1;
      return next;
    };
    switch (flag) {
      case "--fx":
        args.fx = Number(value());
        break;
      case "--usd":
        args.usd = Number(value());
        break;
      case "--stake":
        args.stakeNaira = Number(value());
        break;
      case "--event":
        args.event = value();
        break;
      case "--settle":
        args.settle = true;
        break;
      case "--yes":
        args.yes = true;
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }
  if (args.fx !== undefined && !Number.isFinite(args.fx)) {
    throw new Error("--fx needs a number (naira per dollar)");
  }
  if (!Number.isFinite(args.usd) || args.usd <= 0) {
    throw new Error("--usd needs a positive number");
  }
  if (!Number.isFinite(args.stakeNaira) || args.stakeNaira < 100) {
    throw new Error("--stake needs at least 100 (₦100 is the server's floor)");
  }
  return args;
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

let step = 0;
const failures: string[] = [];

function heading(title: string) {
  step += 1;
  console.log(`\n\x1b[1m${step}. ${title}\x1b[0m`);
}

function pass(message: string) {
  console.log(`   \x1b[32m✓\x1b[0m ${message}`);
}

function check(condition: boolean, message: string) {
  if (condition) {
    pass(message);
    return;
  }
  failures.push(message);
  console.log(`   \x1b[31m✗ ${message}\x1b[0m`);
}

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-US")}`;

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

class RequestFailed extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function call<T>(
  base: string,
  path: string,
  token: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

  const raw = await res.text();
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }

  if (!res.ok) {
    const envelope = body as { message?: string; code?: string } | null;
    throw new RequestFailed(
      envelope?.message ?? `${init.method ?? "GET"} ${path} → ${res.status}`,
      res.status,
      envelope?.code ?? null,
      body,
    );
  }
  return body as T;
}

/* ------------------------------------------------------------------ */
/* Bayse market pick                                                   */
/* ------------------------------------------------------------------ */

interface RelayMarket {
  id: string;
  title: string;
  status?: string;
  outcome1Id?: string;
  outcome1Label?: string;
  outcome1Price?: number;
  outcome2Id?: string;
}

interface RelayEvent {
  id: string;
  slug: string;
  title: string;
  status?: string;
  closingDate?: string;
  resolutionDate?: string;
  displayCountdown?: boolean;
  countdownType?: string;
  markets?: RelayMarket[];
}

/** Hours of runway a market needs before it's worth smoke-trading. */
const MIN_RUNWAY_HOURS = 6;

/**
 * An open, non-countdown market with a priceable Yes outcome. Countdown
 * series are excluded deliberately: they close within minutes and the
 * server refuses trades inside the cutoff, which would fail the smoke
 * test for a reason that isn't a bug.
 */
export async function pickMarket(slug?: string): Promise<{
  event: RelayEvent;
  market: RelayMarket;
  outcomeId: string;
  outcomeLabel: string;
  priceKobo: number;
}> {
  const candidates: RelayEvent[] = [];
  if (slug) {
    const res = await fetch(
      `${RELAY_BASE}/v1/pm/events/slug/${encodeURIComponent(slug)}?currency=NGN`,
    );
    if (!res.ok) throw new Error(`Bayse has no open event "${slug}"`);
    candidates.push((await res.json()) as RelayEvent);
  } else {
    const res = await fetch(
      `${RELAY_BASE}/v1/pm/events?page=1&size=20&status=open&currency=NGN`,
    );
    if (!res.ok) throw new Error(`Bayse event list failed (${res.status})`);
    candidates.push(...(((await res.json()) as { events?: RelayEvent[] }).events ?? []));
  }

  const cutoff = Date.now() + MIN_RUNWAY_HOURS * 3600 * 1000;
  for (const event of candidates) {
    if ((event.status ?? "open") !== "open") continue;
    if (event.displayCountdown || event.countdownType) continue;
    const closes = Date.parse(event.closingDate || event.resolutionDate || "");
    if (Number.isNaN(closes) || closes < cutoff) continue;

    for (const market of event.markets ?? []) {
      if ((market.status ?? "open") !== "open") continue;
      if (!market.outcome1Id || !market.outcome2Id) continue;
      const price = market.outcome1Price;
      if (typeof price !== "number") continue;
      const priceKobo = Math.round(price * 10_000);
      if (priceKobo < 1 || priceKobo > 9_999) continue;
      return {
        event,
        market,
        outcomeId: market.outcome1Id,
        outcomeLabel: market.outcome1Label || "Yes",
        priceKobo,
      };
    }
  }
  throw new Error(
    slug
      ? `No tradeable market on "${slug}" (closed, countdown, or unpriced)`
      : "No suitable Bayse market found — pass --event <slug>",
  );
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

interface WalletResponse {
  data: { balanceKobo: number; fx: { usdToNgn: number; mid: number } | null };
}
interface ConvertResponse {
  data: { amountKobo?: number; balanceKobo: number };
}
interface Position {
  id: string;
  outcomeLabel: string;
  stakeKobo: number;
  priceKobo: number;
  shares: number;
  potentialPayoutKobo: number;
  status: string;
}
interface TradeResponse {
  data: { position: Position; balanceKobo?: number; alreadyProcessed?: boolean };
}
interface PortfolioResponse {
  data: { balanceKobo: number; positions: Position[] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = (process.env.API_BASE ?? "").replace(/\/+$/, "");
  const adminToken = process.env.ADMIN_TOKEN ?? "";
  const userToken = process.env.USER_TOKEN || adminToken;

  if (!base) throw new Error("Set API_BASE to the deployed API's origin");
  if (!adminToken) throw new Error("Set ADMIN_TOKEN to an admin's Clerk session JWT");

  const stakeKobo = Math.round(args.stakeNaira * 100);
  const usdMinor = Math.round(args.usd * 100);

  console.log(`\x1b[1mLocal book smoke test\x1b[0m`);
  console.log(`   target   ${base}`);
  console.log(`   converts $${args.usd.toFixed(2)} and stakes ${naira(stakeKobo)}`);
  if (args.fx !== undefined) console.log(`   sets the mid rate to ₦${args.fx}/$`);
  if (args.settle) {
    console.log(
      `   \x1b[33mand settles the market — this pays out EVERY user's position on it\x1b[0m`,
    );
  }
  if (!args.yes) {
    console.log(
      `\n\x1b[33mDry run.\x1b[0m Nothing was sent. Re-run with --yes to move money.`,
    );
    return;
  }

  // 1 — reachable
  heading("Service health");
  const health = await fetch(`${base}/health/ready`);
  check(health.ok, `GET /health/ready → ${health.status}`);
  if (!health.ok) throw new Error("API is not ready; stopping");

  // 2 — FX rate
  heading("FX rate");
  if (args.fx !== undefined) {
    await call(base, "/v1/admin/fx-rate", adminToken, {
      method: "POST",
      body: { usdToNgn: args.fx },
    });
    pass(`Set the mid rate to ₦${args.fx}/$`);
  }
  const wallet = await call<WalletResponse>(base, "/v1/wallet/ngn", userToken);
  check(wallet.data.fx !== null, "A rate is available to price conversions");
  if (!wallet.data.fx) {
    throw new Error("No FX rate set — re-run with --fx <naira per dollar>");
  }
  const rate = wallet.data.fx.usdToNgn;
  pass(`Buy rate ₦${rate.toFixed(2)}/$ (mid ₦${wallet.data.fx.mid.toFixed(2)})`);
  const balanceBeforeConvert = wallet.data.balanceKobo;

  // 3 — fund
  heading("Convert dollars to naira");
  const expectedCredit = Math.floor(usdMinor * rate);
  const convert = await call<ConvertResponse>(
    base,
    "/v1/wallet/ngn/convert",
    userToken,
    {
      method: "POST",
      body: {
        direction: "usd_to_ngn",
        amountMinor: usdMinor,
        idempotencyKey: crypto.randomUUID(),
      },
    },
  );
  check(
    convert.data.balanceKobo === balanceBeforeConvert + expectedCredit,
    `Balance rose by ${naira(expectedCredit)} to ${naira(convert.data.balanceKobo)}`,
  );
  const balanceAfterConvert = convert.data.balanceKobo;
  check(
    balanceAfterConvert >= stakeKobo,
    `Balance covers the ${naira(stakeKobo)} stake`,
  );

  // 4 — pick something to trade
  heading("Pick a Bayse market");
  const pick = await pickMarket(args.event);
  pass(`${pick.event.title}`);
  pass(
    `${pick.outcomeLabel} at ${naira(pick.priceKobo)} per ₦100 share (closes ${
      pick.event.closingDate || pick.event.resolutionDate
    })`,
  );

  // 5 — trade
  heading("Place a trade");
  const tradeKey = crypto.randomUUID();
  const order = {
    eventId: pick.event.id,
    marketId: pick.market.id,
    outcomeId: pick.outcomeId,
    stakeKobo,
    expectedPriceKobo: pick.priceKobo,
    idempotencyKey: tradeKey,
  };
  let trade: TradeResponse;
  try {
    trade = await call<TradeResponse>(base, "/v1/trades", userToken, {
      method: "POST",
      body: order,
    });
  } catch (err) {
    if (err instanceof RequestFailed && err.code === "PRICE_MOVED") {
      // the display price aged out between the pick and the post; the
      // server told us the live one, so re-confirm exactly as the UI does
      const fresh = (err.body as { details?: { freshPriceKobo?: number } })?.details
        ?.freshPriceKobo;
      check(typeof fresh === "number", "PRICE_MOVED carried a fresh price to confirm");
      if (typeof fresh !== "number") throw err;
      pass(`Price moved to ${naira(fresh)} — re-confirming`);
      trade = await call<TradeResponse>(base, "/v1/trades", userToken, {
        method: "POST",
        body: { ...order, expectedPriceKobo: fresh },
      });
    } else {
      throw err;
    }
  }
  const position = trade.data.position;
  const expectedShares = stakeKobo / position.priceKobo;
  check(position.status === "open", `Position opened (${position.id})`);
  check(
    Math.abs(position.shares - expectedShares) < 0.0001,
    `${position.shares.toFixed(2)} shares at ${naira(position.priceKobo)}`,
  );
  check(
    position.potentialPayoutKobo === Math.floor(expectedShares * 10_000),
    `Pays ${naira(position.potentialPayoutKobo)} if ${position.outcomeLabel} wins`,
  );
  check(
    trade.data.balanceKobo === balanceAfterConvert - stakeKobo,
    `Stake debited — balance now ${naira(trade.data.balanceKobo ?? -1)}`,
  );

  // 6 — the same order twice must not stake twice
  heading("Retry the same order");
  const retry = await call<TradeResponse>(base, "/v1/trades", userToken, {
    method: "POST",
    body: order,
  });
  check(retry.data.alreadyProcessed === true, "Reported as already processed");
  check(
    retry.data.position.id === position.id,
    "Returned the original position, no second stake",
  );

  // 7 — read it back
  heading("Portfolio");
  const portfolio = await call<PortfolioResponse>(base, "/v1/portfolio", userToken);
  const found = portfolio.data.positions.find((p) => p.id === position.id);
  check(Boolean(found), "The position appears in the portfolio");
  check(
    portfolio.data.balanceKobo === balanceAfterConvert - stakeKobo,
    `Portfolio balance agrees: ${naira(portfolio.data.balanceKobo)}`,
  );

  // 8 — settlement (opt-in: it pays out everyone holding this market)
  if (args.settle) {
    heading("Settle the market");
    await call(base, "/v1/admin/settle", adminToken, {
      method: "POST",
      body: {
        eventId: pick.event.id,
        marketId: pick.market.id,
        winningOutcomeId: pick.outcomeId,
      },
    });
    const settled = await call<PortfolioResponse>(base, "/v1/portfolio", userToken);
    const row = settled.data.positions.find((p) => p.id === position.id);
    check(row?.status === "won", `Position settled as ${row?.status ?? "missing"}`);
    check(
      settled.data.balanceKobo ===
        balanceAfterConvert - stakeKobo + position.potentialPayoutKobo,
      `Payout landed — balance ${naira(settled.data.balanceKobo)}`,
    );
  } else {
    console.log(
      `\n   Skipped settlement. To finish the loop by hand:\n` +
        `   POST ${base}/v1/admin/settle ` +
        `{"eventId":"${pick.event.id}","marketId":"${pick.market.id}",` +
        `"winningOutcomeId":"${pick.outcomeId}"}`,
    );
  }

  console.log(
    failures.length === 0
      ? `\n\x1b[32m\x1b[1mAll checks passed.\x1b[0m The Local money path works end to end.\n`
      : `\n\x1b[31m\x1b[1m${failures.length} check(s) failed:\x1b[0m\n   - ${failures.join(
          "\n   - ",
        )}\n`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

// Only run when invoked as a script — importing it (to exercise the
// market picker on its own, say) must not fire money-moving requests.
const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (import.meta.url === entrypoint) run();

function run() {
  main().catch((err: unknown) => {
    const detail =
      err instanceof RequestFailed
        ? `${err.message} (HTTP ${err.status}${err.code ? `, ${err.code}` : ""})`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error(`\n\x1b[31m\x1b[1mSmoke test stopped:\x1b[0m ${detail}\n`);
    process.exitCode = 1;
  });
}
