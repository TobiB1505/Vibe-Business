# ONBOARDING-1 — Product Onboarding, Activation Flow & Resumable Project Lifecycle

**Status:** implemented on `feat/onboarding-v1`; migration deployment, browser validation and real-project dogfood pending.

**Branch base:** `82022d915418c794385cdec214fe60a78b7a8729` (`feat/core-2-audit-first-move`). The pre-existing Audit UI work was preserved. While this implementation was in progress, that work was committed on the branch as `3ffdc94338ed8662a982bdb81366613db4611118`; onboarding changes remain a separate uncommitted worktree diff on top of it.

## Goal

Create the canonical journey from a new account to “Vibe understands my product and business,” without rebuilding any intelligence domain or pretending the Action Planner exists.

The founder sees four phases only: **Connect → Understand → Audit → First move**.

## What changed

- Added a project-scoped, RLS-protected `project_onboarding` lifecycle with explicit live-site intent and reveal/completion milestones.
- Added server-side first-login and resume routing. No project enters new-project onboarding; an incomplete project resumes; mature projects continue to the existing dashboard.
- Repository selection still creates exactly one canonical Project, then enters its focused onboarding shell.
- The optional live-site step persists “I don’t have a live site yet” as real context and supports retry/correction/continue after a failed live inspection.
- Source scanning reuses Repository Intelligence and Live Product Intelligence. Product Understanding reuses the durable CORE-1 operation and its real stage semantics.
- Product reveal uses the real Product Profile, identity, logo and audience facts. “Looks right” and focused corrections write through the existing confirmation/correction stores.
- Confirmation attempts to start the existing entitled Business Audit directly. `needs_user`, preparing, analyzing and completed states reuse current Audit components and persisted operations.
- Audit reveal reuses the nine-Lens Business Map and shows the real overall conclusion and primary blocker.
- First move starts the existing Opportunity operation, shows the actual rank-one Move when one exists, and uses an explicit no-Move fallback when none exists. Completion never requires execution.
- Added meaningful onboarding funnel events through the append-only audit log; founder answers and correction text are never logged.

## Architecture intentionally unchanged

- GitHub App installation, ownership verification and repository connection.
- Repository and Live Product Intelligence analyzers, budgets and safe-fetch boundary.
- Product Profile schema, provenance, confidence, corrections and `user_confirmed` semantics.
- Business Audit prompt, rubric, Lens model, evidence, entitlement, refresh/version rules and durable operation.
- Deterministic founder-question gate and persisted `needs_user` answer routing.
- Opportunity ranking and execution-readiness semantics.
- The normal Dashboard, project workspace, Action Planner and execution flows.

## Existing-project migration

The migration creates a lifecycle row for every existing project. Any project with a completed Business Audit is backfilled as `complete`, using the Audit completion time for the reveal/activation milestones; other projects receive a coarse source-based starting state that the server immediately reconciles from their real profile and operation records. It does not infer or synthesize a Product Profile, Audit or Move. Projects created after deployment receive their row immediately after repository selection.

## Validation

- Added pure state-machine tests for canonical reconciliation, explicit no-live intent and completion.
- Added migration/contract tests for TypeScript/SQL state alignment, project-scoped RLS, no browser-storage authority, canonical service reuse, guarded completion and no fake Move data.
- `git diff --check` is green.
- Repository scripts were intentionally not executed in this session under the repository’s untrusted-execution working agreement. Lint, typecheck, unit, integration, build and E2E remain required in the approved isolated validation environment.

## Manual QA plan

At 1440, 1280, tablet and ~375 mobile:

1. New account routes to Connect and never sees the full project navigation.
2. Repository selection creates one Project and lands on its live-site choice.
3. Repo + live and repo-only Product Understanding both resume through reloads.
4. Product reveal uses current real data; correction persists in the normal Product screen.
5. Audit `needs_user` survives a reload and resumes the same operation after an answer.
6. Audit reveal stays focused; Business Map remains legible and the primary blocker is real.
7. First Move is real when available, honest when absent, and completion enters the existing workspace.
8. A second project gets an independent row; a mature pre-existing project is not replayed.

## Residuals

- The existing Business Audit requires a successful live-product snapshot. A founder can complete repository-only Product Understanding, but cannot complete activation without a reachable live product under the current CORE-2 contract. This sprint reports that boundary rather than inventing a snapshot or changing Audit reasoning.
- GitHub’s external installation authorization remains GitHub-owned. The internal account/repository choosers use the focused four-phase shell, while persisted project state begins only after the canonical Project exists.
- Migration deployment, real provider dogfood, production screenshots and full automated validation are outstanding.
