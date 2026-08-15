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
- [Sprint 10B — Temporary Change Preview](0010b-temporary-preview.md) — a validated artifact restored into a temporary isolated runtime on a public-unlisted URL (Complete — dogfooded end to end: reachable in ~12s, loopback under deny-all confirmed, public edge opened, stop and snapshot deletion verified; teardown moved into durable execution after the dogfood exposed an RLS-silenced usage ledger, then re-dogfooded green with real Active CPU recorded)
- [Sprint 11A — Before/After Review Artifact](0011a-before-after-review.md) — a controlled before/after screenshot comparison of the live product and the running preview (Complete — dogfooded end to end: ready in 15s, both sides 1440×1000, one browser session, 0 AI calls, and the comparison survived the preview's teardown; four defects found, all of them the product failing to report work it had already done correctly)
- [Sprint 11B — Human Approval](0011b-human-approval.md) — the first explicit human authorization object, bound to one exact reviewed commit (Implemented and dogfooded — one exact approval bound to commit 2f05958, 0 AI/sandbox/browser calls, GitHub untouched; browser E2E still not possible without a test harness)
- [Sprint 11C.1 — Critical Merge UI Browser E2E](0011c1-merge-ui-e2e.md) — the first real-browser regression layer, covering the merge confirmation, both repository-changed refusals, merged rendering and reload recovery (Implemented — 9 chromium tests, zero external requests; fixture-driven because no container runtime is available for an isolated database)
- [Sprint 11C — Safe Merge](0011c-safe-merge.md) — the first Vibe-authorized write to a repository's default branch: exact approval, fresh GitHub preflight, fast-forward only, no force, independent read-back (Complete — dogfooded twice on 14.08.2026: first correctly refused on repository drift with nothing written, then moved `main` from 246ac36 to 78cbdac by fast-forward, verified by an independent read-back; one ChangeMerge row, 0 AI calls)
- [Sprint 12A — Production Outcome Verification](0012a-production-outcome-verification.md) — the first thing Vibe records about the customer's *product* rather than its own pipeline: a bounded, deterministic observation of the public product after a merge, kept strictly separate from deployment provenance and from business impact (Complete — dogfooded 15.08.2026: production outcome `verified`, 8/8 checks on the first attempt in 2.5s, 0 AI calls, and the stored evidence independently re-checked against production by hand)
- [Sprint 12B — Business Outcome Measurement Foundation](0012b-business-outcome-measurement.md) — the third and last question in the trust loop, built around what it refuses to say: business impact requires metric evidence, no evidence is not negative impact, and an observed change is never a caused one (Complete — migration deployed 15.08.2026 and dogfooded through the UI: one MeasurementPlan bound to the real merge, result `source_required` because no metric connector exists, 0 AI/sandbox/browser calls)
- [Sprint 12C — Google Search Console Metric Source](0012c-search-console-connector.md) — **PARKED / DEFERRED**: the API contract was verified and the provider-semantics foundations built and tested, then the product direction changed. Measurement is infrastructure and must not gate the execution flow, so analytics connectors became optional future adapters and a deterministic BusinessRationale took the prompt's place in the UI
