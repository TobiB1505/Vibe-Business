# Architecture Decision Records (ADRs)

This directory holds Architecture Decision Records: short documents that capture a significant architecture or product-behavior decision, the context that led to it, and its consequences, at the time it was made.

## Why

[ARCHITECTURE.md](../../ARCHITECTURE.md) intentionally lists a number of open decisions rather than pretending they are already settled. As each of those (or other significant decisions) is actually made, it should be recorded here — not only discussed in chat — so the reasoning survives independently of any single conversation. See [CLAUDE.md](../../CLAUDE.md) rule 13.

## When to write an ADR

Write one when a decision:

- Is hard or costly to reverse, or
- Affects multiple layers/modules described in [ARCHITECTURE.md](../../ARCHITECTURE.md), or
- Resolves one of the open decisions explicitly listed in ARCHITECTURE.md, or
- Meaningfully changes product behavior described in [PRODUCT.md](../../PRODUCT.md).

Small, easily reversible implementation choices do not need an ADR.

## Naming

Sequential, numbered, kebab-case, descriptive:

```
0001-github-as-integration-layer.md
0002-preview-deployment-strategy.md
```

## Status

V0.1 foundational architecture decisions have been recorded:

- [0001](0001-modular-monolith.md) — Modular Monolith with Next.js + TypeScript (Accepted)
- [0002](0002-supabase-postgres-and-auth.md) — Supabase Postgres and Supabase Auth (Accepted)
- [0003](0003-github-app-integration.md) — GitHub App as Repository Integration Layer (Accepted)
- [0004](0004-vercel-as-initial-host-and-preview-provider.md) — Vercel as Initial Host and Preview Provider (Accepted)
- [0005](0005-ai-provider-abstraction.md) — AI Provider Abstraction, Anthropic First (Accepted)
- [0006](0006-untrusted-repository-execution.md) — Untrusted Repository Execution (Accepted principle / Deferred provider)
- [0007](0007-audit-log.md) — Postgres Append-Only Audit Log (Accepted)
- [0008](0008-secrets-management.md) — Secrets Management (Accepted)
- [0009](0009-github-installation-ownership-verification.md) — GitHub Installation Ownership Verification (Accepted)
- [0010](0010-safe-outbound-http-inspection.md) — Safe Outbound HTTP Inspection (Accepted)
- [0011](0011-ai-inference-and-evidence-trust-boundary.md) — AI Inference and the Evidence Trust Boundary (Accepted)
- [0012](0012-authenticated-browser-analysis.md) — Authenticated Browser Analysis (Accepted)
- [0013](0013-durable-operation-execution.md) — Durable Operation Execution (Accepted)
- [0014](0014-first-execution-safety.md) — First execution is isolated, premise-revalidated and capability-scoped (Accepted)
- [0015](0015-untrusted-repository-execution-provider.md) — Untrusted Repository Execution Provider: Vercel Sandbox (Accepted)
- [0016](0016-temporary-preview-isolation.md) — Temporary Preview Isolation (Accepted)
- [0017](0017-visual-review-artifacts.md) — Visual Review Artifacts (Accepted; §9 corrected by the first dogfood)
- [0018](0018-human-approval-authority.md) — Human Approval Authority (Accepted)
- [0019](0019-safe-approved-change-merge.md) — Safe Approved Change Merge (Accepted)
- [0020](0020-production-outcome-verification.md) — Production Outcome Verification (Accepted)
- [0021](0021-business-outcome-measurement.md) — Business Outcome Measurement (Accepted)
- [0022](0022-sentry-observability.md) — Sentry for Error Monitoring and Baseline Tracing (Accepted)
- [0023](0023-project-scoped-onboarding-orchestration.md) — Project-scoped Onboarding Orchestration (Accepted)
- [0024](0024-vibe-credits-economic-layer.md) — Vibe Credits as an Internal Economic Layer (Accepted)
- [0025](0025-stripe-payment-rail-and-credit-grants.md) — Stripe as Payment Rail, and Credit Grants as Provenance (Accepted)
- [0026](0026-agentic-execution-contract.md) — Agentic Execution Contract (Accepted)
- [0027](0027-coding-agent-provider-and-tool-gateway.md) — Agentic Coding: Provider Abstraction, Tool Gateway, and Independent Validation (Accepted)
- [0028](0028-founder-selectable-action-plan-move.md) — Founder-Selectable Action Plan Move (Accepted)
- [0029](0029-agent-runtime-placement-and-credential-broker.md) — Agent Runtime Placement: the Harness in the Sandbox, the Key Behind a Gateway (Accepted, amends 0027)
- [0030](0030-agent-execution-observability.md) — Agent Execution Observability: one ordered event log, a reusable live view, derived economics (Accepted, extends 0027 and 0029)
- [0031](0031-execution-context-intelligence.md) — Execution Context Intelligence: verify relevant facts, do not broadly rediscover (Accepted, extends 0027, 0029 and 0030)
- [0032](0032-agent-verification-and-completion.md) — Agent Verification and Completion: the agent checks enough to converge, the validator checks enough to authorize (Accepted, extends 0027, 0029 and 0031)
- [0033](0033-post-implementation-completion-control.md) — Post-Implementation Completion Control: stop paying for exploration after the job has converged (Accepted, extends 0027, 0029, 0031 and 0032)
- [0034](0034-execution-surface-and-lifecycle.md) — Execution surfaces, and separating implementation breadth from convergence (Accepted, supersedes parts of 0031 and 0033)
- [0035](0035-commit-message-compiler.md) — Commit Message Compiler: Conventional Commits from the trusted Action Step (Accepted, narrows Rule 57's application to the Planner's own already-trusted text)
- [0036](0036-risk-adaptive-validation-depth.md) — Risk-Adaptive Independent Validation Depth: profile answers *which commands*, depth answers *how many this change deserves* (Accepted, extends Rule 65 with a second versioned axis; leaves Rule 66 untouched)
- [0037](0037-automatic-validation-and-review-classification.md) — Automatic validation hand-off, and deterministic review classification (Accepted, establishes that one durable operation may enqueue the next; leaves the visual-review "nothing is automatic" rule intact)
- [0038](0038-economy-intelligence-layer.md) — The Economy Intelligence layer (Accepted, extends 0024; predicts what a run will cost from pre-execution signals only, measures how wrong it was, and activates nothing — `CREDIT_RATE_CARDS` stays empty)
- [0039](0039-documentation-currency.md) — Where truth lives, and how documentation stays current (Accepted; one authoritative home per claim, records are immutable and current-state documents must be true at HEAD, and the structural half is asserted by `src/lib/docs/documentation-currency.test.ts`)
- [0040](0040-ci-hosted-database-concurrency-gate.md) — Where a real-database concurrency test runs, and what it may reach (Accepted; a disposable local Supabase stack on a GitHub runner, no secret of any kind, no PostgreSQL driver, and a target guard that makes the deployed project unreachable by construction rather than by policy)
- [0041](0041-marketing-attribution-pixel.md) — The Meta Pixel, and the two boundaries it runs inside (Accepted; production deployments only and public pages only, so the identifiers in `/app` paths never reach an advertising network — `PageView` and nothing else)
- [0042](0042-billing-reconciliation-authority.md) — Billing Reconciliation Authority: one terminal-CAS authority doctrine, one idempotent materialization primitive shared by the hot path and repair, and a certified, drain-gated cutover, closing drift repair, orphaned holds, stranded lot capacity and zero-credit settlement idempotency (Accepted; design only, no implementation)

Several architecture questions remain intentionally open — see [ARCHITECTURE.md §7](../../ARCHITECTURE.md#7-deferred--open-decisions).

## Suggested format

```
# NNNN - Title

Status: Proposed | Accepted | Superseded by NNNN
Date: YYYY-MM-DD

## Context
What problem or question this decision addresses.

## Decision
What was decided.

## Consequences
What this makes easier, harder, or forecloses.
```
