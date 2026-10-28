# Classroom

A GitHub Classroom alternative: teachers distribute coding assignments as private repos in a
GitHub **Free** organization, students submit by pushing, and every push is autograded with hidden tests.

Stack: Next.js (App Router) + TypeScript, Neon Postgres via Drizzle ORM, a GitHub App (`@octokit/app`),
`iron-session` cookies, Tailwind CSS. Deploys to Render.

> Status: **Milestone 1 (skeleton)** — login, sessions, app install, webhook verification + idempotency, full schema.

---

## 1. Register the GitHub App

Register one app for production and (recommended) a second one for local development, since the
webhook and callback URLs differ.

1. Go to **your organization → Settings → Developer settings → GitHub Apps → New GitHub App**
   (register it under the org that will host the classrooms).
2. Fill in the values from [`app-manifest.json`](app-manifest.json), replacing `YOUR_APP_URL`:

   | Field | Value |
   |---|---|
   | Homepage URL | `APP_URL` |
   | Callback URL | `APP_URL/api/auth/callback` |
   | Request user authorization (OAuth) during installation | **on** |
   | Expire user authorization tokens | either (tokens are used once at login and discarded) |
   | Webhook URL | `APP_URL/api/webhooks/github` (local dev: your smee.io URL) |
   | Webhook secret | a random string → `GITHUB_WEBHOOK_SECRET` |

   **Repository permissions:** Administration R/W, Contents R/W, Workflows R/W, Actions R/W, Metadata R.
   **Organization permissions:** Members R.
   **Subscribe to events:** Push. (`installation` and `installation_repositories` are delivered to every
   GitHub App automatically and have no checkbox.)
   **Where can this app be installed:** Only on this account (or Any account if several orgs will use it).

3. After creating it:
   - Copy **App ID** → `GITHUB_APP_ID`, **Client ID** → `GITHUB_APP_CLIENT_ID`.
   - Generate a **client secret** → `GITHUB_APP_CLIENT_SECRET`.
   - Generate a **private key** (`.pem`). Put it in `GITHUB_APP_PRIVATE_KEY` on one line with `\n` escapes:
     ```bash
     awk 'BEGIN{ORS="\\n"}1' your-app.private-key.pem
     ```

Alternatively, use GitHub's [manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
with `app-manifest.json` after replacing `YOUR_APP_URL`.

## 2. Neon setup

1. Create a project at [neon.tech](https://neon.tech) and a database (e.g. `classroom`).
2. Copy the connection string (with `?sslmode=require`) → `DATABASE_URL`.
   For the Render web service, the **pooled** connection string is fine; migrations work with either.
3. Apply migrations:
   ```bash
   npm run db:migrate
   ```

After changing `src/db/schema.ts`, create a new migration with `npm run db:generate`.

## 3. Environment

Copy `.env.example` to `.env` and fill it in. `SESSION_SECRET` must be 32+ characters:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `GITHUB_APP_*` | GitHub App credentials (see above) |
| `GITHUB_WEBHOOK_SECRET` | Verifies `X-Hub-Signature-256` on webhooks |
| `SESSION_SECRET` | Encrypts the session cookie |
| `GRADER_CALLBACK_SECRET` | Shared with the grader repo's report job only |
| `CRON_SECRET` | Bearer token for `/api/cron/*` |
| `APP_URL` | Public base URL, no trailing slash |

## 4. Local development (with smee.io)

```bash
npm install
npm run db:migrate
npm run dev
```

In a second terminal, forward webhooks (create a channel at https://smee.io and use it as the dev app's Webhook URL):

```bash
npx smee-client -u https://smee.io/YOUR_CHANNEL -t http://localhost:3000/api/webhooks/github
```

Then open http://localhost:3000, sign in with GitHub, and click **Install on organization**.

## Manual test (Milestone 1)

1. Sign in → you land on `/dashboard`; a row exists in `users`.
2. **Install on organization** → pick the org → GitHub returns you to the dashboard.
   The org appears under *Organizations* (you must be an org admin) and a row exists in `installations`
   (stored by the install callback and again, idempotently, by the `installation` webhook).
3. Webhook checks: in the app's *Advanced → Recent deliveries*, redeliver any delivery — the response body
   is `{"ok":true,"duplicate":true}` and `webhook_deliveries` still has one row for it. A request with a bad
   signature gets `401`.

## Project layout

```
app-manifest.json          GitHub App registration values
drizzle/                   SQL migrations (drizzle-kit)
src/db/schema.ts           Drizzle schema (all tables)
src/lib/github.ts          App client, retry wrapper (5xx / secondary rate limit), token cache, org admin check
src/lib/session.ts         iron-session helpers
src/lib/queue.ts           in-process serial queue for webhook work
src/lib/webhooks.ts        webhook event handlers
src/app/api/auth/*         login / install / callback / logout
src/app/api/webhooks/github  signature verification + delivery idempotency
```
