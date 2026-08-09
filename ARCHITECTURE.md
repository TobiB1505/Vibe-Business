# Vibe Business — Architecture

Status: V0.1 foundational architecture decided; implementation not yet started. This document distinguishes explicitly between:

- **Confirmed V0.1 decisions** — settled for V0.1, each backed by an ADR in [docs/decisions/](docs/decisions/README.md).
- **Deferred / open decisions** — must still be made, several explicitly before the layer they affect can be implemented.

Nothing outside the "Confirmed" sections should be read as final. Where a decision is confirmed, this document links to the ADR that recorded it — the ADR is the source of truth for context and consequences; this document is the map of how the confirmed pieces fit together.

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
Repository
  → Analysis
  → Opportunity
  → Execution Job
  → Branch
  → Validation
  → Preview
  → Approval
  → Merge
  → (Measure)
```

Each stage below is described as a logical layer/responsibility inside the modular monolith (ADR 0001), not as a separate service.

---

## 3. Logical Layers

### 3.1 GitHub Integration Layer

**[Confirmed — ADR 0003]** Repository access is implemented via a **GitHub App** — not personal access tokens, not a token-paste flow, not GitHub OAuth App as the primary mechanism. Least privilege applies: **permissions are requested only when a concretely implemented feature needs them.** Currently granted: **Metadata (read)** for repository discovery (Sprint 1) and **Contents (read)** for repository intelligence (Sprint 2). Write permissions (Contents write, Pull Requests) are deliberately **not** requested until a sprint actually creates branches or commits. Installation access tokens are short-lived; no unnecessary GitHub access tokens are persisted long-term. See [0003-github-app-integration.md](docs/decisions/0003-github-app-integration.md) and [docs/setup/github-app.md](docs/setup/github-app.md).

**[Confirmed principle]** Must never write to the default/main branch as part of an autonomous flow. Merges to default require the explicit approval step in the Approval Layer ([§3.10](#310-approval-layer)).

**[Confirmed principle]** Responsible for: authenticating via the GitHub App, listing/selecting installed repositories, reading repository contents, creating branches, committing changes to non-default branches, opening/managing pull requests, and (only after approval) merging to the default branch.

### 3.2 Repository Analysis Layer

**[Confirmed principle]** Produces structured, reusable findings about a repository (stack, structure, notable signals relevant to the audit dimensions in [PRODUCT.md §10](PRODUCT.md#10-business-readiness-concept)) without sending the entire repository to an LLM. See [Cost Principles](PRODUCT.md#13-cost-principles).

**[Confirmed — Sprint 2]** The first layer of analysis is **fully deterministic and contains no AI**: a versioned Repository Intelligence Snapshot built from the Git tree and a small set of dependency manifests, with evidence attached to every detection. Implemented in `src/modules/repository-intelligence/`; see [docs/sprints/0002-repository-intelligence.md](docs/sprints/0002-repository-intelligence.md). AI consumes this structured output later rather than reading repositories itself.

**[Confirmed principle — data minimization]** Vibe Business does not store a copy of a customer's repository. Only *derived* intelligence and the evidence paths that justify it are persisted — never source files, README bodies, raw manifests, lockfiles, or configs. Repository content exists transiently in memory during analysis and is then discarded.

**[Confirmed principle — untrusted repository data]** Repository-derived content is **untrusted DATA, never instructions.** This extends [ADR 0006](docs/decisions/0006-untrusted-repository-execution.md) from "do not execute it" to "do not obey it": any future AI consumer of repository text, paths, or dependency names must treat them as input to reason about, never as system instructions. Analysis reads and parses repository data; it never executes, imports, or evaluates it.

**[Confirmed principle — bounded reads]** Repository analysis runs against explicit resource budgets (tree entries, file fetches, bytes, duration, path depth). Exceeding a budget degrades a snapshot to `partial` with machine-readable reasons; it never fails an otherwise useful analysis, and never triggers an unbounded crawl.

**[Open decision]** Analysis techniques beyond the deterministic layer — specifically which findings warrant targeted LLM calls, and what gets cached vs. recomputed beyond snapshot reuse by commit SHA + analyzer version.

### 3.3 Live Product Analysis Layer

**[Confirmed principle]** Analyzes the optional production URL as a complementary signal to repository analysis (e.g., what is actually live and reachable, vs. what exists in code).

**[Open decision]** Scope of live analysis for V0.1 (e.g., fetching and inspecting rendered pages vs. deeper interaction/crawling). Not yet decided; should stay minimal enough to be cost-predictable.

### 3.4 Business Audit Layer

**[Confirmed principle]** Consumes output from the Repository and Live Product Analysis layers and produces a Business Readiness Audit structured around the dimensions in [PRODUCT.md §10](PRODUCT.md#10-business-readiness-concept) (Product, Monetization, Distribution, Conversion, Retention).

**[Confirmed principle]** The data model must not hard-code only the V0.1 dimensions in a way that blocks adding more dimensions later.

**[Open decision]** Exact audit data schema (see [§6 Domain Model](#6-domain-model-conceptual-only) — conceptual only, no fields defined yet).

### 3.5 Opportunity Engine

**[Confirmed principle]** Converts Business Audit output into a small, ranked set of Opportunities (see [PRODUCT.md §11](PRODUCT.md#11-opportunity-model)), not a full report dump. Aggressive prioritization is a functional requirement, not a UI nicety.

**[Open decision]** Ranking method (deterministic scoring, LLM-assisted ranking, or hybrid) is not yet decided.

### 3.6 AI Execution Layer

**[Confirmed — ADR 0005]** **Anthropic** is the AI provider for V0.1. Provider-specific logic (API calls, request/response shaping, model identifiers) is isolated behind a conceptual **`AIProvider`** boundary covering analysis, structured generation, code execution request preparation, and usage reporting. The concrete interface signature is not implemented ahead of need. No multi-provider routing and no agent orchestration beyond a single provider call in V0.1. See [0005-ai-provider-abstraction.md](docs/decisions/0005-ai-provider-abstraction.md).

**[Confirmed principle]** Every AI job runs against a hard budget and is logged for usage/cost (see [§3.11](#311-usagecredit-layer)).

### 3.7 Git Branch / Change Layer

**[Confirmed principle]** All AI-authored code changes land on an isolated, non-default branch (via the GitHub Integration Layer). This layer owns branch lifecycle (create, update, discard) for execution jobs.

### 3.8 Build & Validation Layer

**[Confirmed — ADR 0006, security principle]** Repository code is **untrusted**. It must execute only in isolated, ephemeral environments with tightly scoped credentials and lifecycle — never directly inside the Vibe Business application process. This explicitly rules out running `npm install`, npm scripts, arbitrary shell scripts, build scripts, test scripts, postinstall hooks, or repository-provided executables in-process. See [0006-untrusted-repository-execution.md](docs/decisions/0006-untrusted-repository-execution.md).

**[Deferred — ADR 0006]** The concrete sandbox/execution provider is **not yet decided**. This blocks full implementation of this layer until resolved.

**[Confirmed principle]** Every proposed change is built and tested before it is presented to the user as a preview. A change that fails to build or fails tests must not reach the Preview Layer as a viable proposal.

**[Open decision]** What "tested" means in V0.1 (existing project test suite only, generated smoke tests, or both) — depends on target project stacks.

### 3.9 Preview Layer

**[Confirmed — ADR 0004]** Preview generation sits behind a conceptual **`PreviewProvider`** boundary. **Vercel Preview Deployments** is the first implementation, used for repositories that are themselves Vercel-compatible. Vercel-specific behavior stays behind this boundary rather than leaking into the Opportunity Engine, AI Execution Layer, or Approval Layer. See [0004-vercel-as-initial-host-and-preview-provider.md](docs/decisions/0004-vercel-as-initial-host-and-preview-provider.md).

**[Open decision]** Preview support for repositories that are not already Vercel-compatible is not covered by V0.1's first implementation.

### 3.10 Approval Layer

**[Confirmed principle]** Enforces the permission boundary defined in [PRODUCT.md §9](PRODUCT.md#9-approval-model). Merge to the default branch is only ever triggered by an explicit, attributable user approval action recorded in the Audit Log — never inferred, defaulted, or timed out into approval.

### 3.11 Usage/Credit Layer

**[Confirmed principle]** Records the per-job usage schema defined in [PRODUCT.md §12](PRODUCT.md#12-credit-model) (`provider`, `model`, `input_tokens`, `output_tokens`, `provider_cost`, `tool_cost`, `vibe_credits_charged`, `job_id`, `user_id`, `timestamp`) for every AI job. Vibe Credits charged to the user are decoupled from raw provider cost in the data model, even if V0.1 uses a simple conversion.

**[Open decision]** Credit pricing / credit-to-cost conversion rate is not decided.

### 3.12 Audit Log

**[Confirmed — ADR 0007]** A **Postgres-based, append-only application audit log** (conceptually `audit_events`), stored in the same Supabase Postgres instance as the rest of the application. Records business-meaningful actions (e.g. `repository.connected`, `audit.completed`, `opportunity.created`, `execution.started`, `branch.created`, `preview.ready`, `approval.accepted`, `approval.rejected`, `pull_request.merged`, `credits.debited`) — it does not replace normal application/error logs, and is treated as append-only under normal operation. See [0007-audit-log.md](docs/decisions/0007-audit-log.md).

---

## 4. Cross-Cutting Concerns

**[Confirmed principle]** Cost awareness applies across every layer that calls an LLM (Analysis, Audit, Opportunity Engine, AI Execution). See [PRODUCT.md §13](PRODUCT.md#13-cost-principles): targeted context over full-repo dumps, caching, model routing by difficulty (architecturally enabled by ADR 0005, not implemented in V0.1), hard per-job budgets, usage logging from day one.

**[Confirmed — ADR 0008]** Secrets (GitHub App private key/secret, Supabase service credentials, Anthropic API key, webhook secrets) are managed server-side via the hosting environment — **Vercel Environment Variables / Secret Configuration** for V0.1. Secrets must never be committed to Git, sent to client components, stored in public environment variables, written to application logs, included in AI prompts (unless unavoidable and specifically designed to be safe), or stored unencrypted as plain application fields. Any future persisted third-party/user credentials require a separate, dedicated secrets design. See [0008-secrets-management.md](docs/decisions/0008-secrets-management.md).

**[Confirmed principle]** Security-sensitive integrations (GitHub auth, tokens, webhooks, credentials) use least privilege and are never committed to the repository. See [CLAUDE.md](CLAUDE.md).

**[Confirmed principle]** Background/asynchronous work (e.g. long-running analysis, execution jobs, isolated builds) is required as a concept — the pipeline in [§2](#2-core-flow) cannot run fully synchronously within a single request. The specific queue/background-job technology is explicitly **not decided** (see [§7](#7-deferred--open-decisions)); no such technology should be introduced before that decision is made, per [CLAUDE.md](CLAUDE.md).

---

## 5. Module Boundaries (within the Monolith)

**[Confirmed — ADR 0001]** Logical modules, living together in one Next.js/TypeScript codebase per ADR 0001:

`auth` · `projects` · `github` · `audits` · `opportunities` · `execution` · `previews` · `approvals` · `usage` · `credits` · `audit-log`

These are code-organization boundaries, not process/network boundaries, for as long as the modular monolith holds (see ADR 0001 "Revisit when").

---

## 6. Domain Model (Conceptual Only)

**[Confirmed principle — conceptual only]** The following entities are expected to exist in the eventual data model, based on the layers above and the Core Loop in [PRODUCT.md](PRODUCT.md#6-core-user-flow). This is a naming/shape placeholder to keep layers conceptually aligned — **no fields, types, constraints, SQL schemas, or migrations are defined here.** The concrete schema is scoped to Sprint 0/1.

- `User`
- `Project`
- `GitHubInstallation`
- `RepositoryConnection`
- `ProductAudit`
- `AuditDimension`
- `Opportunity`
- `ExecutionJob`
- `CodeChange`
- `Preview`
- `Approval`
- `UsageEvent`
- `CreditLedgerEntry`
- `AuditEvent`

Multi-tenant scoping (by `User`/`Project`) and Row Level Security, per [0002-supabase-postgres-and-auth.md](docs/decisions/0002-supabase-postgres-and-auth.md), apply once these entities are actually implemented as tables.

---

## 7. Deferred / Open Decisions

The following are explicitly **not decided** and should not be assumed by implementation work:

1. **Untrusted Repository Execution Provider** — concrete sandbox/isolation mechanism for building/testing repository code. Security principle is confirmed (ADR 0006); provider is deferred.
2. **Preview integration for non-Vercel-compatible repositories** — V0.1's first `PreviewProvider` implementation only covers Vercel-compatible targets (ADR 0004).
3. **`AIProvider` interface signature** — the boundary is confirmed (ADR 0005); its concrete shape is not.
4. **Final database schema** — entities are named conceptually (§6); fields, types, and migrations are not defined.
5. **Credit pricing / credit-to-provider-cost conversion** — the ledger schema is confirmed (PRODUCT.md §12); the actual pricing/conversion is not.
6. **Analytics provider** — not chosen.
7. **Error monitoring / observability provider** — not chosen.
8. **Production hosting migration as a possible future product feature** — not scoped, not committed to.
9. **Long-term storage for large build artifacts** — not chosen.
10. **Background job / queue technology** — required as a concept (§4), but the specific technology is not decided. Do not introduce one before this decision is made.

These should be resolved as explicit ADRs before significant implementation of the corresponding layer begins, per [CLAUDE.md](CLAUDE.md).

---

## Related Documents

- [PRODUCT.md](PRODUCT.md) — product vision, scope, and non-goals
- [CLAUDE.md](CLAUDE.md) — working agreement for AI-assisted implementation sessions
- [docs/decisions/](docs/decisions/README.md) — architecture decision records
- [docs/sprints/](docs/sprints/README.md) — sprint planning
