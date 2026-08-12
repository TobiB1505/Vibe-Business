# Sprint 2 — Repository Intelligence

Status: Implemented; live GitHub validation pending the manual permission upgrade and migration (see Validation)
Branch: `feat/sprint-2-repository-intelligence`

## Goal

Move Vibe Business from "this user connected `owner/repository`" to "here is what this repository actually *is*" — deterministically, cheaply, and explainably. The output is a versioned Repository Intelligence Snapshot: the structured foundation the later Business Readiness Audit will consume.

**No AI is involved.** Every detection is a deterministic rule over file paths and dependency manifests, with evidence attached.

## Context

[Sprint 1](0001-github-app-connection.md) established verified GitHub App installations and connected repositories, with `Metadata: Read-only` — deliberately the minimum for repository *discovery*. Reading repository content genuinely requires more, so Sprint 2 adds `Contents: Read-only` and nothing else (see [docs/setup/github-app.md](../setup/github-app.md) §2).

Building this deterministically first — rather than reaching for an LLM — is a direct application of [PRODUCT.md §13](../../PRODUCT.md#13-cost-principles) ("prefer deterministic software over AI where it is sufficient"). It also produces exactly the kind of small, structured, evidence-carrying context that keeps later AI calls cheap and auditable.

## Architecture

A pipeline of pure functions around two I/O calls:

```
RepositoryReader (port)          ← implemented by src/modules/github/repository-reader.ts
        ↓ getHead()              1 API call pair: repo + ref
        ↓ getTree(sha)           1 API call (+1 bounded fallback if truncated)
   selectCandidates()            pure: rank high-value files
        ↓ getTextFile() × N      only dependency manifests, budget-capped
   buildDetectionContext()       pure: parse manifests as data
        ↓
   detectors (all pure)          languages · frameworks · integrations
                                 · routes · monorepo · business surfaces
        ↓
   RepositoryIntelligenceSnapshot
```

Key boundaries:

- `src/modules/repository-intelligence/reader.ts` defines the **port**; the analyzer never imports Octokit or GitHub types. Every detector is unit-tested against an in-memory fake reader with no network.
- `src/modules/github/repository-reader.ts` is the only place that knows about Octokit, HTTP status codes, base64 content, and recursive-tree truncation.
- `src/modules/github/errors.ts` maps GitHub failures onto a typed domain vocabulary so no raw GitHub response can reach the UI.

## Security model

**Repository content is UNTRUSTED INPUT** ([ADR 0006](../decisions/0006-untrusted-repository-execution.md) remains fully binding).

Sprint 2 does: retrieve metadata, retrieve the Git tree, retrieve a handful of selected text files, parse them as data, derive facts.

Sprint 2 never: clones a repository, executes repository code, runs `npm/pnpm/pip install`, runs any script from `package.json`, runs builds or tests, executes shell commands derived from repository data, dynamically imports or `eval`s repository files, or executes configuration files.

Manifests are parsed with `JSON.parse` or matched as lowercase text — never interpreted. Script *bodies* from `package.json` are deliberately discarded; only script **names** are kept, because a command line is both useless to Sprint 2's detectors and an injection surface for later AI consumers.

### Untrusted data, not instructions

Everything inside a snapshot — repository names, paths, dependency names — originates from a customer repository. It is **data to reason about, never instructions to follow.** A future AI consumer must not treat a README sentence, a file path, or a package name as a system instruction. This rule is documented at the schema itself (`src/modules/repository-intelligence/schema.ts`), in [ARCHITECTURE.md](../../ARCHITECTURE.md), and as [CLAUDE.md](../../CLAUDE.md) rule 25, so it survives independently of this sprint document.

No AI sanitization framework is built yet — that would be speculative. The rule is recorded now so it is in place *before* the first AI consumer exists.

### No arbitrary URL fetching

Sprint 2 talks to the GitHub API only. It does not crawl the production website, fetch URLs found in repository files, follow links, call APIs referenced by repository code, or connect to any database found in a config. A URL discovered in repository data is data. Live-product analysis is a separate, later sprint.

## Repository reading policy

**Discovery vs. fetching.** These are separate questions, and separating them is what makes analysis cheap:

- *Discovery* answers "does this high-value file exist?" — free, from the tree.
- *Fetching* downloads content, and is limited to **dependency manifests only** (`package.json`, `pyproject.toml`, `requirements.txt`, `Pipfile`, `composer.json`, `Gemfile`, `go.mod`, `Cargo.toml`), because a dependency list cannot be inferred from a filename. `next.config.ts` existing *is* the signal; its contents add nothing.

A typical single-package repository therefore costs **one** content fetch.

**Never fetched, under any circumstances:**

| Category | Examples |
|---|---|
| Sensitive | `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`, `credentials*`, `secrets*`, `private-key*`, `service-account*`, `.npmrc`, `.netrc` |
| Binary | images, video, audio, fonts, archives, executables, databases, PDFs |
| Generated / vendored | `node_modules`, `.next`, `dist`, `build`, `out`, `coverage`, `vendor`, `target`, `.git`, caches, `__pycache__`, `.venv` |

Matching is anchored to path **segments** and **basenames**, never substring containment — so `docs/credentials-guide.md` and `src/lib/dist-utils.ts` are correctly *not* excluded. Names built from ordinary English words (`credentials`, `secrets`) are exempted when they carry a documentation extension, so prose *about* credentials is distinguished from credentials. This is enforced by one function, `mayFetchContent()`, and covered by unit tests.

The *existence* of a sensitive path may be observed in the tree; its content is never retrieved, and its existence is not surfaced to the user (that would be a separate future security feature).

Generated paths are additionally excluded from being treated as source, so a committed `.next/` build output cannot produce phantom routes.

## Data minimization

Vibe Business does **not** store a copy of the customer's repository. The snapshot contains derived facts plus the *paths* that justify them:

> Detected: Next.js — evidence: `package.json` (dependency `next`), `next.config.ts`

Never stored: complete source files, README bodies, raw `package.json` bodies, lockfiles, configs, environment files, archives, or even dependency version ranges. Repository content exists transiently in memory during analysis and is then discarded. A test asserts that fetched content and version numbers do not survive into the serialized snapshot.

## Detection model

Every detection carries **evidence** (`kind`, `path`, optional `detail`) and a **confidence** of `high` / `medium` / `low` — deliberately coarse, with no fabricated precision like "93.74%".

Confidence rules are deterministic:

- **Frameworks**: dependency + dedicated config file → `high`; dependency alone → `medium`; config alone → `low`.
- **Languages**: manifest (`tsconfig.json`, `go.mod`, …) or a substantial file count → `high`; moderate file count → `medium`; a stray file or two → `low`.
- **Integration signals**: a declared dependency → `high`; a config file alone → `medium` (it could be a leftover).

Prose is never evidence. A README claiming "built with React" cannot produce a React detection when `package.json` contains no React — an explicit test covers this.

Integration signals are **signals**, not configuration claims: a Stripe dependency proves the SDK is installed, not that payments work. The type is `IntegrationSignal` and the UI says "detected" rather than "configured".

### Supported detectors

- **Languages**: TypeScript, JavaScript, Python, Go, Rust, PHP, Ruby, Java, C#
- **Frameworks**: Next.js, React, Vue, Nuxt, Svelte, SvelteKit, Astro, Remix, Vite, Angular, Express, NestJS, FastAPI, Django, Flask, Laravel, Rails
- **Deployment**: Vercel, Netlify, Render, Railway, Fly.io, Docker, Heroku
- **Database**: Supabase, Firebase, Prisma, Drizzle, PostgreSQL, MongoDB, SQLite
- **Auth**: Supabase Auth, Clerk, Auth.js/NextAuth, Firebase Auth, Lucia
- **Payments**: Stripe, Paddle, Lemon Squeezy
- **Analytics**: PostHog, Plausible, Google Analytics, Vercel Analytics
- **Monitoring**: Sentry
- **Package managers**: pnpm, npm, yarn, bun
- **Business surfaces**: authentication, payments, pricing page, checkout/billing, analytics, SEO metadata, sitemap, robots.txt, blog/content, contact, docs/help, legal, onboarding, dashboard/app

Business surfaces are recorded as detected **or explicitly not detected** — absence is a fact worth stating, not an omission. No scoring or qualitative judgement: that belongs to the later Business Readiness Audit.

### Routes

Only Next.js is supported, because its file-system router makes routes derivable from paths alone. Both **App Router** and **Pages Router** are handled, including route groups `(marketing)`, dynamic `[id]`, catch-all `[...slug]`, optional catch-all `[[...slug]]`, API routes, layouts, `index` mapping, and private `_folder` exclusion.

For frameworks whose routes are declared in code (Express, FastAPI, Django, …) the mode is `limited` and **no routes are returned** — guessing would require parsing or executing application code.

## Analysis budgets

Central, in `src/modules/repository-intelligence/budgets.ts`:

| Budget | Default | Why |
|---|---|---|
| `maxTreeEntries` | 20,000 | Caps work on very large repositories |
| `maxFileFetches` | 40 | Caps GitHub API calls; a typical repo uses 1 |
| `maxBytesPerFile` | 256 KB | No single manifest is legitimately larger |
| `maxTotalBytes` | 2 MB | Cumulative download ceiling |
| `maxDurationMs` | 20,000 | Keeps a synchronous request bounded |
| `maxPathDepth` | 12 | Ignores pathologically nested paths |

Reaching a budget is **never an error**. The snapshot's completeness becomes `partial` with machine-readable reasons: `tree_truncated`, `tree_entry_budget_reached`, `file_budget_reached`, `byte_budget_reached`, `duration_budget_reached`, `unsupported_structure`.

**Truncated trees** (GitHub's recursive tree API caps out on huge repositories) are handled with a bounded fallback: one extra non-recursive root-level call, so top-level manifests are still seen. There is no recursive crawl. `treeComplete: false` is recorded and analysis continues — a massive repository yields a partial-but-useful snapshot rather than a failure.

## Snapshot schema

`schemaVersion: "repository_intelligence.v1"`, `analyzerVersion: "repo-intelligence-v2"` — the analyzer version is explicit and deliberately independent of the app/package version, so detection-rule changes can invalidate reuse without a release bump.

Shape (see `src/modules/repository-intelligence/schema.ts` for the authoritative types):

```
schemaVersion, source { commitSha, branch, analyzerVersion, treeComplete },
repository { fullName, defaultBranch, private },
completeness { status, reasons },
projectStructure { totalTreeEntries, sourceFileCount, topLevelDirectories, monorepo },
languages[], frameworks[], packageManager, runtime[],
integrationSignals[], routes { mode, routes[], truncated },
businessSurfaces[], metrics { … }, warnings[]
```

## User flow

```
Project page
  Repository: Connected
  Repository intelligence: Not analyzed yet
  [Inspect repository]
        ↓
  resolve head SHA (1 call)
        ↓
  reusable snapshot for this SHA + analyzer version?  → yes: reuse, no GitHub reads
        ↓ no
  claim run row (DB unique index prevents a double-click starting two runs)
        ↓
  read tree → select candidates → fetch manifests → detect → persist
        ↓
  Repository intelligence: Ready
  Stack · Infrastructure · Product signals · Routes · counts
  [Refresh repository intelligence]
```

`Analyze business` remains disabled, with helper text clarifying it will consume repository intelligence later. Repository inspection and business analysis stay clearly distinct.

## Permission upgrade

If GitHub denies contents access, the failure is the typed `github_contents_permission_required` — never an HTTP 500. The UI says:

> Vibe Business needs read-only access to repository contents to inspect this project.
> **[Update GitHub access]** → `https://github.com/settings/installations`

See [docs/setup/github-app.md](../setup/github-app.md) for the exact manual approval workflow.

## Acceptance criteria

All met unless noted:

1–9. GitHub App requires only Metadata + Contents read; ownership verified from persisted data before any GitHub call; installation authentication used; no cloning; no execution; sensitive contents never fetched; binary/generated avoided; explicit budgets; large/truncated repositories degrade gracefully. ✅
10–14. Head SHA captured; snapshot versioned; persisted under RLS; no raw source persisted; reuse on unchanged SHA + analyzer version. ✅
15–20. Stack, infrastructure, route and business-surface detection with evidence and deterministic confidence. ✅
21–23. Project UI displays intelligence; missing-permission UI state; audit events. ✅
24–29. Tests, lint, typecheck, build, secret scan pass; no AI dependency introduced. ✅
30. No repository write permission exists. ✅
31. Real repository test — **pending** the manual permission upgrade and migration (see below).

## Validation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass. Build verified with **zero environment variables** configured.
- Analyzer, detectors and path policy are covered by unit tests against in-memory fixtures — **no real GitHub calls in CI**.
- Security tests specifically assert: a project the user does not own is rejected *before* any GitHub client is constructed; repository identity comes from persisted data, never caller input; `.env`/credential contents are never fetched; secret values and dependency versions never appear in a serialized snapshot; audit metadata contains no token/secret.
- Migration reviewed (RLS on the new table, FKs, check constraints, indexes, the in-flight unique index) but **not executed against a live database** — the Supabase project for Vibe Business is not linked to any tooling in this environment. See Manual setup.
- **The live end-to-end run through the GitHub API has not been performed.** No GitHub App credentials exist in the local environment (they live in Vercel), and the run additionally requires the permission upgrade and migration below. Not claimed as passing.

### Detector validation against this repository (local harness)

The analyzer *was* run against `TobiB1505/Vibe-Business`'s real file tree and real file contents, through a temporary local harness that substitutes the filesystem for the GitHub adapter. This exercises every detector and the full pipeline on real data; it does **not** exercise the GitHub API adapter, authentication, persistence, or RLS.

Result at commit `1d17478`: Next.js (high), TypeScript (high), React (medium), pnpm, Node ≥20.9.0, Supabase (database), Supabase Auth, App Router with all 6 page routes and both API routes correct, Authentication and Dashboard surfaces detected, analysis `complete` — from **1 fetched file, 1,011 bytes, ~20 ms**.

The harness found two real detector bugs, both fixed with regression tests:

1. **Monorepo false positive.** A lone `pnpm-workspace.yaml` was treated as a monorepo. In this repository that file exists only to carry pnpm settings (`allowBuilds`), with no `packages:` list — a common pattern in single-package repos. Monorepo detection now requires corroborating structure (an `apps/`/`packages/` layout, or more than one `package.json`). This also removed a spurious `partial` completeness verdict.
2. **Supabase Auth false negative.** Authentication was reported as not detected despite being core to this app, because the auth rule only knew the `auth-helpers` packages. `@supabase/ssr` — whose entire purpose is cookie-based Supabase Auth sessions — is now recognised as auth evidence.

A third detector bug surfaced later, during the [Sprint 8](0008-opportunity-engine.md#what-did-not) production dogfood:

3. **robots.txt / sitemap false positive.** Both surfaces matched *any* file named `robots.*` or `sitemap.*` anywhere in the tree, so this repository's own robots.txt and sitemap **parsers** (`src/modules/live-product-intelligence/`) were reported as the product serving `/robots.txt` and `/sitemap.xml` — directly contradicting the live crawl, which correctly reported both missing. A downstream opportunity was generated whose stated problem was false. All three file-backed surfaces now match only locations a framework actually serves from: a static directory (`public/`, `static/`), the repository root, or the Next.js App Router file conventions, each optionally under a monorepo workspace.

`seo_metadata` shared the flaw and was corrected with it — `icon.tsx` is among the most common component names in a React codebase, and `manifest.json` names a browser extension at least as often as a web app manifest. Metadata images now count only inside the router (`app/blog/opengraph-image.png`, at any routable depth, since these apply per route segment), excluding `_private` directories that Next.js does not route at all; a bare repository-root `manifest.json` no longer counts, while the unambiguous `site.webmanifest` still does.

`ANALYZER_VERSION` moved to `repo-intelligence-v2` so stored snapshots carrying the old rules are not reused.

Known true negatives (correct, not bugs): Vercel is not detected because this repository has no `vercel.json` (deployment runs through the Git integration), and payments/analytics/SEO surfaces are genuinely absent.

## Manual setup

1. **GitHub App** — add `Contents: Read-only` and approve the updated permission on the existing installation ([docs/setup/github-app.md](../setup/github-app.md) §2).
2. **Database** — apply `supabase/migrations/20260809225438_repository_intelligence.sql` to the Vibe Business Supabase project.

## Risks / limitations

- **Synchronous execution.** Analysis runs inside the request. Budgets keep it bounded (≈2–4 GitHub calls, ~1 fetched file for a typical repository), which should sit comfortably inside Vercel's limits. If a real repository ever exceeds them, that is a genuine finding to report — a queue must **not** be introduced silently, since background-job technology remains a deferred decision ([ARCHITECTURE.md §7](../../ARCHITECTURE.md#7-deferred--open-decisions)).
- **Monorepos are detected, not deeply analysed.** Apps and packages are listed; each package is not separately analysed. Ambiguity is recorded rather than guessed.
- **Route detection is Next.js-only.** Everything else reports `limited` by design.
- **Detection is rule-based**, so an unusual stack yields fewer detections rather than wrong ones. That is the intended failure mode — false negatives over false positives.
- **The `apps/`+`packages/` convention alone** is treated as monorepo evidence even without workspace tooling. This is a deliberate heuristic; it is reported with its evidence so a wrong call is visible.
- **No webhooks** — installation lifecycle changes are still only noticed on the next GitHub call. Unchanged from Sprint 1, where it is documented as an immediate follow-up.
