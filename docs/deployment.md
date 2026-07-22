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
| Dockerfile Location| `Dockerfile` (relative to base directory)        |
| Ports Exposes      | `3001`                                           |
| Health Check Path  | `/health/ready`                                  |
| Domain             | e.g. `https://prediction-api.worldstreetgold.com`|

Base Directory matters: it makes `services/api` the Docker build context, which
is what the Dockerfile expects (it copies `package.json`, `src/`, `tsconfig.json`
from the context root).

`/health/ready` returns 503 until Mongo connects, so a failing health check
after deploy points at `MONGODB_URI`, not at the app.

## 2. Backend environment variables

All are runtime variables (read at process start) — none need to be build-time.

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
