# Pantry

Pantry is an open-source-ready household inventory project currently under active development.

Deployment targets:

- 🚂 **Railway / Docker** — one Node container, SQLite on a volume (see [Deploy on Railway](#deploy-on-railway))
- ☁️ Cloudflare Workers (D1 + R2) — still supported, see below

Household inventory PWA. This repository is a pnpm monorepo.

## Structure

- `apps/web` — Pantry web app (PWA + Worker, later phases)
- `packages/core` — runtime-independent household/location domain and ports
- `packages/shared` — shared TypeScript modules
- `packages/database` — canonical SQL migrations and D1 adapters (local SQLite later)
- `home-assistant` — Home Assistant integration and Lovelace card

## Deploy on Railway

The `Dockerfile` builds the PWA and a single Node server (`apps/web/server`) that serves the API and the static app. Data lives in SQLite (`$DATA_DIR/pantry.db`) and product photos in `$DATA_DIR/assets`, so **one replica and one volume** are required.

1. **New project → Deploy from GitHub repo.** `railway.json` selects the Dockerfile and the `/api/v1/health` healthcheck.
2. **Add a volume** to the service, mount path `/data`.
3. **Variables** (see [.env.example](.env.example)):
   - `BETTER_AUTH_SECRET` — `openssl rand -base64 32` (required, the server refuses to start without ≥32 chars)
   - `GEMINI_API_KEY` — receipt scanning and recipes
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — push notifications (`pnpm --filter web vapid`)
   - `BETTER_AUTH_URL` — optional on Railway; derived from `RAILWAY_PUBLIC_DOMAIN`
4. **Generate a domain** (Settings → Networking). Keep replicas at 1.
5. Open the app, create an account, and turn on notifications in Settings.

Migrations in `packages/database/migrations` run automatically on boot. A consistent snapshot of the database is written daily to `$DATA_DIR/backups` (last `BACKUP_KEEP`, default 7); also enable Railway volume backups.

Local Node run: `cd apps/web && pnpm build:node && BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://localhost:8080 pnpm start` (Node 24+, uses the built-in `node:sqlite`).

### Security model

- Same-origin API with `HttpOnly`, `Secure`, `SameSite=Lax` session cookies; sessions last 30 days.
- Strict CSP (no inline scripts), HSTS in production, `frame-ancestors 'none'`, `nosniff`, no-referrer-leaks, camera-only permissions policy.
- CSRF: cross-origin `POST/PUT/PATCH/DELETE` to `/api/*` is rejected by an `Origin` check.
- Rate limits per client IP: sign-in 10/min, sign-up 5/min, auth 60/min, receipts and AI 20/min, API 300/min (`TRUSTED_PROXY_HOPS`, default 1 = Railway's proxy).
- Request bodies capped at 4 MB; images are sniffed, not trusted by `Content-Type`.
- Push endpoints are restricted to the public browser push services (no SSRF).
- The container drops from root to the `node` user after fixing volume ownership; secrets are only read from the environment and the server fails fast when they are missing or placeholders.

## Notifications

Pantry sends Web Push reminders once a day (at the hour chosen in Settings, in the device time zone):

- **Expiring soon** — lots expiring within the chosen lead time, or already expired.
- **Running low** — products at or below their minimum stock.
- **Stock checks for household items** (cleaning supplies, paper goods, …, *not* food) — the notification asks how much is left and has **None / All** buttons (kept to two to avoid accidental taps). Tapping one updates the inventory (none → empties stock and adds it to the shopping list; all → tops stock up to the most you have had on hand). "Half" is answered in the app, on the product card or the stock-check card.

Products from Open Products Facts are household items by default; any product can be switched in its menu or when it is added. Android Chrome and desktop browsers show the action buttons. iPhone needs the app added to the Home Screen and does not render action buttons, so the same question appears as a card on the Inventory screen.

## Languages

The UI is available in Romanian and English (Settings → Language, also on the sign-in screens). The choice is stored on the profile and follows the account across devices; recipes and notifications are written in the same language. Strings live in `apps/web/src/i18n`; a test fails if a UI string is missing its English translation.

## Setup

```bash
pnpm install
```

## CI

`pnpm ci:check` runs typecheck, tests, and the production build. It does not apply remote D1 migrations. GitHub Actions runs this on pull requests and pushes to `main`. Production deploys are owned by Cloudflare Workers Builds.

Delivery status: pushes to `main` automatically build and deploy the existing `pantry` Worker.

## Open Food Facts / Open Products Facts

Product scans look up barcodes server-side with the Open Facts API v3:

`GET https://world.openfoodfacts.org/api/v3/product/{barcode}`

If the barcode is not a food product, Pantry then tries Open Products Facts. The browser never calls those APIs directly.

Pantry uses Open Food Facts and Open Products Facts data. That data is available under the Open Database License, with product images under Creative Commons Attribution ShareAlike. Pantry stores only mapped fields and external image URLs — not a copy of the Open Facts database.

Source links are shown on scanned products, for example [Open Food Facts](https://world.openfoodfacts.org/) and [Open Products Facts](https://world.openproductsfacts.org/).

## Environment and configuration

Config is split into public frontend values, Worker bindings, Worker secrets, and optional future bindings.

### Same-origin API

The PWA and Worker share one origin. The browser calls `/api/v1/*` and `/api/auth/*` on the current origin — no `VITE_API_URL`, and no CORS for normal PWA → API usage.

Example production origin: `https://pantry.example.com` → `/api/v1/...`

Home Assistant will later call the public Pantry base URL server-to-server with a household API key. That is not configured yet.

### Public frontend

The React app may read only public `VITE_*` values. None are required today (the app name lives in the PWA manifest). Never put secrets, D1/R2/KV bindings, or a backend URL in frontend env. No secret may use a `VITE_` prefix.

### Worker bindings (current)

`DB` — `D1Database` (`pantry`, `d95a8fcf-545c-46c1-82df-998f96dd8cc7`). Local Vite/Wrangler uses simulated D1.

`R2` — `R2Bucket` (`pantry-assets`). Private household product photos, served only through authenticated `/api/v1/products/:id/image`. The bucket is private (no public r2.dev access, no custom domain). Local Vite/Wrangler uses simulated R2. Do not set `remote: true`.

Binding types live in `apps/web/worker-configuration.d.ts` (generated by Wrangler). Do not edit that file by hand or duplicate it in `packages/shared`.

### Worker bindings (future, not configured)

- `KV` — non-critical cache / rate limit
- Rate Limiting binding if chosen later

Do not invent placeholder resource IDs.

### Secrets and public Worker vars

The Worker owns secrets and third-party credentials.

- `BETTER_AUTH_SECRET` — required production secret (Cloudflare Worker secret). Local: `apps/web/.dev.vars`. Never commit the value.
- `GEMINI_API_KEY` — Google Gemini API key (AI recipes and receipt OCR). Cloudflare Worker secret. Local: `apps/web/.dev.vars`.
- `AI_MODEL` / `RECEIPT_AI_MODEL` — public Gemini model ids in `apps/web/wrangler.jsonc` `vars` (default `gemini-3.5-flash-lite`).
- `BETTER_AUTH_URL` — public Better Auth base URL. Production is set in `apps/web/wrangler.jsonc` `vars`. Local: `http://localhost:5173` in `.dev.vars`.

Expected later: transactional email key.

Local: copy `apps/web/.dev.vars.example` to `apps/web/.dev.vars` (gitignored). Production secrets: Cloudflare dashboard, `wrangler secret`, or authenticated Cloudflare tooling/MCP. Never Git, the frontend bundle, or committed `.env` files.

Workers Builds receives production secrets from Cloudflare, not from committed files. GitHub Actions runs quality checks only and does not deploy.

### Who may access what

- React: public `VITE_*` only
- Worker: bindings, secrets, external credentials
- Core/domain (later): injected ports/services; no Wrangler/env globals
- Docker (later): environment variables and `/data`; same domain/API contract. Exact Docker env names are not frozen.
