# Vibe Business — Architecture

Status: V0.1 implemented. This document is the **map and the index** — how the pieces fit together, and where the decision behind each one is recorded. It is never a second copy of an ADR: where a decision is confirmed, the ADR is the source of truth for its context and consequences, and [§8](#8-decision-index) lists every one of them.

Read the markers as three distinct states:

- **[Confirmed — ADR NNNN]** — decided and built. The ADR says why; the named module is where it lives.
- **[Confirmed principle]** — a rule this architecture holds itself to, enforced somewhere concrete.
- **[Open decision]** — genuinely undecided. [§7](#7-deferred--open-decisions) is the register of these and nothing else; work that is merely unbuilt belongs in [docs/ROADMAP.md](docs/ROADMAP.md), not here.

This document must be true at HEAD. When a sprint makes a sentence in it false, correcting it is part of that sprint — see [ADR 0039](docs/decisions/0039-documentation-currency.md).

---

## 1. Overall Shape

**[Confirmed — ADR 0001]** V0.1 is a **modular monolith** built with **Next.js (App Router) + TypeScript**. Frontend, server-side logic, Route Handlers, and webhooks live in one codebase and one deployable application. No separate backend framework is introduced for V0.1. See [0001-modular-monolith.md](docs/decisions/0001-modular-monolith.md).

**[Confirmed — ADR 0002]** Data storage is **Supabase Postgres**; user authentication is **Supabase Auth**. See [0002-supabase-postgres-and-auth.md](docs/decisions/0002-supabase-postgres-and-auth.md).

**[Confirmed — ADR 0004]** The Vibe Business application is hosted on **Vercel**. See [0004-vercel-as-initial-host-and-preview-provider.md](docs/decisions/0004-vercel-as-initial-host-and-preview-provider.md).

**[Confirmed principle]** GitHub is the central integration layer. The system is designed to work with repositories regardless of which tool originally generated the code, as long as the repository is reachable via a supported Git provider.

**[Confirmed principle]** The system must not become architecturally locked to a single AI provider or model. Provider-specific logic sits behind an `AIProvider` boundary — see [§3.6](#36-ai-execution-layer) and [0005-ai-provider-abstraction.md](docs/decisions/0005-ai-provider-abstraction.md).

---

## 2. Core Flow

**[Confirmed principle]** The system implements this pipeline, corresponding to the Core Loop in [PRODUCT.md](PRODUCT.md#6-core-user-flow):

```
Onboarding
  → Repository Intelligence · Live Product Intelligence · Deep Scan (optional)
  → Product Understanding
  → Business Readiness Audit
  → Opportunity
  → Action Plan
  → Execution Contract  (an immutable spec + a compiled policy)
  → Agent Execution     (in an isolated sandbox, with an explicitly named tool set)
  → Prepared Change     (a commit on an isolated branch)
  → Independent Validation
  → Preview
  → Approval            (bound to one exact commit)
  → Merge               (fast-forward, verified by read-back)
  → Outcome Verification
  → Business Measurement
```

The three intelligence sources run in parallel and stay separately versioned — the disagreement between them is itself signal ([§3.3](#33-live-product-analysis-layer)). Everything from Execution Contract onwards runs as a durable operation ([§4](#4-cross-cutting-concerns)), not inside the request that started it.

Each stage below is described as a logical layer/responsibility inside the modular monolith (ADR 0001), not as a separate service.

---

## 3. Logical Layers

### 3.1 GitHub Integration Layer

**[Confirmed — ADR 0003]** Repository access is implemented via a **GitHub App** — not personal access tokens, not a token-paste flow, not GitHub OAuth App as the primary mechanism. Least privilege applies: **permissions are requested only when a concretely implemented feature needs them.** Currently granted: **Metadata (read)** for repository discovery (Sprint 1) and **Contents (read and write)** — read for repository intelligence (Sprint 2), write because execution creates the branch and commit a prepared change lands on (`src/modules/execution/github/adapter.ts`) and an approved merge fast-forwards the default branch (`src/modules/merge/github/adapter.ts`). **Pull Requests is still deliberately not requested**: Vibe delivers an approved change by moving a ref, never by opening a PR. Both write paths check the permission the installation *actually carries* rather than what the App requested, and refuse when it is not `write`. Installation access tokens are short-lived; no unnecessary GitHub access tokens are persisted long-term. See [0003-github-app-integration.md](docs/decisions/0003-github-app-integration.md) and [docs/setup/github-app.md](docs/setup/github-app.md).

**[Confirmed principle]** Must never write to the default/main branch as part of an autonomous flow. Merges to default require the explicit approval step in the Approval Layer ([§3.10](#310-approval-layer)).

**[Confirmed principle]** Responsible for: authenticating via the GitHub App, listing/selecting installed repositories, reading repository contents, creating branches, committing changes to non-default branches, opening/managing pull requests, and (only after approval) merging to the default branch.

### 3.2 Repository Analysis Layer

**[Confirmed principle]** Produces structured, reusable findings about a repository (stack, structure, notable signals relevant to the audit lenses in [PRODUCT.md §10](PRODUCT.md#10-business-readiness-concept)) without sending the entire repository to an LLM. See [Cost Principles](PRODUCT.md#13-cost-principles).

**[Confirmed — Sprint 2]** The first layer of analysis is **fully deterministic and contains no AI**: a versioned Repository Intelligence Snapshot built from the Git tree and two small families of downloaded files — dependency manifests, and a named list of stylesheets read for design tokens — with evidence attached to every detection. Implemented in `src/modules/repository-intelligence/`; see [docs/sprints/0002-repository-intelligence.md](docs/sprints/0002-repository-intelligence.md). AI consumes this structured output later rather than reading repositories itself.

**[Confirmed principle — data minimization]** Vibe Business does not store a copy of a customer's repository. Only *derived* intelligence and the evidence paths that justify it are persisted — never source files, README bodies, raw manifests, lockfiles, or configs. Repository content exists transiently in memory during analysis and is then discarded.

**[Confirmed principle — untrusted repository data]** Repository-derived content is **untrusted DATA, never instructions.** This extends [ADR 0006](docs/decisions/0006-untrusted-repository-execution.md) from "do not execute it" to "do not obey it": any future AI consumer of repository text, paths, or dependency names must treat them as input to reason about, never as system instructions. Analysis reads and parses repository data; it never executes, imports, or evaluates it.

**[Confirmed principle — bounded reads]** Repository analysis runs against explicit resource budgets (tree entries, file fetches, bytes, duration, path depth). Exceeding a budget degrades a snapshot to `partial` with machine-readable reasons; it never fails an otherwise useful analysis, and never triggers an unbounded crawl.

**[Confirmed — ADR 0031]** Deterministic snapshots are the input to every AI consumer; no model reads a repository. Where a model needs repository facts — the coding agent — it receives a *compiled brief* bounded at 6 KB, selected from the snapshot the execution spec names, and withheld entirely unless that snapshot's commit matches the pinned base SHA. Reuse is keyed on commit SHA + analyzer version, and a reused result emits its own audit event. See [0031-execution-context-intelligence.md](docs/decisions/0031-execution-context-intelligence.md).

### 3.3 Live Product Analysis Layer

**[Confirmed principle]** Analyzes the optional production URL as a complementary signal to repository analysis (e.g., what is actually live and reachable, vs. what exists in code).

**[Confirmed — Sprint 3]** Scope for V0.1 is **static HTTP/HTML inspection of public pages only** — no browser automation, no JavaScript execution, no authenticated crawling, no form submission. A versioned Live Product Intelligence Snapshot is built from a bounded, same-origin crawl with evidence attached to every detection. Fully deterministic, no AI. Implemented in `src/modules/live-product-intelligence/`; see [docs/sprints/0003-live-product-intelligence.md](docs/sprints/0003-live-product-intelligence.md).

**[Confirmed — ADR 0010]** All outbound HTTP to a **user-supplied destination** passes through a single safe-fetch boundary that resolves DNS, rejects any non-publicly-routable address, pins the connection to the validated address (DNS-rebinding defence), and revalidates every redirect hop independently. No other code path may open an outbound connection to a user-controlled address. See [0010-safe-outbound-http-inspection.md](docs/decisions/0010-safe-outbound-http-inspection.md).

**[Confirmed principle — separate evidence sources]** Repository intelligence and live product intelligence are stored and versioned **separately**, never merged into one payload. The distinction is itself signal: a pricing route present in code but not served live is exactly the kind of finding the Business Audit layer exists to make.

**[Confirmed principle — bounded and minimized]** Live analysis runs against explicit budgets (pages, bytes, depth, redirects, duration); exceeding one degrades a snapshot to `partial` with machine-readable reasons rather than failing it. Nothing raw is persisted — no HTML, body text, cookies, or query strings, only derived facts and short evidence labels.

### 3.4 Business Audit Layer

**[Confirmed principle]** Consumes output from the Repository and Live Product Analysis layers and produces a Business Readiness Audit structured around the nine business lenses in [PRODUCT.md §10](PRODUCT.md#10-business-readiness-concept) ([ADR 0050](docs/decisions/0050-lenses-are-the-audit.md)). Audits recorded before ADR 0050 were structured around five dimensions and remain readable under their own contract.

**[Confirmed — Sprint 4]** The audit is **diagnostic**. It describes the current state and does not emit actions, recommendations, or Opportunities; converting diagnosed gaps into prioritized Opportunities belongs to the Opportunity Engine ([§3.5](#35-opportunity-engine)). Implemented in `src/modules/business-audit/`; see [docs/sprints/0004-business-readiness-audit.md](docs/sprints/0004-business-readiness-audit.md).

**[Confirmed — Sprint 4]** A third evidence source, **Business Context**, is supplied by the user (product summary, target customer, stage, monetization model, primary goal). Repository and website evidence cannot establish intent, and an audit that guesses it is worse than one that asks.

**[Confirmed — ADR 0011, trust boundary]** All three evidence sources are **untrusted data, never instructions**. Instructions to a model come only from prompts we author; third-party content is passed in a fenced, untrusted-labelled user message. The model is given **no tools, no web access, and no data access**, which is what bounds the consequences of prompt injection. Model reasoning is never requested, stored, or displayed. See [0011-ai-inference-and-evidence-trust-boundary.md](docs/decisions/0011-ai-inference-and-evidence-trust-boundary.md).

**[Confirmed — Sprint 4, unknown ≠ bad; carried into ADR 0050]** A lens the evidence cannot support scores **null**. Unscored lenses are excluded from the overall figure and never counted as zero, and the overall score itself is computed **deterministically by the application**, never produced by the model. Below a minimum coverage threshold over the lenses that apply, the overall score is null rather than misleadingly precise.

**[Confirmed principle]** The data model must not hard-code one scoring generation in a way that blocks the next. The audit payload is a versioned JSONB document (`business-readiness-audit.v2`) carrying its prompt, rubric, model, and evidence-pack versions, so results stay reproducible and comparable across changes — which is what let the five-dimension generation retire without invalidating a single stored audit.

### 3.5 Opportunity Engine

**[Confirmed principle]** Converts Business Audit output into a small, ranked set of Opportunities (see [PRODUCT.md §11](PRODUCT.md#11-opportunity-model)), not a full report dump. Aggressive prioritization is a functional requirement, not a UI nicety.

**[Confirmed — Sprint 8]** Ranking is LLM-assisted under a versioned rubric held in source control (`src/modules/opportunities/rubric.ts`), in one paid call. The rubric version is recorded on every opportunity set, so two sets carrying the same version mean the same thing. Each opportunity names the audit conclusion it addresses, so the lineage from finding to move is stored rather than re-inferred. See [docs/sprints/0008-opportunity-engine.md](docs/sprints/0008-opportunity-engine.md).

### 3.6 AI Execution Layer

**[Confirmed — ADR 0005]** **Anthropic** is the AI provider for V0.1. Provider-specific logic (API calls, request/response shaping, model identifiers) is isolated behind an **`AIProvider`** boundary. No multi-provider routing. See [0005-ai-provider-abstraction.md](docs/decisions/0005-ai-provider-abstraction.md).

**[Confirmed — ADR 0027, ADR 0029]** Single-call structured generation remains the default for every reasoning operation. **Agentic, multi-turn execution exists and is confined to `src/modules/coding-agent/`**, behind its own `CodingAgentProvider` boundary: the harness runs inside the execution's own sandbox holding no long-lived credential, and reaches the provider only through the Agent Gateway, which injects the real key and refuses everything else. What the agent may do is an explicitly named tool set — there is no web tool and no MCP server — and what it did is verified by Vibe's own observation, never by its account of itself.

**[Confirmed — Sprint 4]** The interface is now implemented in `src/modules/ai/provider.ts` as **generic structured generation** (`countInputTokens`, `generateStructured`) rather than per-domain methods, so a new AI operation is a new caller rather than a change to every adapter. Only `src/modules/ai/anthropic/` may import a provider SDK. Model identifiers and effort levels live solely in `src/modules/ai/operations.ts`; nothing user-supplied may select a model.

**[Confirmed principle]** Every AI job runs against a hard budget and is logged for usage/cost (see [§3.11](#311-usagecredit-layer)). **[Confirmed — Sprint 4]** Input tokens are counted *before* every paid call and gated against an explicit budget; actual usage is recorded afterwards for successes and failures alike, and only when tokens were genuinely billed.

### 3.7 Git Branch / Change Layer

**[Confirmed principle]** All AI-authored code changes land on an isolated, non-default branch (via the GitHub Integration Layer). What that layer may do to a ref is deliberately narrower than a lifecycle: it **creates** an execution branch and commits to it, and that is all. There is no update, no force-update, no rewrite and no delete — `merge/git-port.ts` and `execution/git-port.ts` have no `updateRef` and no `deleteRef` at all, which is an absent capability rather than a denied one ([rule 71](CLAUDE.md), [rule 76](CLAUDE.md)). The one ref Vibe ever moves is the default branch, by fast-forward to one approved commit — see [§3.10](#310-approval--merge-layer). A prepared change a founder rejects is discarded as a *row*; its branch stays, and removing it is the repository owner's to do.

### 3.8 Build & Validation Layer

**[Confirmed — ADR 0006, security principle]** Repository code is **untrusted**. It must execute only in isolated, ephemeral environments with tightly scoped credentials and lifecycle — never directly inside the Vibe Business application process. This explicitly rules out running `npm install`, npm scripts, arbitrary shell scripts, build scripts, test scripts, postinstall hooks, or repository-provided executables in-process. See [0006-untrusted-repository-execution.md](docs/decisions/0006-untrusted-repository-execution.md).

**[Confirmed — ADR 0015]** The provider is **Vercel Sandbox**: one Firecracker microVM per validation, created for that run and destroyed after it, cloning the pinned commit itself so no working copy ever exists in a Vibe process. The network is closed before any repository-controlled command runs, and the environment carries no credential — a build that needs one fails rather than being given one. Implemented in `src/modules/validation/vercel/`. See [0015-untrusted-repository-execution-provider.md](docs/decisions/0015-untrusted-repository-execution-provider.md).

**[Confirmed principle]** Every proposed change is built and tested before it is presented to the user as a preview. A change that fails to build or fails tests must not reach the Preview Layer as a viable proposal.

**[Confirmed — ADR 0015, ADR 0036]** "Tested" means the repository's **own** `install`, `typecheck`, `test` and `build`, resolved from the repository intelligence snapshot by `resolveValidationProfile`. No smoke tests are generated. Depth is risk-adaptive and is part of the validation identity, so a `fast` pass can never be reused to answer a `deep` question. A pass means those commands exited zero in an isolated VM — never that a change is safe, correct, reviewed or ready ([CLAUDE.md](CLAUDE.md) rule 66).

**[Confirmed — Stufe 4]** The profile is a **build contract**, not a framework list. `node_build_v1` admits an application with a `build` script and a lockfile in its own directory that Vibe can install from exactly — which is what those commands need — rather than one whose manifest declares `next`. The framework check narrowed which repositories could be checked without sharpening what the check claimed, and because `resolveExecutionValidation` asks the same function, it decided which repositories could run an agent at all. Every refusal now names the missing thing, and the directory a run validated is recorded on the row and hashed into the identity, so a pass says *what* passed and where. `nextjs_node_v1` stays legal and is resolved by nothing: a stored pass was checked under the old rules and is not reinterpreted under today's.

### 3.9 Preview Layer

**[Confirmed — ADR 0016, amended by ADR 0064]** A preview **clones the prepared commit** into its own fresh sandbox, installs, and serves it on a temporary URL under a development server. It is not a deploy: nothing enters the customer's hosting and the environment grants nothing. It is also not the checked build — it runs *alongside* validation rather than after it, so a person can look while the five-minute check is still going, and the product says so wherever a preview is offered. Implemented in `src/modules/change-preview/`. The `PreviewProvider` boundary from [ADR 0004](docs/decisions/0004-vercel-as-initial-host-and-preview-provider.md) was left unimplemented deliberately — deploying needs authority this product does not have; see `src/modules/previews/README.md` for the comparison.

**[Confirmed — ADR 0064]** No filesystem artifact is captured, restored or retained any more. Validation stops at its result, and 24 hours of a customer's file tree no longer sits at the provider for a preview that will not use it.

**[Confirmed — ADR 0063]** A preview is not always the right instrument. `review/classification.ts` decides deterministically — from verified changed paths, the analyzer's route table and a structural render-impact proof, with no model call — whether a change deserves a preview, a code diff, or both. A change that alters no rendered page is asked for neither preview nor comparison.

**[Confirmed — ADR 0065, completed by ADR 0075]** For a change that *does* alter a page, the preview **is** the review. Screenshot comparison ([ADR 0017](docs/decisions/0017-visual-review-artifacts.md)) photographed one route at one viewport, which is a poorer instrument than the running application it photographed, and Vibe paid a browser session for the reduction. 0065 made the path unreachable; [ADR 0075](docs/decisions/0075-the-photograph-nobody-took.md) deleted it once the last artifact passed its retention. Nothing in `review/` opens a browser any more. The read path stays, because one historical approval rests on a comparison and an approval nobody can audit is not one.

**[Narrowed — Stufe 4]** The server command comes from a table keyed on the frameworks the chosen application's own manifest declares — `next dev`, `nuxt dev`, `astro dev` — rather than from its validation profile, which stopped implying a framework when one profile came to admit every Node application. An application with no row gets **no preview**, and the copy says what that means: checking a change and merging it still work; there is nothing to look at.

**[Open decision]** Which servers earn a row. Vite and SvelteKit are the ones that matter and are held back deliberately: Vite ≥ 5.4.12 refuses requests whose `Host` is not in `server.allowedHosts`, and the health probe reaches the server over loopback — so it *passes* while the customer's public URL answers "Blocked request." That is settled by a real preview against a real project, not by an argument. Remix is open for a different reason: `remix dev` and the Vite plugin are two servers behind one framework id.

### 3.10 Approval Layer

**[Confirmed principle]** Enforces the permission boundary defined in [PRODUCT.md §9](PRODUCT.md#9-approval-model). Merge to the default branch is only ever triggered by an explicit, attributable user approval action recorded in the Audit Log — never inferred, defaulted, or timed out into approval.

**[Confirmed — ADR 0018, amended by ADR 0063]** An approval binds to an **immutable artifact identity** — project, prepared change, commit, base, validation run, **the evidence a person was shown**, and policy version, hashed, with a partial unique index on it. There is no `approved = true` and no "latest" lookup: change any part of the artifact and the old consent no longer covers it. Repository drift *after* an approval never rewrites what a human decided; it makes the merge unsafe, which is a different question asked at a different time.

**[Confirmed — ADR 0063, amended by ADR 0065]** The evidence takes one of three forms, and the review classification decides which. A change that alters no rendered page names a `code_review_digest` — a hash of the two commits, the shown paths and the diff policy version. A change that alters one names that digest **and** the `preview_sessions` row of the same commit: the sandbox is gone in fifteen minutes, the row is immutable and says an interactive preview of exactly these bytes ran and became reachable. A third form, a review artifact, exists only on historical rows. The diff is the *stronger* binding: two immutable commits reproduce it byte for byte indefinitely, while review images expire and their "before" side is production as it was — which is why the diff is now part of every new approval, visual or not. Three database CHECKs admit exactly those three shapes and no fourth. The merge gate reads the form off the approval row rather than re-asking the classification, because the analyzer's route table moves and a standing human decision must not become unfindable because of it.

**[Confirmed — ADR 0019]** That second question is answered immediately before the write: Vibe fast-forwards the default branch to exactly the approved commit or refuses. Never a force-update, never a rewrite, never a merge or rebase to resolve drift, and the attempt is marked before it is made so an ambiguous outcome is resolved by *reading* rather than by writing again. `merged` means one sentence — the default branch points at the approved commit and Vibe read it back. Implemented in `src/modules/approvals/` and `src/modules/merge/`.

### 3.11 Usage/Credit Layer

**[Confirmed principle]** Records the per-job usage schema defined in [PRODUCT.md §12](PRODUCT.md#12-credit-model) (`provider`, `model`, `input_tokens`, `output_tokens`, `provider_cost`, `tool_cost`, `vibe_credits_charged`, `job_id`, `user_id`, `timestamp`) for every AI job. Vibe Credits charged to the user are decoupled from raw provider cost in the data model, even if V0.1 uses a simple conversion.

**[Confirmed — Sprint 4]** The **internal provider-cost half** of this layer exists as `ai_usage_events`: provider, model, operation, token counts, latency, status, failure code, and a cost derived from **effective-dated** model pricing using integer arithmetic (floats cannot represent sub-cent amounts exactly). It is insert-only under RLS and not readable through the public API — provider billing detail is not customer-facing. Three sibling ledgers meter what tokens cannot: `sandbox_usage_events`, `deep_scan_provider_usage`, `review_browser_usage`. A cost Vibe does not know is recorded as unknown, never as zero.

**[Confirmed — ADR 0024, ADR 0025]** The customer-facing **Vibe Credit ledger** exists: an append-only ledger with a materialized balance as its admission gate, grant lots spent expiring-soonest-first, and reserve → settle-or-release around every billable operation, each step under a unique idempotency key. Stripe is a funding rail only — the Credit amount is never read from a webhook payload, it is looked up from `src/modules/billing/catalog.ts`. Implemented in `src/modules/credits/` and `src/modules/billing/`.

**[Confirmed — ADR 0038]** `src/modules/economy/` reads those ledgers and estimates what a run will cost *before* it starts, then measures how wrong that estimate was. It writes nothing, activates nothing, and is forbidden by test from importing billing.

The one thing deliberately absent: **no consumption rate card is active.** `CREDIT_RATE_CARDS` ships empty, and unrated usage resolves to `rate_card_not_configured` with a null Credit amount rather than to zero (ADR 0024 §8).

**[Confirmed principle — no secrets in the ledger]** Usage events never contain prompt text, model responses, reasoning, or API keys.

**[Confirmed — ADR 0061, re-derived by ADR 0062]** What a Credit buys per operation *is* decided: `launch-v1` in `src/modules/credits/retail.ts` prices Business Audit at 35, Next Moves and Action Plan at 20, an additional Deep Scan at 25, and an agent improvement at 150 / 200 / 350 by execution pricing class, effective `2026-09-01T00:00:00.000Z`. `src/modules/credits/margin-guard.ts` recomputes every price's contribution margin from the provider rates in force at the instant it is asked, applied to frozen production quantities, and fails below 70% — which is how the card came to be re-derived: it was first priced against a scheduled Sonnet 5 rise to $3/$15 that Anthropic then withdrew, and the guard showed those prices to be ~57% too high. Prices carry a `PriceBasis`: three are `measured`, the Agent is `modelled` (its `complex` tier has zero cost observations), and Deep Scan is `policy` — it stays `policy` after [ADR 0076](docs/decisions/0076-the-browser-we-own.md), which built the instrument rather than taking the measurement: a scan's browser is now a Vercel sandbox whose rate is founder-attested, `terminateSession` reports the dimensions and `estimateSandboxCost` derives a figure, but no scan has yet run under it, so no row carries one. The estimate for the five recorded session shapes is $0.0007–$0.0116 against $0.441 of revenue; the basis moves when rows exist, not when the code that would fill them does.

### 3.12 Audit Log

**[Confirmed — ADR 0007]** A **Postgres-based, append-only application audit log** (`audit_events`), stored in the same Supabase Postgres instance as the rest of the application. It records business-meaningful actions — `repository.selected`, `business_audit.completed`, `opportunities.completed`, `agent_execution.started`, `change_validation.passed`, `change_preview.running`, `change_approval.created`, `change_merge.default_branch_updated`, `credit_charge.settled` — and does not replace normal application or error logs. The vocabulary is a closed list in `src/modules/audit-log/events.ts`; that file is authoritative, not this paragraph. See [0007-audit-log.md](docs/decisions/0007-audit-log.md).

---

## 4. Cross-Cutting Concerns

**[Confirmed principle]** Cost awareness applies across every layer that calls an LLM (Analysis, Audit, Opportunity Engine, AI Execution). See [PRODUCT.md §13](PRODUCT.md#13-cost-principles): targeted context over full-repo dumps, caching, model routing by task difficulty — implemented as per-operation model and effort selection in `src/modules/ai/operations.ts`, the only file permitted to name a model — hard per-job budgets, usage logging from day one.

**[Confirmed — ADR 0008]** Secrets (GitHub App private key/secret, Supabase service credentials, Anthropic API key, webhook secrets) are managed server-side via the hosting environment — **Vercel Environment Variables / Secret Configuration** for V0.1. Secrets must never be committed to Git, sent to client components, stored in public environment variables, written to application logs, included in AI prompts (unless unavoidable and specifically designed to be safe), or stored unencrypted as plain application fields. Any future persisted third-party/user credentials require a separate, dedicated secrets design. See [0008-secrets-management.md](docs/decisions/0008-secrets-management.md).

**[Confirmed — ADR 0022]** Application error monitoring and baseline tracing use **Sentry** through `@sentry/nextjs` across the browser, Node.js, and Edge runtimes. Default PII collection is disabled; Session Replay, Logs, Profiling, Metrics, and AI monitoring are not enabled by this decision. Production source maps and releases are uploaded only from authenticated builds. See [0022-sentry-observability.md](docs/decisions/0022-sentry-observability.md).

**[Confirmed — ADR 0041]** Advertising attribution uses the **Meta Pixel**, mounted by the root layout inside two boundaries enforced in code: production deployments only (a Preview or development build ships no Meta script at all) and public pages only (the tag is absent on `/app` and below, so the project identifiers in those paths never reach an advertising network). `PageView` is the only event sent, and no user data is passed to `fbq`. Implemented in `src/lib/analytics/meta-pixel.ts` and `src/components/analytics/meta-pixel.tsx`. See [0041-marketing-attribution-pixel.md](docs/decisions/0041-marketing-attribution-pixel.md).

**[Confirmed principle]** Security-sensitive integrations (GitHub auth, tokens, webhooks, credentials) use least privilege and are never committed to the repository. See [CLAUDE.md](CLAUDE.md).

**[Confirmed — ADR 0013]** Background/asynchronous work runs as **durable operations on Vercel Workflows** — plain async TypeScript under a `"use workflow"` directive, with no separate queue, worker or scheduler service. The pipeline in [§2](#2-core-flow) cannot run synchronously within one request, and a durable operation owns its own lifetime: an `operation_runs` row survives the request that started it. **[Confirmed — ADR 0037]** one durable operation may enqueue the next. Implemented in `src/modules/operations/`. See [0013-durable-operation-execution.md](docs/decisions/0013-durable-operation-execution.md). A *further* background technology beside it still requires a new ADR ([CLAUDE.md](CLAUDE.md) rule 24). **[Confirmed — ADR 0069]** exactly one such ADR exists: `pg_cron` runs the daily retention sweep, because a retention period needs a clock and neither Workflows nor any read-triggered pattern provides one. It is a Postgres extension rather than a service, it executes no application code, and it is not an execution path — a durable customer operation is still a Workflow.

---

## 5. Module Boundaries (within the Monolith)

**[Confirmed — ADR 0001]** Logical modules, living together in one Next.js/TypeScript codebase per ADR 0001:

| Group | Modules |
|---|---|
| Account and project | `auth` · `projects` · `onboarding` · `github` |
| Intelligence | `repository-intelligence` · `live-product-intelligence` · `authenticated-product-intelligence` · `product-understanding` |
| Reasoning | `business-audit` · `opportunities` · `action-plans` |
| Execution | `execution-contract` · `execution-context` · `coding-agent` · `execution` |
| Verification and delivery | `validation` · `change-preview` · `review` · `approvals` · `merge` |
| Measurement | `outcome-verification` · `business-measurement` |
| Platform | `operations` · `ai` · `audit-log` |
| Economics | `credits` · `billing` · `economy` |

Three names are **reserved and never used**: `audits`, `previews` and `usage` each contain a README and no code, superseded by `business-audit`, `change-preview`, and `ai/usage.ts` plus the four provider ledgers respectively. Each stub says so and points at its replacement.

These are code-organization boundaries, not process/network boundaries, for as long as the modular monolith holds (see ADR 0001 "Revisit when").

---

## 6. Domain Model

**The schema is [supabase/migrations/](supabase/migrations/), and that is authoritative** — 49 tables across 55 migrations. This section names the aggregate roots so a reader can find their way in; it deliberately does not enumerate tables, because a hand-maintained list is wrong at the next migration and would compete with the migrations for the same job.

| Aggregate root | Holds |
|---|---|
| `projects` | the unit everything else scopes to; plus onboarding state, founder intent, and user corrections to what Vibe concluded |
| Intelligence snapshots | one immutable, versioned snapshot per source per run — repository, live product, authenticated Deep Scan — never merged into one payload |
| `product_profiles` | Vibe's understanding of the product, joining those three under one input hash |
| `business_readiness_audits` | the diagnosis, as a versioned JSONB document carrying its own prompt, rubric and evidence-pack versions |
| `opportunity_sets` → `action_plans` | what to do next, and the steps to do it |
| `execution_specs` | the immutable instruction package an execution runs under; database-trigger-protected against mutation |
| `agent_execution_runs` | what one agent run was given, did, cost and produced |
| `prepared_changes` → `validation_runs` → `preview_sessions` → `review_artifacts` | the artifact and everything independently established about it |
| `change_approvals` → `change_merges` | one human decision bound to one commit, and the write it authorized |
| `change_outcome_verifications`, `business_outcome_measurements` | what became true afterwards |
| The four usage ledgers, `billing_credit_*` | what it cost Vibe, and what it cost the customer — separate systems on purpose |
| `audit_events` | the append-only record of business-meaningful actions |

**[Confirmed — ADR 0002]** Multi-tenant scoping and Row Level Security apply to **every** table. The posture escalates with consequence: full CRUD on a project's own rows, insert-and-select with linkage verification on approvals, insert-only with no update path on merges and outcome verifications, select-only on everything financial, and no policy at all on the Stripe event log. Clients cannot write a financial row.

---

## 7. Deferred / Open Decisions

This is the register of genuinely **undecided** questions, and nothing else. Work that is decided but unbuilt belongs in [docs/ROADMAP.md](docs/ROADMAP.md); conflating the two is how eight resolved items sat here for months.

**Still open:**

1. **The per-SKU consumption rate card** — `CREDIT_RATE_CARDS` in `src/modules/credits/rating.ts`, which rates measured provider usage into Credits for Vibe's own cost telemetry. Not the same question as what a customer pays: [ADR 0061](docs/decisions/0061-launch-v1-operation-rate-card.md) decided that and left this alone, because `economy/` already answers "what did this cost" in nanodollars and a card here would have to price cache tokens — 55–70% of agentic provider cost — to avoid returning `sku_not_priced`. It ships empty ([§3.11](#311-usagecredit-layer)).
2. **Analytics provider for the customer's product** — the metric-source port is vendor-neutral by design ([ADR 0021](docs/decisions/0021-business-outcome-measurement.md)) and no adapter is written, so every project resolves to `waiting_for_source`. Vibe's own product analytics is separate and already answered (`@vercel/analytics`), as is Vibe's own ad attribution ([ADR 0041](docs/decisions/0041-marketing-attribution-pixel.md)).
3. **Which development servers earn a row** in the preview table ([§3.9](#39-preview-layer)). Next.js, Nuxt and Astro have one; Vite and SvelteKit wait on a real preview settling their `allowedHosts` behaviour, and Remix on which of its two servers a repository means.
4. **Production hosting migration as a possible future product feature** — not scoped, not committed to.
6. **Whether retained audit history gets an operator read path** — once the owner column is null the surviving rows match no RLS policy, so they are readable by nobody ([ADR 0056](docs/decisions/0056-lifecycle-erasure-and-retention.md) §Deferred). Retention without a reader is storage, not evidence; no admin surface exists to change that.

**Resolved since this list was written:**

5. ~~Retention period for tombstoned financial and anonymized audit records~~ → [ADR 0068](docs/decisions/0068-retention-periods.md): four classes by what the data is for — financial ten years under HGB §257 / AO §147, audit trail eighteen months, operational events ninety days, derived intelligence by count rather than age. The periods are named constants in code and configurable nowhere else. Whether a Credit ledger row is a `Buchungsbeleg` stays open, and ten years is adopted as the safe direction while it is. [ADR 0069](docs/decisions/0069-retention-sweep-trigger.md) then built what enforces it — a daily `pg_cron` sweep — for two of the four classes, and corrected the third and fourth: `operation_runs` cascades into the artifacts an approval binds to and is out of reach of any age sweep, and two tables classed as operational are billing sources.

7. ~~Untrusted Repository Execution Provider~~ → [ADR 0015](docs/decisions/0015-untrusted-repository-execution-provider.md): Vercel Sandbox.
8. ~~Preview integration for non-Vercel-compatible repositories~~ → obsolete as framed. [ADR 0016](docs/decisions/0016-temporary-preview-isolation.md) replaced deployment-based previews with a restored validation artifact, so Vercel compatibility stopped being the constraint.
9. ~~`AIProvider` interface signature~~ → generic structured generation (`countInputTokens`, `generateStructured`), [§3.6](#36-ai-execution-layer).
10. ~~Final database schema~~ → [supabase/migrations/](supabase/migrations/) is the schema, and is authoritative ([§6](#6-domain-model)).
11. ~~Error monitoring / observability provider~~ → [ADR 0022](docs/decisions/0022-sentry-observability.md): Sentry.
12. ~~Long-term storage for large build artifacts~~ → decided by *not* storing them long-term: a validated artifact is a provider snapshot with an explicit expiry, deleted when the preview ends ([ADR 0016](docs/decisions/0016-temporary-preview-isolation.md)); review screenshots live in a private bucket read only through signed URLs ([ADR 0017](docs/decisions/0017-visual-review-artifacts.md)).
13. ~~Background job / queue technology~~ → [ADR 0013](docs/decisions/0013-durable-operation-execution.md): durable operations on Vercel Workflows.

An open decision is resolved by writing an ADR, not by an implementation that quietly assumes an answer ([CLAUDE.md](CLAUDE.md) rules 13, 20).

---

## 8. Decision Index

Every ADR, with the layer it governs. The ADR is the source of truth for its own decision; this index exists so that no decision is invisible from the map, and `src/lib/docs/documentation-currency.test.ts` fails if one is missing.

| # | Decision | Layer |
|---|---|---|
| [0001](docs/decisions/0001-modular-monolith.md) | Modular monolith, Next.js + TypeScript | Overall shape |
| [0002](docs/decisions/0002-supabase-postgres-and-auth.md) | Supabase Postgres and Auth | Storage, identity |
| [0003](docs/decisions/0003-github-app-integration.md) | GitHub App integration, least privilege | §3.1 |
| [0004](docs/decisions/0004-vercel-as-initial-host-and-preview-provider.md) | Vercel as host; `PreviewProvider` boundary | Hosting, §3.9 |
| [0005](docs/decisions/0005-ai-provider-abstraction.md) | `AIProvider` abstraction, Anthropic first | §3.6 |
| [0006](docs/decisions/0006-untrusted-repository-execution.md) | Repository code is untrusted and never runs in-process | §3.8 |
| [0007](docs/decisions/0007-audit-log.md) | Append-only application audit log | §3.12 |
| [0008](docs/decisions/0008-secrets-management.md) | Secrets management | Cross-cutting |
| [0009](docs/decisions/0009-github-installation-ownership-verification.md) | Installation ownership verification | §3.1 |
| [0010](docs/decisions/0010-safe-outbound-http-inspection.md) | Safe outbound HTTP: one SSRF boundary | §3.3 |
| [0011](docs/decisions/0011-ai-inference-and-evidence-trust-boundary.md) | Inference and evidence trust boundary | §3.4 |
| [0012](docs/decisions/0012-authenticated-browser-analysis.md) | Authenticated browser analysis (Deep Scan; provider superseded by 0076, design unchanged) | §3.3 |
| [0013](docs/decisions/0013-durable-operation-execution.md) | Durable operation execution | §4 |
| [0014](docs/decisions/0014-first-execution-safety.md) | First execution safety: model opinion authorizes nothing | §3.6, §3.7 |
| [0015](docs/decisions/0015-untrusted-repository-execution-provider.md) | Vercel Sandbox as the execution provider | §3.8 |
| [0016](docs/decisions/0016-temporary-preview-isolation.md) | Temporary preview isolation (§1, §3, §7, §11 superseded by 0064) | §3.9 |
| [0017](docs/decisions/0017-visual-review-artifacts.md) | Visual review artifacts (superseded as a gate by 0065; capture code deleted by 0075; historical rows only) | §3.9 |
| [0018](docs/decisions/0018-human-approval-authority.md) | Approval binds to an immutable artifact identity (amended by 0063) | §3.10 |
| [0019](docs/decisions/0019-safe-approved-change-merge.md) | Safe approved-change merge | §3.10 |
| [0020](docs/decisions/0020-production-outcome-verification.md) | Production outcome verification (extended by 0071) | Measurement |
| [0021](docs/decisions/0021-business-outcome-measurement.md) | Business outcome measurement | Measurement |
| [0022](docs/decisions/0022-sentry-observability.md) | Sentry for errors and baseline tracing | Cross-cutting |
| [0023](docs/decisions/0023-project-scoped-onboarding-orchestration.md) | Project-scoped onboarding orchestration | Onboarding |
| [0024](docs/decisions/0024-vibe-credits-economic-layer.md) | Vibe Credits economic layer | §3.11 |
| [0025](docs/decisions/0025-stripe-payment-rail-and-credit-grants.md) | Stripe payment rail and credit grants | §3.11 |
| [0026](docs/decisions/0026-agentic-execution-contract.md) | Agentic execution contract | Execution contract |
| [0027](docs/decisions/0027-coding-agent-provider-and-tool-gateway.md) | Coding agent provider and tool gateway | §3.6 |
| [0028](docs/decisions/0028-founder-selectable-action-plan-move.md) | Founder-selectable action plan move | Action plans |
| [0029](docs/decisions/0029-agent-runtime-placement-and-credential-broker.md) | Agent runtime placement and credential broker | §3.6, §3.8 |
| [0030](docs/decisions/0030-agent-execution-observability.md) | Agent execution observability | §4 |
| [0031](docs/decisions/0031-execution-context-intelligence.md) | Execution context intelligence | §3.2 |
| [0032](docs/decisions/0032-agent-verification-and-completion.md) | Agent verification and completion | Execution |
| [0033](docs/decisions/0033-post-implementation-completion-control.md) | Post-implementation completion control | Execution |
| [0034](docs/decisions/0034-execution-surface-and-lifecycle.md) | Execution surface and lifecycle | Execution |
| [0035](docs/decisions/0035-commit-message-compiler.md) | Commit message compiler | §3.7 |
| [0036](docs/decisions/0036-risk-adaptive-validation-depth.md) | Risk-adaptive validation depth | §3.8 |
| [0037](docs/decisions/0037-automatic-validation-and-review-classification.md) | Automatic validation and review classification | §3.8, §4 |
| [0038](docs/decisions/0038-economy-intelligence-layer.md) | Economy intelligence layer (amended by 0072) | §3.11 |
| [0039](docs/decisions/0039-documentation-currency.md) | Where truth lives, and how documentation stays current | This document |
| [0040](docs/decisions/0040-ci-hosted-database-concurrency-gate.md) | Where a real-database concurrency test runs, and what it may reach | §3.11 |
| [0041](docs/decisions/0041-marketing-attribution-pixel.md) | The Meta Pixel, and the two boundaries it runs inside | Cross-cutting |
| [0042](docs/decisions/0042-billing-reconciliation-authority.md) | Billing reconciliation authority: CAS-based finalization authority plus marker-based cache repair, closing drift repair, orphaned holds, stranded lot capacity and zero-credit idempotency (Proposed, unimplemented) | §3.11 |
| [0043](docs/decisions/0043-data-api-privilege-model.md) | Where the Data API's privileges come from: explicit per-table, per-role grants in the repository, replacing an expiring platform default | §3.11 |
| [0044](docs/decisions/0044-evidence-pack-v4.md) | What `business-evidence.v4` is for: the id-polarity migration and a `contradiction.*` namespace in one bump, because each alone invalidates every audit identity | §3.4 |
| [0045](docs/decisions/0045-command-center-information-architecture.md) | The project workspace is a command center, not an admin panel | Web surface |
| [0046](docs/decisions/0046-account-dashboard-and-context-swap.md) | The account level is a dashboard of its own; the sidebar swaps context | Web surface |
| [0047](docs/decisions/0047-business-health-is-project-home.md) | Business Health is the canonical project Home | Web surface |
| [0048](docs/decisions/0048-signature-business-brain.md) | Signature Business Brain view model and interaction | Web surface, read models |
| [0049](docs/decisions/0049-business-lens-diagnostic-scores.md) | Evidence-grounded business-lens diagnostic scores | Business audit, read models |
| [0050](docs/decisions/0050-lenses-are-the-audit.md) | Lenses are the audit's only framework; the overall score is the mean over scored lenses | §3.4 |
| [0051](docs/decisions/0051-project-shell-context-ownership.md) | Project shell context ownership and scroll model | Web surface |
| [0052](docs/decisions/0052-durable-product-scan-discovery-feed.md) | Durable Product Scan and bounded discovery feed | Operations, onboarding, Product page |
| [0053](docs/decisions/0053-founder-input-resolution.md) | Founder-owned input resolution and Action Plan completion evidence | Action plans, project context, execution contract |
| [0054](docs/decisions/0054-agent-action-plan-completion-evidence.md) | Agent Action Plan completion comes from verified execution evidence | Action plans, agent execution, validation |
| [0055](docs/decisions/0055-founder-action-attestation-evidence.md) | Founder actions complete from explicit immutable attestation | Action plans, founder authority, completion evidence |
| [0056](docs/decisions/0056-lifecycle-erasure-and-retention.md) | Lifecycle, erasure and retention: what a deletion destroys, what outlives the person, and under whose authority (Accepted; all six migration families, the eleven-step erasure operation and the account settings control implemented) | Projects, account, §3.11, §3.12, storage |
| [0057](docs/decisions/0057-account-level-durable-operations.md) | Account-level durable operations, and how an erasure outlives itself (Accepted, extends 0013) | Operations, `operation_runs`, RLS |
| [0058](docs/decisions/0058-move-focus-url-contract.md) | Move focus is a shared URL contract, never authority: one parameter names which Move a surface is about, resolved against stored Moves and never permitting work (Accepted; Action Plan, Agent and both next-move cards implemented) | Action Plan, Agent, project shell |
| [0059](docs/decisions/0059-security-response-headers.md) | Security response headers, and a CSP that starts by watching rather than enforcing (Accepted; six headers live, CSP report-only — it protects nothing until enforced) | HTTP responses, `next.config.ts`, CSP |
| [0060](docs/decisions/0060-sign-in-throttle-authority.md) | The sign-in throttle's authority is who may call it (Accepted; `record_auth_attempt` unreachable through the Data API, one reviewed service-role site) | Sign-in, `auth_attempt_windows`, rule 53 |
| [0061](docs/decisions/0061-launch-v1-operation-rate-card.md) | What a Credit buys, and what each number is worth trusting (Accepted; rate table amended by 0062, settlement timing by 0073. `launch-v1` prices every customer-facing operation, each with a `PriceBasis`) | Credits, retail prices, execution budgets, §3.11 |
| [0062](docs/decisions/0062-sonnet-5-price-rise-cancelled.md) | A cancelled provider price is deleted, not held (Accepted; amends 0061. The Sonnet 5 rise to $3/$15 was withdrawn, so the row is gone and a permanent regression test keeps it gone; `launch-v1` re-derived to 35 / 20 / 20) | `ai/pricing.ts`, margin guard, §3.11 |
| [0063](docs/decisions/0063-review-classification-as-a-gate.md) | The review classification becomes a gate, and a diff becomes approval evidence (Accepted; supersedes 0037 §2's "advisory", amends 0018. A change altering no rendered page is approved on a reproducible diff instead of two identical screenshots) | Review, approvals, `change_approvals`, prepared-change card |
| [0064](docs/decisions/0064-preview-before-validation.md) | The preview comes before the check, and serves the commit (Accepted; supersedes 0016 §1, §3, §7, §11. A preview clones the prepared commit and runs a development server beside validation instead of restoring the build that validation captured — so a person looks immediately, and nothing keeps a customer's file tree at the provider) | Preview, validation, `preview_sessions`, §3.9 |
| [0065](docs/decisions/0065-the-preview-is-the-review.md) | The preview is the review (Accepted; supersedes 0017 as a gate, amends 0063 and 0018. A visual approval binds to the preview session of the same commit plus the code diff, and no browser session is paid to photograph one route of it) | Review, approvals, `change_approvals`, §3.9, §3.10 |
| [0066](docs/decisions/0066-payment-meaning-across-evidence-families.md) | Payment meaning is read from every evidence family that can carry it | §3.6 |
| [0067](docs/decisions/0067-plan-screen-renders-the-resolver.md) | The plan screen renders the execution resolver | §3.6 |
| [0068](docs/decisions/0068-retention-periods.md) | Retention periods, by what the data is for (Accepted; closes ADR 0056's deferred P-2) | §3.11, §3.12, storage |
| [0069](docs/decisions/0069-retention-sweep-trigger.md) | What deletes the expired rows, and what it may not touch — `pg_cron` (Accepted; closes ADR 0068's deferred D-2) | §3.11, §3.12, storage |
| [0070](docs/decisions/0070-the-sandbox-is-the-boundary.md) | The sandbox is the boundary; the tool gateway is retired | §3.6 |
| [0071](docs/decisions/0071-agentic-outcome-verification.md) | Outcome verification for agentic changes: routes Vibe observed | Measurement |
| [0072](docs/decisions/0072-the-evidence-behind-the-ceiling.md) | The estimator informs the Run button; it does not price it | §3.11 |
| [0073](docs/decisions/0073-the-charge-lands-on-what-was-sold.md) | Settlement waits for validation; the usage ledger fills itself | §3.11 |
| [0074](docs/decisions/0074-removing-a-file.md) | A prepared change may remove a file; the observation decides which | §3.6 |
| [0075](docs/decisions/0075-the-photograph-nobody-took.md) | The visual review capture path is deleted (completes 0065; the read path stays for one historical approval) | §3.9 |
| [0076](docs/decisions/0076-the-browser-we-own.md) | The Deep Scan browser is a sandbox Vibe owns (supersedes 0012's provider only) | §3.3 |
| [0077](docs/decisions/0077-build-chains.md) | One run may deliver the contiguous build steps of a Move | §3.6 |

### Layers with no section above

These exist, are governed by the ADRs named, and are described in depth by their module README rather than duplicated here.

- **Onboarding** — `src/modules/onboarding/` · ADR 0023. Project-scoped, and reconciled from canonical records on read rather than trusted as stored state, so a run that finishes while the founder is away cannot strand the journey.
- **Product Understanding** — `src/modules/product-understanding/` · answers "what is this product?" between the scanners and the audit. Deterministic derivation plus one cheap model call; a person's correction outranks everything and survives every re-scan.
- **Product Scan** — `src/modules/product-scan/` and `src/modules/operations/product-scan/` · one durable refresh of repository, public-product and Product Understanding sources. Its append-only discovery feed is bounded to 24 Vibe-authored derived events and contains no raw source or model output (ADR 0052).
- **Deep Scan** — `src/modules/authenticated-product-intelligence/` · ADR 0012, ADR 0076. A temporary browser the founder signs into themselves; strictly read-only, no persisted session, no screenshots, one included scan per project. Since ADR 0076 that browser is a Vercel sandbox Vibe creates — Chromium and a guard, no customer code — reached through one public port behind two separate capability tokens. The port did not change when the provider did.
- **Action Plans** — `src/modules/action-plans/` · ADRs 0028, 0054, 0055. Turns a selected opportunity into steps. The model names the actor and the kind of change; the server alone decides what Vibe may execute. Completion is projected from the authority appropriate to each integrated step type: resolved founder context, explicit founder-action attestation, or verified canonical Agent execution evidence.
- **Founder Input Resolution** — `src/modules/founder-input/` · ADR 0053. Turns a bounded dynamic request into versioned, reusable project context and projects authoritative completion for founder-owned Action Plan steps.
- **Execution Contract / Context** — `src/modules/execution-contract/`, `src/modules/execution-context/` · ADRs 0026, 0031, 0034. The immutable spec and compiled policy an execution runs under, and the bounded brief it starts from.
- **Coding Agent** — `src/modules/coding-agent/` · ADRs 0027, 0029, 0032, 0033. The agent harness, its sandbox placement, its gateway, and how a run's result is verified against Vibe's own observation.
- **Merge** — `src/modules/merge/` · ADR 0019.
- **Outcome Verification / Business Measurement** — `src/modules/outcome-verification/`, `src/modules/business-measurement/` · ADRs 0020, 0021, 0071. Two profiles: what the SEO generators publish, and whether the public pages an agentic change touched are still being served.
- **Durable Operations** — `src/modules/operations/` · ADRs 0013, 0030, 0037. Also the only module permitted to use the service-role client.
- **Billing and Economy** — `src/modules/billing/`, `src/modules/economy/` · ADRs 0025, 0038.

---

## Related Documents

- [PRODUCT.md](PRODUCT.md) — product vision, scope, and non-goals
- [CLAUDE.md](CLAUDE.md) — working agreement for AI-assisted implementation sessions
- [docs/decisions/](docs/decisions/README.md) — architecture decision records
- [docs/sprints/](docs/sprints/README.md) — sprint planning
