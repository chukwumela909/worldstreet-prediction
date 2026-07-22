# Worldstreet Prediction API

Standalone backend for the prediction platform. It plugs into the two central
WorldStreet services:

- **Central auth** — Clerk on `worldstreetgold.com`. The web app runs Clerk as
  a satellite domain and forwards the session JWT as `Authorization: Bearer`;
  this API verifies it with `@clerk/fastify` and auto-provisions a local
  profile (`User`) keyed by the Clerk userId on first request.
- **Central wallet** — the worldstreet-wallet service. All money moves are
  server-to-server from here using the `X-Wallet-Service-Token` service
  principal (`src/wallet.ts`). Amounts are USD integer cents. The token is
  never exposed to clients.

## Endpoints

Mounted under both `/v1` and `/api`:

| Method | Path              | Auth        | Description                                  |
| ------ | ----------------- | ----------- | -------------------------------------------- |
| GET    | `/health/live`    | none        | Liveness                                     |
| GET    | `/health/ready`   | none        | Readiness (DB connected)                     |
| GET    | `/v1/user/me`     | Clerk JWT   | Local profile (auto-provisioned)             |
| GET    | `/v1/wallet/balance` | Clerk JWT | Spendable USD balance from the central wallet |

Trading endpoints (buy = wallet charge, payout = wallet credit) build on
`chargeWallet` / `creditWallet` / `refundWalletCharge` in `src/wallet.ts`.

## Develop

```bash
cp .env.example .env   # fill in values
npm install
npm run dev            # tsx watch, port 3001
```

## Deploy (Coolify)

1. New resource → this git repo, **Base Directory `/services/api`**, build
   pack **Dockerfile**. Expose port **3001**.
2. Set the env vars from `.env.example` (production values, `TRUST_PROXY=true`).
3. Wallet side: add `prediction:<random-token>` to the wallet service's
   `WALLET_SERVICE_TOKENS` and put the same token in `WALLET_SERVICE_TOKEN`
   here.
4. Clerk side (dashboard of the central worldstreetgold.com application):
   add the prediction web app's production domain as a **satellite domain**,
   and include the API's callers in `CLERK_AUTHORIZED_PARTIES`.
5. Point a domain (e.g. `prediction-api.worldstreetgold.com`) at the service;
   the web app sets `NEXT_PUBLIC_API_URL` to it.
