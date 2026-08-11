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
- [0004-business-readiness-audit](0004-business-readiness-audit.md) — diagnostic AI Business Readiness Audit, first paid inference (Implemented; real dogfood audit blocked on ANTHROPIC_API_KEY)
- [0005-authenticated-live-product-intelligence](0005-authenticated-live-product-intelligence.md) — human-in-the-loop Deep Scan of the signed-in product (Complete — dogfooded against the real deployment)
- [0006-deep-scan-audit-evidence](0006-deep-scan-audit-evidence.md) — Deep Scan evidence in the Business Audit, evidence pack v2 (Implemented; updated real audit awaiting approval)

## Format

Each sprint document should include:

- **Goal** — what this sprint sets out to achieve.
- **Context** — why this sprint, why now, and what it builds on.
- **Scope** — what is included.
- **Non-Goals** — what is explicitly excluded from this sprint, even if related.
- **Acceptance Criteria** — how completion is judged.
- **Validation** — what was run to confirm the work (tests, build, manual checks) per [CLAUDE.md](../../CLAUDE.md) rule 17.
- **Risks / Notes** — known risks, open questions, or follow-ups surfaced during the sprint.
