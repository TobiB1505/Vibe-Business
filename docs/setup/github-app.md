# GitHub App Setup (Manual)

This is a manual, one-time (per environment) setup — nothing in this repository can create or configure a GitHub App for you. Follow it exactly; the exact permissions and settings below are what [ADR 0003](../decisions/0003-github-app-integration.md) and [ADR 0009](../decisions/0009-github-installation-ownership-verification.md) require, no more.

## Three different IDs — do not confuse them

| Term | What it is | Where you'll see it | Used for |
|---|---|---|---|
| **App ID** | A number identifying the GitHub App itself (e.g. `123456`) | Top of the App's settings page | `GITHUB_APP_ID` — signs App-level JWTs |
| **Client ID** | The App's OAuth client identifier (e.g. `Iv1.abc123def456`) | Same settings page, "About" section | `GITHUB_APP_CLIENT_ID` — the OAuth code exchange |
| **Installation ID** | Identifies one specific installation of the App on one account/org (e.g. `78901234`) | Only appears at runtime, in callback URLs and API responses | **Never configured** — received per-request, and per ADR 0009, never trusted without verification |

## 1. Create the GitHub App

GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**.

- **GitHub App name**: `Vibe Business (dev)` for a local/dev app — pick something clearly distinguishable from a future production app. (GitHub App names must be globally unique.)
- **Homepage URL**: `http://localhost:3000` for local dev.
- **Callback URL**: `http://localhost:3000/app/connect/github/callback` — this is where GitHub sends `code`, `installation_id`, and `state` after installation + authorization (see `src/app/app/connect/github/callback/route.ts`).
- **Setup URL**: leave blank. Not used — the combined install+authorize flow below doesn't need it.

### Setup behavior — the setting that matters most

Under **"Identifying and authorizing users"**:

- ✅ **Check "Request user authorization (OAuth) during installation."** Without this, GitHub will not include an OAuth `code` in the callback, and the ADR 0009 installation-ownership check cannot run at all — the connect flow will fail at the "missing_params" step.
- **Redirect on update**: leave unchecked (default) — not needed for Sprint 1.

### Webhook

- **Active**: leave **unchecked** (disable webhooks entirely) for now. Sprint 1 does not implement webhook handling — see [docs/sprints/0001-github-app-connection.md](../sprints/0001-github-app-connection.md) Risks/Notes for why, and what the follow-up requirement is.

### Where can this GitHub App be installed?

- **Only on this account** is simplest for local development. Switch to **Any account** only if you specifically need to test installing on other accounts/orgs.

## 2. Repository permissions — least privilege

Under **Permissions & events → Repository permissions**, set exactly:

- **Metadata: Read-only**
- **Contents: Read and write**

…and nothing else.

Do **not** set:
- **Pull requests** — Vibe never opens one. An approved change is delivered by creating a branch and then fast-forwarding the default branch to one exact commit (`src/modules/merge/github/adapter.ts`), so the pull-request API is never called.
- Actions, Administration, Issues, Workflows
- Any Organization or Account permission

Why each one:

| Permission | Needed for |
|---|---|
| Metadata: Read-only | Listing the repositories an installation can access, and their basic facts (name, owner, default branch, visibility, URL) — `src/modules/github/repositories.ts` |
| Contents: Read and write | **Read** — the Git tree and a small number of manifest files, to build repository intelligence (`src/modules/github/repository-reader.ts`). **Write** — creating the blob, tree, commit and branch ref a prepared change lands on (`src/modules/execution/github/adapter.ts`), and fast-forwarding the default branch after an explicit human approval (`src/modules/merge/github/adapter.ts`). |

Read access alone is not enough to run the product: both write paths check the permission the installation *actually carries* and refuse when it is not `write`, so an App configured read-only will connect and analyse, and then fail at every prepared change and every merge.

### ⚠️ Existing installations must approve a changed permission

GitHub does not grant a newly requested permission to an existing installation automatically. Two upgrades have happened:

- **Contents: Read-only** was added in Sprint 2 — repository intelligence fails with a "needs read-only access to repository contents" message until it is approved.
- **Contents: Read and write** is required from Sprint 11 onwards — preparing a change and merging one both refuse until it is approved.

To update an App you already created:

1. GitHub → **Settings** → **Developer settings** → **GitHub Apps** → *your app*
2. **Permissions & events** → **Repository permissions**
3. Set **Contents** to **Read and write**
4. **Save changes**

GitHub then emails the account/organisation owner a request to approve the updated permissions. Until that approval happens:

5. Go to **Settings** → **Applications** → **Installed GitHub Apps** → *your app* → **Review request** → approve.

Alternatively, visit `https://github.com/settings/installations`, open the installation, and accept the pending permission request. The in-app error state links here directly.

## 3. Create the App, then collect credentials

After clicking **Create GitHub App**, on the resulting settings page:

- **App ID** — shown near the top. → `GITHUB_APP_ID`
- **App slug** — the URL-friendly name shown in the App's URL (`github.com/apps/<slug>`). → `GITHUB_APP_SLUG`. Used to build the installation URL in `src/modules/github/oauth.ts`.
- **Client ID** — under "About." → `GITHUB_APP_CLIENT_ID`
- **Client secret** — click **Generate a new client secret**. Copy it immediately (GitHub shows it once). → `GITHUB_APP_CLIENT_SECRET`
- **Private key** — scroll to "Private keys" → **Generate a private key**. Downloads a `.pem` file. → `GITHUB_APP_PRIVATE_KEY`

## 4. Set environment variables

See [.env.example](../../.env.example) for the full list and multiline-key handling.

Locally (`.env.local`):

```
GITHUB_APP_ID=<App ID>
GITHUB_APP_SLUG=<App slug>
GITHUB_APP_CLIENT_ID=<Client ID>
GITHUB_APP_CLIENT_SECRET=<Client secret>
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

To convert the downloaded `.pem` file into the single-line `\n`-escaped form: open it in a text editor and replace every real line break with the two characters `\n`, or run:

```bash
awk 'BEGIN{ORS="\\n"}{print}' downloaded-key.pem
```

and wrap the result in quotes as the value.

On **Vercel** (Project Settings → Environment Variables): paste the `.pem` file's contents **as-is** (real line breaks) — Vercel's environment variable editor supports multiline values natively, and `src/lib/env/github.ts` leaves real newlines unchanged.

## 5. Production (Vercel) — a second App

GitHub Apps are configured with a fixed Homepage URL and Callback URL. The cleanest way to support both local development and a deployed Vercel URL is to **create a second GitHub App** for production (e.g. `Vibe Business`, without the `(dev)` suffix), identical in every setting above except:

- **Homepage URL**: your production custom domain (e.g. `https://vibebusiness.de`) — the same value `NEXT_PUBLIC_APP_URL` is set to in Vercel's Production environment, see [environment.md](../deployment/environment.md)
- **Callback URL**: `https://vibebusiness.de/app/connect/github/callback`

Then set the production App's credentials as environment variables on the Vercel project (Production environment), keeping the dev App's credentials only in `.env.local`. Do not reuse one App's client secret/private key across environments.

If your GitHub App's settings page shows a **list** of callback URLs (GitHub has been rolling this out) rather than a single field, you may instead add both the localhost and production callback URLs to one App — check what your App's settings page actually offers before assuming either way.

## 6. Verify

Once configured, `pnpm dev` and click "Connect your first project" on `/app` (after signing in). See [docs/sprints/0001-github-app-connection.md](../sprints/0001-github-app-connection.md) for the expected flow and how to tell it's working end-to-end.
