# Deploying the prediction backend on Coolify

The backend (`services/api`) is a standalone Fastify service that plugs into
the two central WorldStreet services: Clerk auth on `worldstreetgold.com` and
the wallet service. It deploys from this repo with its own Dockerfile.

## 0. Prerequisites

- The service code is committed and pushed to the branch Coolify tracks
  (`main`). Coolify builds from git, not from your working copy.
- You have the central Clerk keys (same application as the other platforms —
  copy from `xtreme-livestream/services/api`'s env).
- You know the deployed wallet service URL and can edit its env.
- A MongoDB connection string for this platform's own data.

## 1. Create the Coolify resource

New resource → **Private/Public Repository** → this repo.

| Setting            | Value                                            |
| ------------------ | ------------------------------------------------ |
| Branch             | `main`                                           |
| Build Pack         | **Dockerfile**                                   |
| Base Directory     | `/services/api`                                  |
| Dockerfile Location| `/Dockerfile` (joined onto the base directory)   |
| Ports Exposes      | `3001`                                           |
| Health Check Path  | `/health/ready`                                  |
| Domain             | e.g. `https://prediction-api.worldstreetgold.com`|

Base Directory matters: it makes `services/api` the Docker build context, which
is what the Dockerfile expects (it copies `package.json`, `src/`, `tsconfig.json`
from the context root). Dockerfile Location is resolved relative to it, so
`/Dockerfile` is correct and `/services/api/Dockerfile` would double the path.

Do not instead leave Base Directory at `/` and point Dockerfile Location at
`/services/api/Dockerfile` — that builds with the repo root as context, so
`npm ci` installs the Next.js app's dependencies and the build fails at
`COPY src ./src` (there is no `src/` at the root).

`/health/ready` returns 503 until Mongo connects, so a failing health check
after deploy points at `MONGODB_URI`, not at the app.

## 2. Backend environment variables

All are runtime variables (read at process start) — none are needed at build
time. In Coolify, **uncheck "Available at Buildtime" for every variable** (keep
them enabled at runtime). Two reasons:

- Leaving them build-time injects `NODE_ENV=production` into `npm ci`, which
  omits devDependencies — so `tsc` goes missing and the build dies with
  `sh: tsc: not found` (exit 127). The Dockerfile now forces dev deps with
  `npm ci --include=dev` as a backstop, but runtime-only is still correct.
- It also stops secrets (`CLERK_SECRET_KEY`, `WALLET_SERVICE_TOKEN`, the Mongo
  password) from being baked into image layers as build args — the source of
  the `SecretsUsedInArgOrEnv` build warnings.

```
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
LOG_LEVEL=info
TRUST_PROXY=true

MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>/?retryWrites=true&w=majority
MONGODB_DB_NAME=worldstreet-prediction

CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
CLERK_AUTHORIZED_PARTIES=https://worldstreetgold.com,https://www.worldstreetgold.com,https://prediction.worldstreetgold.com

CORS_ORIGINS=https://prediction.worldstreetgold.com

WALLET_API_URL=https://<wallet-domain>
WALLET_SERVICE_TOKEN=<the token from step 3>

RATE_LIMIT_MAX=200
RATE_LIMIT_WINDOW=1 minute

RESEND_API_KEY=re_...
ALERT_EMAIL_FROM=Worldstreet Alerts <alerts@notifications.worldstreetgold.com>
ALERT_EMAIL_TO=settlement@worldstreetgold.com,ops@worldstreetgold.com
ALERT_REPEAT_HOURS=6
```

Notes:

- `TRUST_PROXY=true` is required behind Coolify's Traefik, otherwise rate
  limiting buckets every request under the proxy's IP.
- `CLERK_AUTHORIZED_PARTIES` must list every web origin whose session tokens
  this API accepts. A token minted by an origin not on the list is rejected.
- `CORS_ORIGINS` only adds to the built-in allowlist in `src/app.ts`
  (`prediction.worldstreetgold.com`, `worldstreetgold.com`,
  `www.worldstreetgold.com`), so it can stay empty if those cover you.
- Leaving the two `WALLET_*` vars empty is safe: the service boots and every
  wallet route answers `503 WALLET_UNAVAILABLE` instead of failing to start.
- The alert vars mail settlement exceptions (a market Bayse resolved to a
  label none of its outcomes match, one overdue past
  `SETTLEMENT_OVERDUE_HOURS`) to a human. The first three must all be set or
  no mail goes out, and `ALERT_EMAIL_FROM`'s domain has to be verified in
  Resend first — an unverified sender fails with `domain not verified` in
  the logs and nothing else. Prefer a subdomain (`notifications.`) so
  automated mail can't damage the root domain's reputation or collide with
  an existing SPF record. `ALERT_EMAIL_TO` is comma-separated; make the
  first a role address that outlives whoever set this up.
- `ALERT_REPEAT_HOURS` is how long one condition stays quiet after alerting.
  It matters more than it looks: the settlement poller re-detects a stuck
  market every `SETTLEMENT_POLL_SECONDS`, so without it a single overdue
  market mails once a minute until someone clears it. The next alert for
  that condition says how many times it recurred meanwhile. Set `0` to send
  on every detection.
- Alerts always reach the log regardless; `ALERT_WEBHOOK_URL` still works
  alongside mail if you'd rather also push them somewhere else.

## 3. Register the service token with the wallet

Generate a token:

```bash
openssl rand -hex 32
```

Then, in the **wallet service's** Coolify env, append a `prediction` entry to
the existing comma-separated list and redeploy it:

```
WALLET_SERVICE_TOKENS=xstream:<token>,academy:<token>,shop:<token>,prediction:<new-token>
```

Put the same value in this service's `WALLET_SERVICE_TOKEN`. The branch name
(`prediction`) is what the wallet stamps on every charge and hold, and it's
what scopes refunds/captures to this platform.

Keep the token server-side only — it can act for any user's wallet.

## 4. Clerk dashboard

In the central `worldstreetgold.com` Clerk application:

1. **Domains → Satellite domains** → add the prediction web app's production
   domain (e.g. `prediction.worldstreetgold.com`).
2. Confirm the same domain appears in the allowed origins / authorized parties
   for the instance.

Nothing to configure for the API itself — it only needs the keys.

## 5. Verify after deploy

```bash
curl https://prediction-api.worldstreetgold.com/health/live
curl -i https://prediction-api.worldstreetgold.com/v1/user/me
```

Expected: the first returns `{"status":"ok","service":"worldstreet-prediction-api",...}`,
the second returns `401 UNAUTHORIZED` (proof Clerk verification is active — a
`500` here means the Clerk keys are wrong or missing).

With a real session token from the browser (`await window.Clerk.session.getToken()`):

```bash
curl -H "Authorization: Bearer <token>" https://prediction-api.worldstreetgold.com/v1/wallet/balance
```

Expected: the user's spendable USD balance in minor units. `503
WALLET_UNAVAILABLE` means the wallet vars are unset or the token isn't
registered on the wallet side yet.

## 5b. Turn on the Local (naira) book

Local markets are inert until an admin sets a USD/NGN mid rate: with no rate
row `GET /v1/wallet/ngn` reports `fx: null`, conversions answer `503
FX_UNAVAILABLE`, and nobody can fund a naira balance to trade with. The rate is
deliberately not an env var — it's set at runtime and every change is kept for
audit.

The admin is any account with Clerk `publicMetadata.role = "admin"`.

```bash
curl -X POST https://prediction-api.worldstreetgold.com/v1/admin/fx-rate \
  -H "Authorization: Bearer <admin token>" \
  -H "Content-Type: application/json" \
  -d '{"usdToNgn": 1500}'
```

`FX_SPREAD_BPS` (default 100 = 1%) is then applied against the user in both
directions, so a round trip costs 2× the spread.

To check the whole money path rather than just the rate, run the smoke test —
it sets the rate, converts dollars to naira, stakes on a live Bayse market,
proves a retried order can't stake twice, and reads the position back out of
the portfolio, asserting the balances at each step:

```bash
API_BASE=https://prediction-api.worldstreetgold.com ADMIN_TOKEN=<admin token> npx tsx scripts/smoke-local-book.ts --fx 1500 --yes
```

Run it from `services/api`. Session tokens expire in about a minute, so grab
one immediately before running. Without `--yes` it prints what it would do and
sends nothing; `--settle` additionally settles the market, which pays out
**every** user holding it — staging only. See the header of
`services/api/scripts/smoke-local-book.ts` for the rest of the flags.

## 6. Deploying the web app (separate resource)

The Next.js app is a second Coolify resource from the same repo with Base
Directory `/` (Nixpacks or its own Dockerfile).

**Critical:** `NEXT_PUBLIC_*` variables are inlined at **build** time, so in
Coolify they must be marked as **Build Variables**, not plain runtime env. If
they're runtime-only the bundle ships with them empty and the app silently
stays in mock-auth mode.

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...   # build variable
NEXT_PUBLIC_API_URL=https://prediction-api.worldstreetgold.com   # build variable
CLERK_SECRET_KEY=sk_live_...                     # runtime
```

Setting `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is the switch that turns on Clerk
satellite SSO; setting `NEXT_PUBLIC_API_URL` is what points the nav's Cash stat
at the real central-wallet balance. With both unset the app runs in demo mode.
