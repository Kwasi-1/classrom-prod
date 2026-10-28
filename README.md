# Classroom

A GitHub Classroom alternative: teachers distribute coding assignments as private repos in a
GitHub **Free** organization, students submit by pushing, and every push is autograded with hidden tests.

Stack: Next.js (App Router) + TypeScript, Neon Postgres via Drizzle ORM, a GitHub App (`@octokit/app`),
`iron-session` cookies, Tailwind CSS. Deploys to Render.

> Status: **Milestone 3** — login, app install, webhooks, classrooms, roster, assignments (tests upload, publish, invite links) and the accept flow.

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

## Manual test (Milestone 2)

1. Run `npm run db:migrate` (adds migration `0001`: classroom slugs are now globally unique).
2. On the dashboard, **New classroom**: pick the org, enter name, slug (e.g. `cs323`) and term.
   - Only org **admins** can create classrooms (checked via `GET /orgs/{org}/memberships/{you}`).
   - The app creates the private repo `{slug}-grader` in the org and commits
     `.github/workflows/grade.yml`, `grader/run_tests.py` and `README.md`.
3. You land on the classroom's **Settings** tab. Follow the instructions there to add the
   `GRADER_CALLBACK_SECRET` repository secret to the grader repo (see below).
4. **Roster** tab: paste or upload 5 GitHub usernames (one per line; CSV first column; optional
   `github_username` header). The result shows added / duplicates / invalid counts; non-existent
   usernames are listed as invalid and the rest are still imported. Import the same list again → all duplicates.
5. Sign in as one of those students (another browser profile): the classroom shows under **Enrolled**
   and `/c/{slug}` shows the student view. A user not on the roster gets a 404.

### Grader repo secret

Each classroom's grader repo needs one secret so the grading workflow can report results:
**grader repo → Settings → Secrets and variables → Actions → New repository secret**,
name `GRADER_CALLBACK_SECRET`, value = the app's `GRADER_CALLBACK_SECRET`.
The callback URL (`APP_URL`) is written into `grade.yml` when the grader repo is seeded.

### Seed data

For local UI work without GitHub calls:

```bash
npm run db:seed -- your-github-login
```

This creates classroom `/c/demo101` (org `demo-org`) owned by you, with 8 fake students.
GitHub-backed actions (roster validation, grader repo links) won't work against this demo data.

## Manual test (Milestone 3)

Setup (once):
1. Create a repo in your org from [`examples/hello-python`](examples/hello-python) and tick
   **Settings → Template repository**. If the app is installed on *selected* repositories only, add it.
2. Have a second GitHub account (the "student") and add its username to the classroom roster.

Steps:
1. Classroom → **Assignments → New assignment**: title, slug (e.g. `hw1`), template `hello-python`,
   deadline (entered in Africa/Accra time). It is created as a **draft**.
2. On the assignment page, paste [`examples/hello-python-tests/tests.yml`](examples/hello-python-tests/tests.yml),
   click **Choose folder** and pick `examples/hello-python-tests/files`, then **Validate & save**.
   - Try an invalid file first (e.g. remove an `expected:`) — errors appear inline and nothing is committed.
   - On success, the grader repo gets one commit with `assignments/hw1/tests.yml`, `tests.json` and
     `files/tests/test_main.py`.
3. **Publish** → the invite link `APP_URL/a/{code}` appears. (Publishing requires tests to be uploaded.)
4. As the student, open the invite link → sign in → **Accept assignment**. Within ~10s a private repo
   `{classroom}-hw1-{login}` appears in the org (created from the template) and the student is invited
   as a collaborator with *push* access. The page links to the invitation, which the student must accept.
5. Open the invite link again → it shows the same repo (accepting is idempotent).
6. Error cases: a user not on the roster, a draft/closed assignment, or a passed deadline each show a clear message.

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
src/app/api/classrooms/*   create classroom, roster import
src/app/c/[slug]           classroom page (teacher tabs / student view)
src/lib/grader.ts          grader repo creation + seeding (Contents API)
src/lib/roles.ts           per-classroom role checks
grader-template/           files committed into every {slug}-grader repo
scripts/seed.ts            demo data
src/lib/tests-spec.ts      tests.yml Zod schema (mirrors run_tests.py)
src/lib/accept.ts          accept flow: template generate → collaborator invite
src/app/a/[inviteCode]     accept page
src/app/c/[slug]/a/[assignment]  assignment page (teacher: tests, publish; student: repo)
examples/                  hello-python template + matching tests
```
