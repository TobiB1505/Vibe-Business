# Sprints

This directory holds sprint plans for implementation work on Vibe Business.

## Why

Implementation work should be scoped and recorded as discrete sprints, each tied back to [PRODUCT.md](../../PRODUCT.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md), so that scope, intent, and outcome are traceable after the fact rather than only living in chat history.

## Status

- [0000-application-bootstrap](0000-application-bootstrap.md) — application bootstrap and development foundation (Complete)
- [0001-github-app-connection](0001-github-app-connection.md) — GitHub App connection and repository selection (Complete)
- [0002-repository-intelligence](0002-repository-intelligence.md) — deterministic repository intelligence snapshots (Implemented; live validation pending manual permission upgrade + migration)
- [0003-connect-flow-installation-reuse](0003-connect-flow-installation-reuse.md) — fix: reuse an existing GitHub installation when connecting further projects (Complete)
- [0002a-supabase-cli-workflow](0002a-supabase-cli-workflow.md) — infrastructure: linked Supabase CLI migration workflow (Complete — migration history reconciled and verified against the linked remote project)
- [0003-live-product-intelligence](0003-live-product-intelligence.md) — deterministic live product intelligence from the public production website (Complete — migration deployed, dogfooded against the real deployment)
- [0004-business-readiness-audit](0004-business-readiness-audit.md) — diagnostic AI Business Readiness Audit, first paid inference (Complete — real dogfood audit run: 34/100)
- [0005-authenticated-live-product-intelligence](0005-authenticated-live-product-intelligence.md) — human-in-the-loop Deep Scan of the signed-in product (Complete — dogfooded against the real deployment)
- [0006-deep-scan-audit-evidence](0006-deep-scan-audit-evidence.md) — Deep Scan evidence in the Business Audit, evidence pack v2 (Complete — merged, updated real audit run once: 34 → 40/100)
- [0007-durable-operation-execution](0007-durable-operation-execution.md) — durable execution for long-running operations; Business Audit is the first consumer (Complete — merged and dogfooded: audit ran durably, request returned before inference began)
- [0008-opportunity-engine](0008-opportunity-engine.md) — prioritized, evidence-grounded opportunities from the Business Audit (Complete — merged and dogfooded: 3 opportunities, correct prerequisite ordering; one upstream evidence defect found, fixed, and the advice verified corrected)
- [0009-first-execution](0009-first-execution.md) — execution safety core: preflight, premise revalidation, deterministic generator (9A+9B complete — core and backend wiring built and mutation-validated; 9C UI, permission upgrade and dogfood pending)

## Format

Each sprint document should include:

- **Goal** — what this sprint sets out to achieve.
- **Context** — why this sprint, why now, and what it builds on.
- **Scope** — what is included.
- **Non-Goals** — what is explicitly excluded from this sprint, even if related.
- **Acceptance Criteria** — how completion is judged.
- **Validation** — what was run to confirm the work (tests, build, manual checks) per [CLAUDE.md](../../CLAUDE.md) rule 17.
- **Risks / Notes** — known risks, open questions, or follow-ups surfaced during the sprint.
- [Sprint 10A — Isolated Change Validation](0010-isolated-change-validation.md) — isolated sandbox validation of a prepared change (Complete — dogfooded under policy v1, then refactored into durable per-phase steps and re-dogfooded green under policy v3: one sandbox across seven durable steps, 285s end to end)
- [Sprint 10B — Temporary Change Preview](0010b-temporary-preview.md) — a validated artifact restored into a temporary isolated runtime on a public-unlisted URL (10B-1 artifact capture and 10B-2 preview runtime complete and mutation-validated; 10B-3 UI and real dogfood pending)
