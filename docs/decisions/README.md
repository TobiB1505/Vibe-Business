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
