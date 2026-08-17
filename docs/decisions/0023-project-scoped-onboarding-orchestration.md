# ADR 0023 — Project-scoped onboarding orchestration

**Status:** Accepted
**Date:** 2026-08-17

## Context

Vibe Business already has canonical project sources, Product Profiles, durable Business Audits, founder questions and ranked Opportunities. New users still encounter those as separate workspace tools and must infer the order themselves. Browser-only progress cannot resume across devices, and a user-level `onboarding_complete` flag cannot represent several projects at different stages.

Duplicating Product Profile, Audit or Opportunity fields into onboarding would create competing truths. Deriving every screen only at render time, however, would lose the few facts that are genuinely about the journey: an explicit “no live site yet” choice, whether a reveal has been seen, and whether activation is complete.

## Decision

Add one `project_onboarding` row per project.

- Persist the current orchestration state, explicit live-site intent, reveal milestones and completion timestamp.
- Treat the existing repository connection, intelligence snapshots, Product Profile, Audit/operation rows, pending founder question and Opportunity set as canonical facts.
- Reconcile the persisted route from those facts on every onboarding load. Persisted state is resumable, but it cannot overrule a completed operation or a canonical correction.
- Route a new project into a focused `/app/onboarding/[projectId]` shell after the existing GitHub repository selection creates the one canonical Project.
- Keep the public journey to four phases: Connect, Understand, Audit and First move. Internal states remain project-scoped and server-authoritative.
- Backfill projects with a completed Audit as complete. Existing mature users must not be replayed through first-use onboarding.
- Record milestone events in the existing append-only `audit_events` path without storing URLs, Product Profile corrections or founder answers in event metadata.
- Keep GitHub as the current source provider, while the onboarding vocabulary and state machine model a product source rather than GitHub as a permanent universal prerequisite.

## Consequences

**Good**

- Interrupted onboarding resumes from durable product state on another device.
- A second project has an independent lifecycle without replaying account-level setup.
- Product corrections, Audit entitlement and founder questions keep one source of truth.
- Future Action Planner work can extend `first_move` without changing the earlier phases.

**Costs and limits**

- A small reconciliation write can occur when an asynchronous operation finishes while the founder is away.
- The current Business Audit contract still requires successful Live Product Intelligence. Repository-only Product Understanding therefore remains available, but a founder who has no live product cannot complete the Audit phase yet. This ADR does not silently weaken CORE-2’s evidence contract; changing that contract requires its own reasoning sprint.
- GitHub authorization and pre-project account/repository selection necessarily happen before project-scoped persistence can exist. The internal screens use the focused shell, but no empty Project is created merely to display Connect.

## References

- [ADR 0002 — Supabase Postgres and Auth](0002-supabase-postgres-and-auth.md)
- [ADR 0003 — GitHub App integration](0003-github-app-integration.md)
- [ADR 0007 — Postgres append-only audit log](0007-audit-log.md)
- [ADR 0013 — Durable operation execution](0013-durable-operation-execution.md)
