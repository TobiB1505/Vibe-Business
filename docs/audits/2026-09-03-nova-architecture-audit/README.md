# Nova — product agent / guided experience architecture audit — 2026-09-03

**Scope:** whether a named, persistent product/business agent ("Nova") that guides a founder from GitHub connection through the first merged improvement can be built as an orchestration-and-presentation layer over the systems Vibe already has — and, if so, what is genuinely missing. Read-only; nothing was implemented.
**Audited at:** commit `5ce16d5` (HEAD of `main`), plus the unmerged Stage-4 branch `claude/agent-preview-diff-logic-sxj5uc` at `070c2b5` (ADR 0078/0079, build contract and application choice), read where Nova's execution UX depends on it. 111 migrations, 54 tables, 15 operation kinds, 4 single-call AI operations plus agentic execution.
**Method:** the actual implementation was read — migrations, stores, server actions, workflow steps, read models, components and the tests that pin them. Every material claim below carries a `file:line`. Line numbers are as of the commits above; the branch is cited as *(branch)*.
**Record status:** audit record under `docs/audits/` (CLAUDE.md rule 83). It describes the state at `5ce16d5` and is not edited to match the present.

Vocabulary: **Confirmed** (read in code) · **Probable** (derived from code, not run) · **Open** (needs a decision or a measurement the code cannot give).

> **Founder review, 2026-09-03 — read §O first.** The *observations* in this record stand unchanged and were not revisited. Four of its *design proposals* were amended and one open question decided, by the founder, after reading it. Where §D, §E, §F, §G, §K, §L or §14 conflict with [§O](#o-founder-review-and-amendments-2026-09-03), §O is the later decision; the original text is left standing because it is what was proposed at the time, and one of the amendments is only legible beside what it replaced.

---

## A. Executive verdict

**The hypothesis is true, and more true than the brief assumed.** Nova as described — a persistent agent that learns the product, finds what holds the business back, plans, offers to build, and proposes the next step — is already *implemented as separate systems* end to end, including the guided first-run journey. What does not exist is one surface that presents those systems as a single actor, and one read model that knows where a project is in the loop *after* onboarding ends.

1. **How much exists.** Every intelligence, planning, execution, verification and money primitive Nova needs is built, persisted, reuse-keyed and tested. A four-phase guided onboarding with a persisted, reconciled state machine already exists (`src/modules/onboarding/state.ts:10-65`, `store.ts:248-394`) and already speaks in the first person ("This is where I'd start", `src/app/app/onboarding/[projectId]/page.tsx:415`). The account dashboard, project Home and Agent workspace each already derive a "what next" answer from stored rows (§B). Nova's copy is largely already written; it is spread across eleven route files and three pure view-model modules.

2. **What Nova is.** A **presentation layer with a thin, deterministic orchestration read model** — not a new agent architecture, not a new planner, not a new event bus. Concretely: (i) one pure function that derives a *journey position* for a project from canonical rows, extending `deriveOnboardingState` past `first_move`; (ii) one typed feed contract that maps journey positions to existing view models and existing Server Actions; (iii) one UI that renders that contract in Nova's voice. Nothing in the loop moves because of Nova; every consequential transition remains behind the Server Action and durable operation that owns it today.

3. **Genuinely missing primitives (four, and one decision):**
   - **A whole-loop journey derivation.** `deriveOnboardingState` stops at `first_move` (`state.ts:64`); nothing spans plan → prepared change → validation → preview → approval → merge → outcome for a project. The pieces exist as per-artifact projections (`deriveChangeProgress`, `src/modules/execution/change-progress.ts:245`; `agentStageSteps`, `src/modules/coding-agent/observability/agent-stages.ts:209-290`; `planProgress`, `src/modules/action-plans/sequence.ts:165-184`) but no function composes them per project. **NEW PRIMITIVE, pure, ~1 module.**
   - **A bounded "where is the loop" read.** Today "latest operation per kind" is one query per `(projectId, operationType)` (`src/modules/operations/store.ts:150-165`), and the per-artifact reads are scattered across `health/content.tsx:101-134`, `agent/page.tsx`, `plan/page.tsx`. Nova needs one gathering read in the shape of `getProjectOnboarding`'s `Promise.all` (`store.ts:261-276`), bounded to a fixed number of queries. **SMALL ADDITION.**
   - **A typed feed/presentation contract** with a closed action vocabulary bound to existing Server Actions. No equivalent exists; the nearest precedents are `ActivityEntry` (`src/modules/audit-log/view.ts:33-42`) and `OperationProgressStep` (`src/modules/operations/view.ts:206-209`). **NEW PRIMITIVE, UI-side, no persistence.**
   - **Three non-derivable journey facts:** that Nova's introduction was seen, that the "how it works" explainer was seen or skipped, and a founder's explicit "do this later" on a recommendation. Everything else the brief lists as "Nova state" is derivable (§D, §14 table). **SMALL ADDITION — columns on `project_onboarding`, not a table.**
   - **Where Nova lives after onboarding** (Home vs. a rail item) is a product decision that touches ADR 0045/0047 and is reported rather than decided (§D.6, Open).

**Reuse estimate, justified from code.** Counting the capabilities Nova's journey touches (§B lists 19), all 19 have a working implementation; 16 are reusable as-is, 3 need exposure or a variant. Of the ~11 feed entry types Nova renders (§F), 9 have an existing component or pure view model behind them; 2 (introduction, execution offer card) are new copy over existing data. The persisted state Nova needs (§14) is 22 fields: 15 derivable, 4 existing, 3 new columns. On that arithmetic **existing Vibe capability ≈ 85%; new Nova-specific capability ≈ 15%**, and the 15% contains no model call, no sandbox, no new table and no new authority.

---

## B. Existing capability map

| Nova need | Existing system | Exact files | Reusable? | Gap |
|---|---|---|---|---|
| GitHub connection | GitHub App install + repository picker → creates the one project and its `project_onboarding` row | `src/app/app/connect/github/route.ts`, `connect/github/repositories/actions.ts`; `src/modules/onboarding/store.ts:79-101` (`createProjectOnboarding`) | As-is | None. Nova's "GitHub connected" moment is `project_onboarding.state = add_live_product` |
| Scans (repo + live) as one durable run | `product_scan` durable operation; stages `reading_code → reading_public_product → understanding_product`; 24-event discovery feed | `src/modules/operations/product-scan/workflow.ts:63-88`; `execution.ts:74,134`; `src/modules/product-scan/schema.ts:1-20`; `supabase/migrations/20260825120000_product_scan_events.sql:17-40` | As-is | None. Free work (`start-limits.ts:51,67`; `kill-switch.ts:66`) |
| Repository intelligence | Deterministic snapshot, reuse keyed on commit SHA + analyzer version, HEAD read first | `src/modules/repository-intelligence/service.ts:117-158`; `store.ts:229-246`; `budgets.ts:31-38` | As-is | Stage-4 bumps analyzer to v5, making every stored snapshot stale once (*branch* ADR 0078 "Consequences") — Nova must render `repository_analysis_outdated` as "rescan needed" (§8) |
| Live intelligence | Static crawl, 24h freshness reuse, partial on failure | `src/modules/live-product-intelligence/store.ts:153-187`; `budgets.ts:38-52` | As-is | None |
| Product Understanding | Deterministic derivation + one Haiku call; `input_hash` excludes corrections; corrections overlaid on read | `src/modules/product-understanding/runner.ts:198`; `store.ts:105-128, 242`; `assemble.ts:339-364` | As-is | Read through `getLatestProfile` only — `getProfileById` returns the uncorrected document (`store.ts:265`), already an asymmetry in `product-scan-status-action.ts:37-40` |
| Product Understanding presentation | `buildUnderstandingView`, `buildProductScanPresentation` (compact), `UnderstandingPanel`, onboarding reveal card | `src/modules/product-understanding/view.ts:398-427`; `src/modules/product-scan/presentation.ts:26-68`; `src/app/app/projects/[projectId]/understanding-panel.tsx:111-129`; `onboarding/[projectId]/page.tsx:285-340` | As-is (data), Refactor (component) | The compact reveal card is inline JSX in the onboarding page, not a component |
| Confirm / correct understanding | `confirmProfile` writes `product_profiles.confirmed_at`; seven-field correction allowlist; saving also confirms | `src/modules/product-understanding/store.ts:403-418`; `schema.ts:435-457`; `src/app/app/onboarding/[projectId]/actions.ts:213-304`; `product-confirmation.tsx:59-142` | As-is | The onboarding action couples "confirm" with "start the audit" (`actions.ts:253`). Nova's "Looks right" must be able to confirm *without* starting a paid audit as a side effect (§G step 4) |
| Founder context (intent) | Closed enums stage / monetization / goal, hashed into audit identity | `src/modules/projects/founder-intent.ts:48-76`; `supabase/migrations/20260816020000_founder_intent_and_audit_traceability.sql:28-51` | As-is | None |
| Founder questions, audit phase | Deterministic question selection, ≤5 candidates, ≤3 interruptions per run, one pending, enum answers, same operation resumes | `src/modules/business-audit/founder-questions.ts:46-57, 83, 131-263`; `needs-user.ts:134, 164-176`; `answer-routing.ts:213-255`; `src/modules/operations/service.ts:159-192` | As-is | `NeedsUserPanel` already dual-surface (`needs-user-panel.tsx:70-72`). `business_audit.resumed` is declared but never emitted (§C note) |
| Founder questions, plan phase | `FounderInputRequirement`, `confirm / single_select / text`, recommendation + alternatives, custom path, supersession chain | `src/modules/founder-input/schema.ts:11-35`; `resolve.ts:22-59`; `supabase/migrations/20260825132534_founder_input_resolution.sql:53-180`; `src/components/founder-input/founder-input-card.tsx:25-43` | As-is | Two question systems, deliberately separate (audit vs plan). Nova presents both through one entry type; it must not merge their storage |
| Audit | One Sonnet call, nine lenses, deterministic overall score, `input_hash` reuse, `needs_user` pause | `src/modules/business-audit/runner.ts:188`; `scoring.ts:41-69`; `store.ts:176-214, 370-386`; `src/modules/operations/business-audit/execution.ts:160-166` | As-is | Requires live product intelligence (`service.ts:174`, `execution.ts:160`) — a repo-only founder parks the audit (`onboarding/audit-surface.ts:53-61`) |
| Audit presentation | `BusinessBrainView`, `HomeHealth`, `HomeFinding`, `OnboardingAuditReveal` | `src/modules/projects/business-brain-view.ts:85-104, 181-258`; `command-center.ts:54-64, 114-143`; `onboarding/[projectId]/audit-reveal.tsx:19-60` | As-is | "Strongest areas" is not in any view model; read `audit.synthesis.strengths` directly (`business-audit/schema.ts:305-320`) |
| Opportunities / Moves | Ranked set, lineage to conclusion, Now/Next/Later derived from rank, 20 Credits, bundled free on first reveal | `src/modules/opportunities/schema.ts:108-176`; `view.ts:81-85`; `src/app/app/onboarding/[projectId]/actions.ts:306-376`; `src/modules/credits/retail.ts:303-306` | As-is | None |
| Action Plan | Steps with actor / changeKind / server-derived `executionSupport`; `firstActionableStep`; three completion authorities; staleness | `src/modules/action-plans/schema.ts:274-334`; `sequence.ts:146-184`; `completion.ts:89-145`; `service.ts:344-467` | As-is | None; 20 Credits, founder-started (rule 60) |
| Agent eligibility ("can Vibe build this?") | Execution resolver, pure; `resolvePlanExecutionRoutes` with no allowlist/network/spend; `stepResponsibility` | `src/modules/execution-contract/resolver.ts:216-440`; `src/modules/coding-agent/website-preflight.ts:389-442`; `src/modules/action-plans/view.ts:193-209` | As-is | Stage-4 adds `workspace_choice_required` / `repository_analysis_outdated` reasons (*branch* `validation/profile.ts:137-207`) |
| Execution offer (cost, risk, caveat) | Budget ceiling by pricing class (150/200/350), `forecastRun` (free, offline), closed-enum labels, build-chain offer | `src/modules/execution-contract/budget.ts:188-231`; `src/modules/coding-agent/run-forecast.ts:154-201`; `execution-contract/view.ts:42-103`; `agent/agent-start-cta.tsx:73-97`; ADR 0077 | As-is | The offer needs a built spec, which needs a live HEAD read (`website-preflight.ts:741-748`) — cheap, but not cacheable across the click |
| Coding agent | Sandbox harness, gateway, verification, four durable stages, event log | `src/modules/coding-agent/*`; `operations/schema.ts:246-254`; `agent-workspace.ts:50-135` | As-is | None |
| Validation | Sandbox run, statuses `queued/running/passed/failed/cancelled`, auto-enqueued after a run (ADR 0037) | `src/modules/validation/schema.ts:117`; `src/modules/operations/agent-execution/steps/finish.ts:376-428` | As-is | Stage-4 replaces the Next.js whitelist with `node_build_v1` and workspace roots (*branch*) |
| Preview | Dev-server preview beside validation, 15-minute TTL, dev-server table decides availability (*branch*) | `src/modules/change-preview/budgets.ts:38`; *branch* `change-preview/dev-servers.ts`; `supabase/migrations/20260903100000_preview_dev_server_table.sql` | As-is | "Preview unavailable, checking and merging still work" is a first-class `null` on the branch — Nova copy must keep that distinction (§8) |
| Prepared Change + review | `prepared_changes`, review classification `visual / code / visual_and_code`, code digest | `src/modules/execution/schema.ts:235-240`; `src/modules/review/classification.ts:47, 183-232`; `src/modules/approvals/identity.ts:72-92` | As-is | There is no `none` classification — Nova must not invent one |
| Approval + merge | Immutable approval identity; merge preflight twice; fast-forward-or-refuse; verified read-back | `src/modules/approvals/schema.ts:60-68`; `src/modules/merge/preflight.ts:32-38, 100-180`; `merge/schema.ts:79-155` | As-is | None |
| Outcome verification | Two profiles, statuses incl. `not_observed`; business measurement `waiting_for_source` | `src/modules/outcome-verification/schema.ts:67-88, 238-251`; `business-measurement/schema.ts:169-179` | As-is | No metric source (ARCHITECTURE §7.2) — Nova must say "not measured, no source", never "worked" |
| Activity / events | Append-only `audit_events` with typed projection and route-free renderer; closed vocabulary | `src/modules/audit-log/events.ts`; `view.ts:33-42, 288`; `activity-feed.tsx:62-68`; `supabase/migrations/20260815180000_audit_events_project_id.sql:51-53` | As-is (as history) | It records what happened, never what is pending — not a source of truth for Nova state (§16) |
| Progress polling | `useOperationPoll`, `OperationPollPhase` five words, stage labels, named progress sequences | `src/lib/client/use-operation-poll.ts:97-141`; `src/modules/operations/view.ts:97-119, 206-262` | As-is | None |

**What "where is this project in the loop?" already resolves to.** Five pure derivations exist and none spans the whole loop: `deriveOnboardingState` (10 states, stops at `first_move`, `onboarding/state.ts:50-65`); `buildHomeView` (health / finding / next move, `projects/command-center.ts:169`); `buildAttentionItems` / `orderProjectsByAttention` (5 kinds × 4 tiers across projects, `projects/attention.ts:175-220`); `buildAgentFocus` (one Move, `projects/agent-focus.ts:97-108`); `deriveChangeProgress` (12 stages of one prepared change, `execution/change-progress.ts:39-63, 245`). That is the gap Nova's read model fills — by composing these, not by re-deciding any of them.

---

## C. Existing AI call map

Confirmed by grepping every `generateStructured` call site outside the adapter: there are exactly four, one per operation, plus the agent loop.

| Feature | Call site | Model / effort (`src/modules/ai/operations.ts`) | Input | Output | Persisted? | Nova reuse |
|---|---|---|---|---|---|---|
| Product Understanding | `src/modules/product-understanding/runner.ts:198` ("The single billable call") | Haiku 4.5, no thinking (`:164-174`) | Evidence pack from repo + live snapshots (deterministic half computed first) | Eleven semantic fields + category + capability ranking (`wire-schema.ts:27-39`) | `product_profiles.result`, keyed by `input_hash` (`store.ts:105-128`) | **B — present directly.** `buildUnderstandingView` / `buildProductScanPresentation`. Free to the customer (`retail.ts:308`) |
| Business Audit | `src/modules/business-audit/runner.ts:188` | Sonnet 5, adaptive high (`:63-74`) | Evidence pack v4 (repo, live, deep scan, profile, founder intent) | `business-readiness-audit.v2` document; score computed in code (`scoring.ts:41-69`) | `business_readiness_audits.result`, keyed by 13-value `input_hash` (`store.ts:176-214`); reuse emits `business_audit.reused` (`operations/service.ts:246-263`) | **B.** 35 Credits, first one included (`entitlement.ts:45-84`) |
| Opportunities | `src/modules/opportunities/runner.ts:162` | Sonnet 5, adaptive high (`:120-127`) | Audit + its evidence pack | ≤5 ranked Moves with conclusion lineage | `opportunity_sets` / `business_opportunities`, keyed on audit id + audit hash + versions (`opportunities/store.ts:152-175`) | **B.** 20 Credits; free once on the onboarding reveal (`onboarding/[projectId]/actions.ts:330-350`) |
| Action Plan | `src/modules/action-plans/runner.ts:183` | Sonnet 5, adaptive high (`:210-237`) | One Move, its conclusion, cited evidence, profile, intent (`evidence.ts:50-65`) | 2–9 steps incl. `FounderInputRequirement`s; `executionSupport` derived server-side | `action_plans` / `action_plan_steps`, 15-value `input_hash` (`action-plans/store.ts:225-266`) | **B.** 20 Credits, founder click |
| Agentic execution | harness in the sandbox via the Agent Gateway (`src/modules/coding-agent/`) | Sonnet 5, high (`:249-253`) | Compiled brief ≤6 KB + spec | A candidate change, verified by Vibe (`candidate.ts:403-470`) | `agent_execution_runs`, `prepared_changes`, event tables | **B.** Progress and result read from rows; 150/200/350 Credits by class |

**Duplicated AI work today: none found.** Each operation has a reuse identity checked before any hold is taken (`operations/service.ts:245-263`, `:526`, `:952`, `:682-692`), and `maxRetries = 0` on each billable step (`product-scan/workflow.ts:46`, `business-audit/workflow.ts:72-73`). One near-miss worth naming: a Product Scan always forces both scanners (`product-scan/execution.ts:94, 168`) and only the profile-level `input_hash` prevents a second Haiku call for identical snapshot ids — a Nova "rescan" button is therefore a fresh crawl every time, which is free in tokens but not in time.

Two record-keeping findings from the trace, both Confirmed:
- `business_audit.resumed` is declared (`audit-log/events.ts:77`) and labelled (`view.ts:94`) but has no emitter in `src/`; the resume path records only `business_audit.question_answered` (`answer-service.ts:105`).
- The roadmap entry "No surface can show an agent run in flight" (`docs/ROADMAP.md:141`) is stale at HEAD: `readAgentWorkspace` locates the latest `agent_execution` operation per project (`coding-agent/agent-workspace.ts:117-120`) and builds a six-phase timeline from the event log (`:53-63`). The record stands; the roadmap entry should be closed by the next sprint that touches it.

---

## D. Proposed Nova domain model

Six things, kept apart on purpose.

**1. Existing Vibe domain state (authoritative, unchanged).** `projects`, `project_onboarding`, `repository_connections` (+ `workspace_root` on the branch), snapshots, `product_profiles` + corrections, `project_founder_intent`, `business_readiness_audits` (+ `pending_question`), `opportunity_sets`, `action_plans/_steps`, `project_founder_input_requests/_resolutions`, `execution_specs`, `agent_execution_runs`, `execution_interrupts`, `prepared_changes`, `validation_runs`, `preview_sessions`, `change_approvals`, `change_merges`, `change_outcome_verifications`, `operation_runs`, `audit_events`, `product_scan_events`. Nova writes to none of these except through the Server Actions that already write to them.

**2. Nova state (persisted, minimal).** Three columns on `project_onboarding`, which ADR 0023 already defines as "the few facts that are genuinely about the journey": `nova_introduced_at timestamptz`, `nova_workflow_explained_at timestamptz` (null = not yet; set on "Show me" *or* "Start now" so a skipped explainer is not re-offered), and a deferral record for "Do this later" — the smallest honest shape is `deferred_recommendation_key text` + `deferred_at timestamptz` (both-or-neither CHECK, key = the Move id or `plan:<stepKey>`). Nothing else. `state` and `live_site_status` already exist and keep their meaning. A separate `nova_state` table is rejected (§14, §M).

**3. Nova read model (derived, never stored).** `deriveJourney(facts): JourneyPosition` — a pure function in the shape of `deriveOnboardingState`, taking the twelve existing onboarding facts plus the loop facts (latest plan view, latest agent operation, latest prepared change with its `ChangeProgress`, open founder-input request, open interrupt, latest failed operation per kind, approval/merge/outcome rows for that change, Stage-4 validation target resolution). It returns one position from a closed list (§E) plus the identifiers a feed needs. Its gathering read `readNovaJourney(supabase, { projectId, userId })` is one bounded `Promise.all`, modelled on `getProjectOnboarding` (`onboarding/store.ts:261-276`) and `health/content.tsx:101-134`.

**4. Nova presentation (typed, closed).** A discriminated union of feed entries (§F), each carrying either an existing view-model value (`UnderstandingView`, `BusinessBrainView`, `BusinessOpportunity`, `ActionPlanView`, `AgentWorkspaceView`, `ApprovalCard`, `OutcomeCard`, `OperationProgressStep[]`, `PendingQuestion`, `FounderInputRequest`) or static copy keyed by position. Copy is static or templated over those values; no field of any entry is model-generated at render time.

**5. User decisions (closed action vocabulary).** Every Nova choice is a `NovaAction` id bound to exactly one existing Server Action (§11). The binding table is the whole authority surface, and it is a test fixture: a choice that names no existing action cannot render.

**6. AI inference and execution (untouched).** The four single-call operations and the agent run are started only by the Server Actions in the binding table, each of which re-runs its own admission (`startBusinessAuditOperation` at `operations/service.ts:211-410`; `startAgentRunAction` re-runs `previewDogfoodStep` at `agent-dogfood/[stepKey]/actions.ts:119-124`). Nova never calls `AIProvider`, never builds a spec, never holds Credits.

**Where Nova lives (Open).** First run: the existing `/app/onboarding/[projectId]` route, rendered by the Nova feed instead of by the phase-switch JSX — same URL, same state machine, same redirect rule from `/app` (`onboarding/store.ts:166-241`). After onboarding: the recommendation is the top of project Home, above the Business Brain, in a `"workspace"` variant of the same feed showing only the current position and the next action — which is what ADR 0047 permits ("must strengthen the same diagnosis-and-next-action story") and what `HomeStatus` already is (`home-status.tsx:42-54`, currently imported only by the e2e scenario page). A seventh rail item "Nova" is the alternative; it would re-open ADR 0045's seven-section decision. Either way needs a short ADR; this record does not choose.

---

## E. State machine / lifecycle

Positions are derived, in order, by the first predicate that holds — exactly `deriveOnboardingState`'s style (`onboarding/state.ts:50-65`). The first ten are the existing onboarding states; the rest extend the same cascade. "Trigger" is the persisted fact that flips the position; "AI" and "Sandbox" say whether the *transition out* of the position costs either.

| # | Position | Authoritative predicate (file) | Transition trigger | AI | Sandbox | Resume behaviour |
|---|---|---|---|---|---|---|
| 1 | `connect_source` | no live `repository_connections` row (`store.ts:336`) | GitHub App install + repository pick → `project.created` | no | no | `/app` redirects here while `!hasCompleted` (`store.ts:188-241`) |
| 2 | `introduce` **(new)** | `nova_introduced_at is null` | "Continue" writes the timestamp | no | no | Shown once per project |
| 3 | `explain_workflow` **(new, optional)** | `nova_workflow_explained_at is null` | "Show me" / "Start now" | no | no | Skipped once seen |
| 4 | `add_live_product` | `live_site_status ∈ {undecided, scan_failed}` (`state.ts:53-55`) | `beginUnderstandingAction` sets `provided` or `no_live_site_yet` and starts the scan (`actions.ts:76-115`) | no | no | Persisted choice |
| 5 | `product_scanning` | no snapshot, or scan operation active, or no profile (`state.ts:56-58`) | `product_scan` completes → profile row (`product-scan/execution.ts:223`) | **yes, one Haiku call** (free to customer) | no | Poll `product_scan_events`; failed → `getLastFailedOperation` + retry; stalled after 10 min (`view.ts:45`) |
| 6 | `product_reveal` | profile exists, `confirmed_at is null` (`state.ts:59`) | `confirmProfile` / `saveCorrections` | no | no | Confirmation is a row; refresh-safe |
| 7 | `audit_preparing` / `audit_running` / `audit_needs_user` / `audit_reveal` | as today (`state.ts:60-63`), surface from `auditSurface` (`audit-surface.ts:53-61`) | `startBusinessAuditOperation`; pause on `pending_question`; `audit_revealed_at` | **yes, one Sonnet call** (35 Cr, first included) | no | Same operation resumes after an answer (`operations/service.ts:159-192`); parked without a live product |
| 8 | `first_move` | `audit_revealed_at` set, `completed_at` null (`state.ts:64`) | `revealAuditAndFindFirstMoveAction` starts opportunities (free once) → `first_move_viewed_at` | **yes, one Sonnet call** (bundled free) | no | Opportunity operation polled; "no Move" is an honest state (`page.tsx:433-437`) |
| 9 | `plan_offered` **(new)** | onboarding complete; latest opportunity set current; no current plan for the top Move (`getLatestActionPlan` null or stale) | `startPlanAction` (20 Cr, founder click) | **yes, one Sonnet call** | no | Plan operation polled with `operationProgressSteps("action_planning")` |
| 10 | `founder_input_required` | `ActionPlanView.founderInputRequest` non-null for the first actionable step (`action-plans/service.ts:456-465`) | `resolveFounderInputAction` (`founder-input-action.ts`) | no | no | One open request per subject; superseded on replan |
| 11 | `step_ready` / `execution_offered` | `planProgress = "ready"` and `resolvePlanExecutionRoutes` gives `intrinsicMode = "agentic"` for `firstActionableStep` (`website-preflight.ts:389-442`); Stage-4: validation target `supported` | `startAgentRunAction` (150/200/350 Cr) | **yes, agent loop** | **yes, agent sandbox**, ephemeral | Offer recomputed on every render; nothing cached across the click |
| 11a | `workspace_choice_required` **(Stage 4)** | *(branch)* `profile.ts:184-195` returns candidates; `repository_connections.workspace_root` null or not a candidate | `chooseWorkspaceRoot` server action (*branch* `agent/workspace-actions.ts:57-82`) | no | no | Free, reversible, starts nothing |
| 11b | `repository_read_outdated` **(Stage 4)** | *(branch)* `repository_analysis_outdated` from `resolveValidationProfile` | founder starts "Scan my product again" (free, rule 60) | no (one Haiku call follows) | no | Stale read is rendered first, before any candidate list (*branch* `agent/page.tsx:404-406`) |
| 11c | `step_not_buildable` | resolver mode `manual` / `needs_user_input` / `unsupported` / `blocked` (`resolver.ts:216-375`) | founder attestation, founder input, or nothing | no | no | Copy from `EXECUTION_MODE_LABELS` / `EXECUTION_REASON_LABELS` |
| 12 | `agent_working` | `operation_runs` `agent_execution` `running`; stage ∈ `preparing_workspace…verifying_change` (`operations/schema.ts:246-254`) | run terminal | — | sandbox alive | `AgentWorkspaceView.stages`; interrupt → 12a |
| 12a | `agent_question` | `agent_execution_runs.status = needs_user_input`, open `execution_interrupts` row linked to a founder-input request | `resolveAgentInterruptAction` — records the answer, does **not** resume; a fresh admission follows (`interrupt-actions.ts:14-27`) | no | sandbox destroyed | Credits released at the interrupt boundary (ADR 0053) |
| 12b | `agent_failed` | run `failed`/`cancelled`; `agent_execution.failed` event | retry via a new start (new spec, new hold) | — | destroyed | `getLastFailedOperation(agent_execution)` |
| 13 | `validating` | `validation_runs.status ∈ {queued, running}`; auto-enqueued (`finish.ts:376-428`) | verdict `passed`/`failed`; hold settles on the verdict (ADR 0073) | no | **yes, validation sandbox**, destroyed after | `ValidationSummary`; "Validate again" is explicit |
| 14 | `review_ready` | `prepared_changes.status = prepared`, validation `passed`, classification `visual`/`code`/`visual_and_code` (`classification.ts:47`) | founder opens preview (`change_preview`, 15 min) and/or diff; `createApprovalAction` | no | **preview sandbox only while open** | Approval binds to commit + evidence hash (`approvals/identity.ts:72-92`) |
| 14a | `validation_failed` | `validation_runs.status = failed` | "Validate again" or discard | no | no | `failedPhase` names the phase |
| 15 | `approved_ready_to_merge` | active `change_approvals` row; merge preflight `eligible` (`merge/preflight.ts:81-97`) | `startMergeAction` → `change_merge` operation | no | no | Preflight re-run inside the writing step (`preflight.ts:32-38`) |
| 15a | `merge_blocked` | preflight `blocked` with a reason from `merge/schema.ts:116-155`; or approval `invalidated` | founder decides: re-validate, re-approve, or discard | no | no | `change_merge.not_eligible` deduplicated event |
| 16 | `merged` | `change_merges.status = merged` and read-back equal (`20260814140000:145-151`) | founder starts outcome verification (free) | no | no | `merged` means one sentence (rule 74) |
| 17 | `outcome_observed` / `not_observed` / `partial` | `change_outcome_verifications.status` (`outcome-verification/schema.ts:238-251`) | plan completion projection updates (`completedStepsForExecutionRouting` requires merged, `completion.ts:133-145`) | no | no | Nova proposes the next step = new `firstActionableStep`, or the next Move, or "re-scan business" when the plan/audit is stale |

Two rules the cascade must keep, both already enforced upstream: **no paid transition is ever taken by Nova on the founder's behalf** (rule 60; the one existing automatic *free* start is `revealAuditAndFindFirstMoveAction`, gated by winning `audit_revealed_at`), and **a position never advances on a rendered fact** — the Server Action re-derives (`completeOnboardingAction` is the template, `actions.ts:378-421`).

---

## F. Nova UI contract

A closed union of entry types. Each names the existing thing it renders. Names are illustrative.

| Entry | Carries | Existing reuse | Route-free today? |
|---|---|---|---|
| `nova.message` | static copy keyed by position; optional templated facts (product name, score) | `MonoLabel`, `Surface` (`components/ui/`) | yes |
| `nova.choice` | `{ prompt, options: { actionId, label, tone, price? }[] }`; options bind to the action registry (§11) | `Button`, `CreditPrice` (`credit-price.tsx:54`), `ConfirmPanel` for consequential ones | yes |
| `nova.progress` | `OperationView` + `OperationProgressStep[]` or `ProductScanEvent[]` | `PlanProgressSteps` (`plan/plan-progress-steps.tsx:32-40`, already has `variant`), `ProductScanExperience` (`variant`, `product-scan-experience.tsx:73-83` — export its props type), `OperationWatcher` pattern | yes |
| `nova.product_understanding` | `ProductScanPresentation` (compact) or `UnderstandingView`; confirm/correct actions | `ProductConfirmation` (`product-confirmation.tsx:59`), `UnderstandingConfirm` (`understanding-confirm.tsx:85-94`), reveal card JSX (`onboarding/[projectId]/page.tsx:285-340`) → extract to a component | yes |
| `nova.founder_question` | `PendingQuestion` (audit) **or** `FounderInputRequest` (plan/runtime) | `NeedsUserPanel` (`needs-user-panel.tsx:58-64`), `FounderInputCard` (`founder-input-card.tsx:25-43`, action injected) | yes |
| `nova.audit` | `BusinessBrainView.overall` + `primaryPriority`, `synthesis.strengths[0..2]`, `HomeNextMove` | `OnboardingAuditReveal` (`audit-reveal.tsx:19-60`), `BusinessMap`, `ReasoningTrail` (`reasoning-trail.tsx:62`) | yes |
| `nova.move` | `BusinessOpportunity` (rank 1), band label, `firstActionableStep`, "I can handle N of these" from `resolvePlanExecutionRoutes` | `MoveCard` (`plan/move-card.tsx:95-104`), first-move card JSX (`page.tsx:403-440`) | yes |
| `nova.execution_offer` | step title, `doneWhen`, ceiling `maxCredits`, `RunForecast` sentences, risk label, chain offer (2 prices) | `AgentStartCta` (`agent-start-cta.tsx:73-97`), `AgentStartRefusalNotice`, *(branch)* `AgentWorkspaceChoice`, `AgentStaleReadNotice` | yes |
| `nova.execution_progress` | `AgentWorkspaceView.stages` (five stages, seven state words) + `timeline` | `AgentStageRail` (`agent-stage-rail.tsx:133-148`, callback-selected), `AgentQuestionPanel` | yes |
| `nova.review` | `ChangeProgress`, `ValidationSummary`, `PreviewCard`, `PreparedDiff`, `ApprovalCard` | `ValidationPanel`, `PreviewPanel`, `DiffView` (`diff-view.tsx:174`), `ApprovalPanel` (`approval-panel.tsx:141-155`, `presentation` prop) | yes |
| `nova.outcome` | `MergeCard`, `OutcomeCard`, next recommendation | `MergePanel`, `OutcomePanel` (`outcome-panel.tsx:210-224`, `presentation` prop), `HomeStatus` (`home-status.tsx:42-54`) | yes |

Two constraints inherited from the codebase: every entry that shows a stage shows **named stages and no percentage** (`operations/schema.ts:16-19`, `view.ts:151-162`), and a `needs_user` operation renders as **waiting, never working** (`e2e/agent-stages.spec.ts:73`, `e2e/audit-lifecycle.spec.ts:98`). `ProductScanExperience` and the panels with a `"section" | "workspace"` prop get a third `"feed"` value rather than a fork — the established extension mechanism.

---

## G. Onboarding specification (first run, screen by screen)

Each row: what the founder sees · what Vibe knows · where it comes from · AI call · what advances.

1. **Connect.** "Show Vibe what you built." → Connect GitHub. Knows: nothing yet. Source: session only. AI: no. Advances: GitHub install + repository pick creates the project and the `project_onboarding` row (`store.ts:79-101`). *(Existing screen, `onboarding/page.tsx:39-62`.)*
2. **Nova introduces itself.** "Hi, I'm Nova, your Vibe Business agent. I'll learn how your product works, find what's holding the business back, build a plan, and where I safely can, build the changes for you." → Continue. Knows: repository full name (`store.ts:282-286`). Source: `project_onboarding` + connection. AI: no. Advances: `nova_introduced_at` written.
3. **How Nova works** (optional). Four static rows: Understand → Find the biggest opportunities → Build a plan → Build what Nova can safely handle. → "Show me" / "Start now". AI: no. Advances: `nova_workflow_explained_at`.
4. **One more view of your product.** Existing live-site step (`live-site-step.tsx`): URL or "I don't have a live product yet". Knows: repo connected. AI: no. Advances: `beginUnderstandingAction` (`actions.ts:76-115`) writes `live_site_status` and starts `product_scan`.
5. **Let's start by learning your product.** `ProductScanExperience` in feed variant showing the 24 stored discovery events as they land (1.8 s poll, `product-scan-experience.tsx:49`). Knows: stage (`reading_code` / `reading_public_product` / `understanding_product`). Source: `operation_runs.stage`, `product_scan_events`. AI: **one Haiku call inside the operation** (free to the customer). Advances: profile row exists → position 6. Failure: `getLastFailedOperation` → "Try again" (`phase-actions.tsx:14`); a failed live source degrades to partial, never blocks (`product-scan/execution.ts:171-180`).
6. **Here's what I understood.** Compact card: name, one-line description, purpose, promise, who it's for, problem solved, logo; up to three capabilities. Source: `buildProductScanPresentation` / `buildUnderstandingView` over `getLatestProfile` (corrections applied, `store.ts:242`). AI: no. Choices: **Looks right** → `confirmProfile`; **Something's off** → seven-field inline editor (`product-confirmation.tsx:85-140`) → `saveCorrections` + `confirmProfile`. Advances: `confirmed_at` set. *Change required:* today both actions also start the audit (`actions.ts:253, 303`). Nova keeps confirmation and the audit start as two choices so that "Looks right" never spends 35 Credits as a side effect for a founder past their free audit; onboarding may still offer "Continue your Business Audit" immediately after, as `StartAudit` does (`phase-actions.tsx:48-75`).
7. **Founder questions.** Only when the audit pauses: one `PendingQuestion` at a time, closed-enum radio options plus "I'm not sure" (`needs-user-panel.tsx:77-121`; `answer-routing.ts:244-255`), ≤3 per audit (`needs-user.ts:134`). Founder intent (stage / monetization / goal) is *not* asked up front — the audit asks only what its evidence cannot answer (`founder-questions.ts:131-263`). AI: no (the answer resumes the same paid operation, no second call). Advances: `resumeAnsweredAuditOperation`.
8. **Now I'm looking at the business around it.** Audit progress: `preparing` → `running_ai` ("Analyzing business"); no per-lens progress because there is one call (`audit-lifecycle.tsx:13-23`). Source: `operation_runs`. AI: **one Sonnet call** (35 Cr, first included; `entitlement.ts:45-84`). Without a live product: "One part of the business audit is waiting on a live product" and setup can finish parked (`audit-surface.ts:75-85`).
9. **Here's what I found.** `synthesis.overall` sentence, score or "not enough evidence to score", Business Map, "What matters first" = `blockers[0]`, two strongest areas = `synthesis.strengths[0..1]`. Source: `getLatestSuccessfulAudit` + `buildBusinessBrainView` (`audit-reveal.tsx:19-24`). AI: no. Choice: **Show me where to start** → `revealAuditAndFindFirstMoveAction` — the one automatic start, free once because the caller won `audit_revealed_at` (`actions.ts:330-350`).
10. **This is where I'd start.** Rank-1 Move: title, problem, why now; band "Now". Source: `opportunity_sets` (`page.tsx:413-425`). AI: **one Sonnet call** (bundled free). Choices: **Plan this move** (20 Cr, priced beside the button, rule 60) → `startPlanAction`; **Show the other moves** → Action Plan; **Do this later** → deferral column. Advances: `first_move_viewed_at`; "Go to your workspace" → `completeOnboardingAction` (`actions.ts:378-421`).
11. **I turned this into N concrete steps. I can handle K of them.** Plan steps with `stepResponsibility` copy (`action-plans/view.ts:193-209`); K from `resolvePlanExecutionRoutes` (`website-preflight.ts:389-442`, no allowlist, no network, no spend). Founder-owned steps render as `FounderInputCard`. AI: no.
12. **I can build this for you.** Offer for `firstActionableStep` when agentic: what it accomplishes (`title`, `completionCriteria`), "Up to {maxCredits} Credits" (`agent/page.tsx:423-425`), one forecast sentence, one risk sentence (`EXECUTION_RISK_LABELS`), the chain offer at its own price when applicable (ADR 0077). Technical detail (validation profile, network mode, allowed paths) behind `TechnicalDetails` (`disclosure.tsx:71`). Stage 4: if `workspace_choice_required`, the offer is replaced by the application question (one button per candidate, no field — *branch* `agent-workspace-choice.tsx:15-21`); if `repository_analysis_outdated`, by "I need to re-read your code first" + the free rescan. AI: no. Choice: **Let Nova build it** → `startAgentRunAction` (re-runs the whole preflight on the click, `actions.ts:119-157`).
13. **Working.** Five stages, seven state words, from `AgentWorkspaceView` (`agent-stages.ts:45, 48-64`; `agent-stage-rail.tsx:68-76`): "✓ Product context loaded" = `understand` done; "● Building the change" = `build` active with the event-log timeline; "○ Independent check" = `validate` pending. Every mark is a stage state from stored rows. A question stops the run and shows `FounderInputCard` (runtime origin). AI: the run itself. Advances: verdict.
14. **It's ready.** Human-readable summary = the step's title and `doneWhen`; changed file count from `prepared_changes.files`; validation result from `ValidationSummary` (never "safe" — rule 66, `command-center-ui.test.ts:85`); preview link if the dev-server table has a row, otherwise "Interactive preview isn't available for this stack yet — checking and merging still work" (*branch* `dev-servers.ts:21-27`); code diff. CTA **Review** → `ApprovalPanel` (evidence-bound approval, `approvals/identity.ts:72-92`), then **Apply** → `MergePanel` with the CI/CD sentence (rule 74). AI: no.
15. **Done. Here's what changed.** `MergeCard` (default branch now at the approved commit, read back), outcome check state (`verified` / `not_observed` / `partial`, never "deployed"). **The next thing I'd work on is…** = new `firstActionableStep` after `completedStepsForExecutionRouting` (requires merged, `completion.ts:133-145`), else the next Move by rank, else "Re-scan business" when `planStaleness` / `getAuditCurrency` say so. AI: no.

---

## H. AI cost analysis

**Per normal onboarding through the first merged improvement, today:**

| Call | Model | Customer price | Reused when |
|---|---|---|---|
| Product Understanding | Haiku 4.5 | free | same snapshot ids + versions (`product-understanding/store.ts:105-128`) |
| Business Audit | Sonnet 5 | 35 Cr, first included | same 13-value identity (`business-audit/store.ts:176-214`) |
| Opportunities | Sonnet 5 | 20 Cr, free on the onboarding reveal | same audit id + hash + versions |
| Action Plan | Sonnet 5 | 20 Cr | same 15-value identity |
| Agent run | Sonnet 5 (loop) | 150 / 200 / 350 Cr by class | same run identity → `reused` (`coding-agent/service.ts:185-201`) |

**Incremental Nova calls on the happy path: zero.** Every sentence Nova says in §G is static, templated over a persisted view model, or a field of a persisted AI output. Confirmed by construction: the feed contract (§F) has no entry type whose payload is generated at render time, and the action registry (§11) contains no action that reaches `AIProvider`.

**Category C, where a new inference would be genuinely needed — none in V1, three candidates for later, each rejected or deferred:**
- *Founder gives previously unknown context.* Already handled without a Nova call: corrections overlay the profile on read (`assemble.ts:339-364`); intent changes the audit's `input_hash`, and the next audit is a founder-started re-run at the existing price (`getAuditCurrency`, `business-audit/service.ts:338-391`). Nova's job is to say "your audit is now out of date" — `audit_stale` already exists (`opportunities/service.ts:30-34`).
- *Repository state materially changed.* `repository_head_moved` / `repository_snapshot_stale` (`resolver.ts:398-416`) and Stage-4's `repository_analysis_outdated` are deterministic. Nova explains; the founder rescans (free) and re-audits (priced).
- *A synthesised "Nova summary" across audit + plan + run.* Tempting and unnecessary: `synthesis.overall`, `blockers[0].headline`, `opportunity.whyNow`, `plan.goal` and `step.purpose` are already one-sentence fields written for a founder. Deferred until a dogfood shows a screen that reads badly with them.

**Where a naive implementation would double-spend, each with the guard that exists:**
1. "Looks right" starting an audit as a side effect — today's onboarding action does exactly that (`actions.ts:253`); fine while the first audit is free, a 35-Credit surprise after. Split the actions (§G.6).
2. A Nova "refresh" that re-runs `product_scan` on every visit — the scan forces both scanners (`product-scan/execution.ts:94, 168`); rate-limited to 20/h (`start-limits.ts:51`) but each is a fresh crawl. Rescan is a choice, never a render effect.
3. Re-deriving the execution offer *with* a live HEAD read on every poll tick — `resolveExecutableStep` reads GitHub (`website-preflight.ts:741-748`). Render the offer from `resolvePlanExecutionRoutes` (no network); do the live read only on the click, as `startAgentRunAction` already does.
4. Retrying a paused operation as a new one — `resumeAnsweredAuditOperation` requeues the *same* run (`operations/service.ts:139-149`); a Nova "continue" must call it, never `startBusinessAuditOperation`.
5. Two feeds polling the same operation — `useOperationPoll` is one-in-flight per hook (`use-operation-poll.ts:198-219`), not per page; the feed must own the single watcher for a position, as `OperationWatcher` does (`operation-watcher.tsx:38-64`).
6. Generating Nova copy with a model "for warmth" — a call per message, per visit, per founder, with no reuse key and no ledger row that means anything. §M.

---

## I. Sandbox / compute architecture

1. **Does Nova need a persistent VM? No.** Nothing in §E holds a process between founder actions. Nova's persistence is `project_onboarding` + the canonical rows; "always there" is a read (`readNovaJourney`), and the existing product already proves the model — onboarding survives days away because `getProjectOnboarding` reconciles from rows (`store.ts:243-247`).
2. **When the existing sandbox is needed, exactly:** (a) the agent run — one microVM per run, created by the `agent_execution` operation and destroyed at its end (ADR 0029/0070; `operations/schema.ts:100-105`); (b) validation — one microVM per `validation_runs` row, cloning the pinned commit, destroyed after (ADR 0015; `validation/schema.ts:117`); (c) preview — one microVM per `preview_sessions` row, 15-minute TTL enforced twice (`change-preview/budgets.ts:25-38`); (d) Deep Scan browser — a sandbox Vibe owns, only while a founder signs in (ADR 0076). Positions 1–11 and 14–17 of §E touch none of them.
3. **Can scanning, planning and presentation happen without it? Yes, all of it.** Repository intelligence reads files through the GitHub API into memory under budgets (`repository-intelligence/budgets.ts:31-38`); the live scan is static HTTP (ADR 0010); the four AI operations are single calls with no tools (rule 41); every Nova render is a database read.
4. **When should the sandbox terminate?** Exactly when it does today: the agent VM at run end (interrupt included — the interrupt is a stop boundary, ADR 0053), the validation VM at verdict, the preview VM at `expires_at` or explicit stop (`preview_teardown`, `operations/schema.ts:29-35`). Nova adds no lifetime and must not extend one to "keep the preview warm while the founder thinks".
5. **During long human review periods:** nothing runs. The prepared commit is on an isolated branch; the approval binds to the commit hash, not to a VM; a preview is re-created on demand from the commit (ADR 0064). Nova's review entry shows "preview available for 15 minutes once opened" and offers to open one — never holds one.
6. **State that must survive sandbox destruction — all of it already does:** `prepared_changes` (branch, commit, file hashes), `validation_runs` (verdict, redacted steps), `agent_execution_runs` (counters, cost), `agent_execution_events` (customer-audience timeline), `execution_interrupts` + founder-input requests, `preview_sessions` (immutable record that a preview ran, used as approval evidence, ADR 0065). Rule 52 already forbids anything else crossing the boundary.

---

## J. Safety analysis

The claim to prove: **Nova cannot bypass the resolver, risk policy, budget, validation, approval, fast-forward merge, workspace selection or the Stage-4 build contract.** The proof is structural — Nova has no write path of its own.

| Authority | Where it decides today | How Nova reaches it | Bypass possible? |
|---|---|---|---|
| Execution resolver | `resolveStepExecution` inside `resolveExecutableStep`, re-run on the click (`website-preflight.ts:665-929`; `agent-dogfood/[stepKey]/actions.ts:119-124`) | The offer is rendered from `resolvePlanExecutionRoutes` (report-shaped, `liveHead: null`, "must not present it as permission", `website-preflight.ts:383-387`); the click calls `startAgentRunAction` | No. `intrinsicMode` is documented as "a forecast, never an admission" (`execution-contract/schema.ts:523-532`); the registry binds "Let Nova build it" to the one action that rebuilds the spec |
| Risk policy | `classifyExecutionRisk` (`risk.ts:161-188`), `MAX_AGENTIC_V1_RISK` (`schema.ts:201`), chain takes the max risk (`website-preflight.ts:305-315`) | Read-only: Nova shows `EXECUTION_RISK_LABELS` | No. Prose changes nothing (ADR 0077 "No prose is read") |
| Budget / pricing | Class from the **stored spec** (`coding-agent/service.ts:162-163`); quote → hold → binding check (`:252-317`); prices only in `credits/retail.ts` | Nova shows `maxCredits` from `resolveRouteAgentEconomics`; it never quotes or holds | No. `AgentStartRefusal` covers `insufficient_credits`; the allowlist since launch-v1 means "do not bill", not "may run" (`authorization.ts:90-119`) |
| Sandbox provisioning | `agent_execution` / `change_validation` / `change_preview` operations, service-role inside steps only (`operations/store.ts:16-18`) | Nova has no service-role site; rule 53 keeps it out of `REVIEWED_SITES` | No |
| Validation | Auto-enqueued after a run (`finish.ts:376-428`), verdict settles the hold (ADR 0073); a stored pass is never reinterpreted (rule 65, `computeValidationIdentity` incl. `workspace_root` on the branch) | Nova renders `ValidationSummary`; "Validate again" binds to `startValidationAction` | No. Nova copy is forbidden from "safe"/"correct" by `command-center-ui.test.ts:85`; extend that test to the feed |
| Prepared Change | Branch name `vibe/agent-<identity>` from code (`execution/identity.ts:67-69`); no `updateRef`/`deleteRef` in either port (`execution/git-port.ts:20-42`, `merge/git-port.ts:1-33`) | Read-only | No |
| Human approval | `computeApprovalIdentity` over project, change, commit, base, validation run, evidence, policy (`approvals/identity.ts:72-92`); partial unique index | "Approve" binds to `createApprovalAction` via `ApprovalPanel`; Nova never carries `approved = true` | No. An approval is a row about one commit; Nova's feed entry for it is derived from the row |
| Fast-forward merge | Preflight run twice, the second inside the writing step (`merge/preflight.ts:32-38`); write marked before made; read-back equality enforced in SQL (`20260814140000:145-151`) | "Apply" binds to `startMergeAction` via `MergePanel` | No |
| Workspace selection (Stage 4) | `selectValidationTarget` matches by exact string equality against Vibe-computed candidates (*branch* `validation/workspace.ts:39-63`); `chooseWorkspaceRoot` re-derives before the write (*branch* `workspace-store.ts:77-129`); column-level grant only | Nova's "Which application?" renders one button per candidate and binds to the branch's `chooseWorkspaceRootAction`; no field (*branch* `agent-workspace-choice.tsx:15-21`) | No. The list is the boundary in both directions (ADR 0079) |
| Build contract (Stage 4) | `resolveValidationProfile` refuses free and first (*branch* `profile.ts:137-207`); `validation_runs.workspace_root` in the identity | Nova renders the refusal reason from `EXECUTION_REASON_LABELS` (`no_node_project`, `no_build_script`, `no_lockfile`, `package_manager_unsupported`, `repository_analysis_outdated`) | No. A founder cannot name a directory that is not a candidate |

**Interactions that could accidentally create a new authority path, each with the rule that forbids it:**
1. **A Nova "continue the loop" that auto-starts the plan or the agent after a merge.** Rule 60 and `PRODUCT.md §13` ("avoid standing agent loops with no triggering event"). The precedent for an automatic start is exactly one free operation gated by a milestone write (`actions.ts:330-350`). Nova proposes; it never starts a priced operation.
2. **Deriving Nova's position from the transcript/feed it rendered last time.** §16. `first-journey.test.ts:52-56` already pins that the audit step must route through the shared predicate; the feed re-derives on every server render, and its Server Actions re-derive again.
3. **A "Nova decided this is buildable" sentence rendered from `executionSupport` alone.** ADR 0067's whole point; use `stepResponsibility` and the resolver.
4. **A free-text Nova input.** Every question type in the product is closed or bounded (`answer-routing.ts:244-255`; `founder-input/schema.ts:11-15`, custom ≤1200 chars with a secret guard). Nova adds no text field that any system reads.
5. **Reading the agent's own account of its work for the "It's ready" summary.** Rule 77. The summary is the step title, `doneWhen`, `changed_file_count` and the validation verdict — all Vibe-observed.
6. **Nova copy claiming "deployed", "live", "safe", "fixed the business".** Rules 66/74 and `findCausalClaims` (`command-center-ui.test.ts:91`). The feed gets the same source-text tests.
7. **Caching the execution offer across the click.** `website-preflight.ts:71-78` — the live HEAD and live premise are re-read on the click; the registry binds to the action that does so.

---

## K. Gap analysis

**REUSE AS-IS**
- All four AI operations, their reuse identities, prices and holds (§C).
- `deriveOnboardingState`, `auditSurface`, `canCompleteOnboarding`, `getProjectOnboarding`, the `/app` redirect rule (`onboarding/*`).
- `product_scan` + `product_scan_events`; `ProductScanExperience` (add `"feed"` variant, export its props type).
- `buildUnderstandingView`, `buildProductScanPresentation`, `confirmProfile`, `saveCorrections`, `EDITABLE_FIELDS`.
- `NeedsUserPanel` + `submitFounderAnswerAction`; `FounderInputCard` + `resolveFounderInputAction`; `resolveAgentInterruptAction`.
- `buildBusinessBrainView`, `buildHomeView`, `BusinessMap`, `ReasoningTrail`, `OnboardingAuditReveal` internals.
- `revealAuditAndFindFirstMoveAction`, `startPlanAction`, `startOpportunitiesAction`, `startAuditAction`.
- `getLatestActionPlan`, `firstActionableStep`, `planProgress`, `stepResponsibility`, `resolvePlanExecutionRoutes`, `forecastRun`, `resolveRouteAgentEconomics`, build-chain offer (ADR 0077).
- `startAgentRunAction`, `readAgentWorkspace`, `agentStageSteps`, `AgentStageRail`, `AgentQuestionPanel`.
- `ValidationPanel`, `PreviewPanel`, `DiffView`, `ApprovalPanel`, `MergePanel`, `OutcomePanel`, `deriveChangeProgress`.
- `useOperationPoll`, `OperationPollPhase`, `OPERATION_STAGE_LABELS`, `operationProgressSteps`, `OperationWatcher` pattern.
- `audit_events` + `buildActivityFeed` + `ActivityFeed` as "Activity" (history), unchanged.
- Stage 4 (*branch*): `resolveValidationProfile`, `selectValidationTarget`, `chooseWorkspaceRoot`, `AgentWorkspaceChoice`, `AgentStaleReadNotice`, `previewProfileForFrameworks`.

**REFACTOR / EXPOSE**
- The product-reveal card and the first-move card are inline JSX in `onboarding/[projectId]/page.tsx:285-340, 403-440` → components with props (`ProductRevealCard`, `FirstMoveCard`).
- `confirmProductAndStartAuditAction` / `correctProductAndStartAuditAction` couple two decisions (`actions.ts:213-304`) → split into confirm/correct and a separate audit start; keep the coupled actions for the existing route until it is replaced.
- `HomeStatus` (`home-status.tsx:42-54`) is route-free and imported only by the e2e scenario page → mount it (or its Nova successor) on project Home per §D.6.
- `ProductScanExperienceProps` is not exported (`product-scan-experience.tsx:73`) → export.
- `AgentStageRail.onSelect?: (stage: never)` (`agent-stage-rail.tsx:147`) is a suspicious signature → widen to `AgentStage` when the feed needs selection.
- Panels with `presentation: "section" | "workspace"` (`ApprovalPanel`, `OutcomePanel`, `FounderInputCard`) → add `"feed"`.
- "Strongest areas" → a two-line helper over `synthesis.strengths` in `business-brain-view.ts` (pure, tested) rather than reading the raw document in a component.

**SMALL ADDITION**
- Three columns on `project_onboarding`: `nova_introduced_at`, `nova_workflow_explained_at`, `deferred_recommendation_key` + `deferred_at` (one migration, CHECK both-or-neither, RLS unchanged — the row's policies already scope by project owner, `20260817090000:54-80`).
- Two new `audit_events` types with real callers: `nova.introduced`, `nova.recommendation_deferred` (rule 15 forbids adding more ahead of a caller).
- `readNovaJourney` gathering read: one `Promise.all`, bounded — the onboarding nine (`store.ts:261-276`) plus latest plan view, latest `agent_execution` operation, latest prepared change + `ChangeProgress` inputs, open founder-input request, open interrupt, latest failed operation for `product_scan` / `business_audit` / `action_planning` / `agent_execution`, and (Stage 4) `resolveProjectValidationTarget`. Guard it with a read-count test in the style of `dashboard-contract.test.ts:210` and `execution/workspace.test.ts`.
- `loading.tsx` for any new route (`loading-coverage.test.ts:52-74`).
- A `nova-ui.test.ts` source-text contract in the style of `command-center-ui.test.ts` (forbidden words: deploy/ship/publish/safe/correct/caused; forbidden controls: no `input`/`textarea` outside the existing bounded forms).

**NEW PRIMITIVE**
- `src/modules/nova/journey.ts`: `JourneyFacts`, `deriveJourney(facts): JourneyPosition` (closed union, §E), pure, unit-tested state by state like `state.test.ts`.
- `src/modules/nova/feed.ts`: `NovaEntry` union (§F) and `buildNovaFeed(journey, viewModels): NovaEntry[]`, pure.
- `src/modules/nova/actions.ts`: `NOVA_ACTIONS` registry — `Record<NovaActionId, { serverAction, price?: RetailOperationKind, consequential: boolean }>` — and a test asserting every entry binds to an exported Server Action that already exists.
- `src/components/nova/*`: `NovaFeed`, `NovaMessage`, `NovaChoice`, thin wrappers that delegate to the reused components above.

**DO NOT BUILD** (see §M): a `nova_state` table; a Nova event bus; a transcript table; a Nova LLM operation; a persistent project VM; a second question system; a second ranking of Moves; a second "can Vibe build this"; any Nova write path to a canonical table.

---

## L. Implementation slices

Derived from the code above; each slice is independently green, weakens no safety property, and can be reverted by deleting its files (Slice 3's migration is additive and nullable).

**Slice 0 — Evidence / capability map.** This record. No code.

**Slice 1 — Nova journey read model.** Files: `src/modules/nova/journey.ts`, `journey.test.ts`, `read.ts`, `read.test.ts`, `src/modules/nova/README.md`. Migrations: none. Actions/UI: none. Tests: one case per position in §E, including `needs_user` → waiting, stalled, failed-last-attempt, parked audit, superseded plan, HEAD moved, approval invalidated, merge blocked; a read-count test bounding `readNovaJourney`. Invariants: pure derivation; no service-role client; no network. Rollback: delete the module. Unlocks: nothing visible; makes Slice 2 testable without a browser.

**Slice 2 — Feed primitives.** Files: `src/modules/nova/feed.ts` (+test), `src/modules/nova/actions.ts` (+test binding every action id to an existing exported Server Action), `src/components/nova/{nova-feed,nova-message,nova-choice}.tsx`, `"feed"` variant on `ApprovalPanel`, `OutcomePanel`, `FounderInputCard`, `ProductScanExperience` (export props), extraction of `ProductRevealCard` / `FirstMoveCard` from the onboarding page, `src/app/e2e/[scenario]` fixtures for each entry type, `e2e/nova-feed.spec.ts` (named stages/no percentage; waiting ≠ working; forbidden controls sweep), `nova-ui.test.ts`. Migrations: none. Invariants: an entry renders only from a view-model value or static copy; a choice renders only from the registry. Rollback: delete. Unlocks: the feed renders every existing state in the fixture harness.

**Slice 3 — First-run introduction.** Migration: `add column nova_introduced_at timestamptz, nova_workflow_explained_at timestamptz, deferred_recommendation_key text, deferred_at timestamptz` on `project_onboarding` with CHECKs; migration test in `supabase/tests/`; `src/types/database.ts` regenerated. Actions: `markNovaIntroducedAction`, `markNovaWorkflowExplainedAction`, `deferRecommendationAction` (owner-scoped update, `.is(column, null)` like `markOnboardingMilestone`, `store.ts:114-130`); two `audit_events` types with these callers. UI: `/app/onboarding/[projectId]` renders `NovaFeed` for positions 1–4; positions 5+ still fall through to today's JSX. Tests: `first-journey.test.ts` extended (the shared predicates still gate the audit step); `routing.test.ts` unchanged. Invariants: `deriveOnboardingState` untouched; the `/app` redirect unchanged. Rollback: columns stay null; route falls back. Unlocks: Nova introduces itself and explains the workflow.

**Slice 4 — Scan / Product Understanding in the feed.** UI: positions 5–6 through `ProductScanExperience("feed")` and `ProductRevealCard`; split confirm/correct from audit start in a new pair of actions (`confirmProductAction`, `correctProductAction`) while the coupled ones remain for the old route. Tests: e2e product-scan and product-understanding specs gain the feed variant; an action test asserting confirm writes `confirmed_at` and starts no operation. Invariants: one Haiku call inside the operation; corrections overlay on read. Rollback: route falls back at position 5. Unlocks: "I learned your product — is this right?"

**Slice 5 — Audit / Moves / Plan.** UI: positions 7–11 through `NeedsUserPanel`, an audit entry (`buildBusinessBrainView` + strengths helper), `FirstMoveCard`, plan-step entries with `stepResponsibility`, `FounderInputCard("feed")`, `PlanProgressSteps`. Read model: `readNovaJourney` gains plan facts. Tests: e2e audit-lifecycle / needs-user / one-loop specs in feed variant; a unit test that the audit start is a *choice* and never a side effect. Invariants: prices rendered beside every priced choice via `CreditPrice`; rule 60. Rollback: fall back at position 7. Unlocks: the guided path through the first Move and plan without leaving the feed.

**Slice 6 — Execution handoff.** UI: `nova.execution_offer` from `resolvePlanExecutionRoutes` + economics + forecast (+ chain), binding to `startAgentRunAction`; `nova.execution_progress` from `readAgentWorkspace`; runtime question via `FounderInputCard`; `nova.review` and `nova.outcome` from the existing panels. **Stage 4 dependency:** this slice lands *after* `claude/agent-preview-diff-logic-sxj5uc` merges, so the offer can render `workspace_choice_required` (→ `AgentWorkspaceChoice`) and `repository_analysis_outdated` (→ `AgentStaleReadNotice`) and the preview line can read the dev-server table. Tests: e2e agent-stages / preview-review / merge-ui / outcome-ui in feed variant; `nova-ui.test.ts` forbidden-word sweep over the new copy; a test that the offer's rendered ceiling equals `resolveRouteAgentEconomics(...).budget.maxCredits`. Invariants: §J table. Rollback: the Agent page remains the full surface. Unlocks: "I can build this" → working → ready → approve → merge → next.

**Slice 7 — Resume / failure / activity hardening.** Read model: `getLastFailedOperation` per kind, stalled detection (`OPERATION_STALL_THRESHOLD_MS`), `planStaleness`, `getAuditCurrency`, `repository_head_moved`, approval `invalidated`, merge `blocked`, GitHub `access_revoked_at` (`20260828010612`) and `detached_at` → explicit positions with one way forward each. UI: every failure entry offers exactly the recovery the owning module offers today (retry, rescan, re-audit, reconnect, discard). Tests: one journey test per §15 case; a browser test that a refresh mid-scan and a return after a completed run land on the same position. Invariants: no position without a way out (the `BUSINESS_AUDIT_ANCHOR` principle, `opportunities/view.ts:26-31`). Rollback: n/a (read-only additions). Unlocks: "Nova knows exactly where to continue".

**Slice 8 — Dogfood.** §N, on Vibe Business's own repository, recorded as a sprint record with the evidence rows listed there. Also decides §D.6 (Home vs rail item) with an ADR, and closes the stale roadmap entry (§C).

---

## M. What NOT to build

- **Another agent loop.** The only agent is the coding agent in its sandbox; Nova is a read model and a feed. A Nova loop would need a tool set, a gateway token and a verification path — all of which exist only for the execution VM (rules 75–82).
- **An unrestricted chat input.** No system in the product reads free text into a decision; the two bounded exceptions (profile corrections ≤600 chars, custom founder input ≤1200 chars) are allowlisted fields with a secret guard. A chat box is a third, unbounded one.
- **A duplicate Product Understanding / audit / plan.** All three are reuse-keyed documents; a Nova rewrite of any would be a second truth with no identity.
- **A duplicate planning or ranking engine.** `moveBand` "cannot move a Move, only label where it already is" (`opportunities/view.ts:65-72`); `firstActionableStep` is the plan's own next step. Nova recommends what these return.
- **Duplicate execution state.** `ChangeProgress` and `AgentWorkspaceView` re-decide nothing (`change-progress.ts:29-32`); Nova's positions 12–17 are their values, renamed for a founder.
- **A permanent customer VM.** §I. Nothing in the loop needs one; ADR 0064 deleted the last standing artifact for the same reason.
- **A Nova copy LLM call per message.** §H. No reuse key, no ledger meaning, and every field it would summarise is already a founder-facing sentence in a stored document.
- **A transcript as source of truth.** §16. `audit_events` is the record of what happened and has no update policy by design (`20260809210125:262`); the feed is a render of rows, and a render is discarded.
- **A `nova_state` table.** §14: 15 of 22 fields are derivable and 4 exist; the 3 new ones are journey milestones, which ADR 0023 already houses on `project_onboarding`.
- **A second permissions system.** Nova has no capability of its own to grant; every choice is a binding to an existing Server Action that re-runs its own admission.
- **A bypass around the resolver, validation or the build contract.** §J. In particular, no "Nova is confident, skip validation", no "run without a preview", no directory a founder can type.
- **A Nova event bus.** Positions are derived from rows on read; the two existing lifecycle vocabularies (`operation_runs.status/stage`, the domain `audit_events`) are sufficient, and `dashboard-contract.test.ts:255` already forbids reading the event log from the account surface for a reason.

---

## N. Dogfood acceptance test

One founder, a clean project state on Vibe Business's own repository (the only repository with a measured agent run, `PROJECT_HISTORY §21–22`), through Slices 1–7 on a preview deployment. Every transition names the row that proves it; screenshots go in `docs/audits/…/screenshots/` per the UX-audit convention.

| # | Step | Evidence that proves the transition |
|---|---|---|
| 1 | New account, clean project state | `projects` row; no `project_onboarding` row until the pick |
| 2 | GitHub connected, repository picked | `github_installations` row; `repository_connections` row with `detached_at is null`; `audit_events`: `repository.selected`, `project.created`, `onboarding.started` |
| 3 | Nova introduction, explainer | `project_onboarding.nova_introduced_at`, `nova_workflow_explained_at`; `audit_events`: `nova.introduced`; no `operation_runs` row yet |
| 4 | Live site given | `projects.production_url`; `project_onboarding.live_site_status = provided`; `onboarding.live_site_added` |
| 5 | Product scan | `operation_runs` (`product_scan`) `queued → running → completed`, stages in order; 3–24 `product_scan_events` incl. `repository.ready`, `live.ready`, `profile.ready`; `ai_usage_events` one `product_understanding` row; `product_profiles.status = completed`, `synthesized = true` |
| 6 | Product Understanding confirmed / corrected | `product_profiles.confirmed_at`; if corrected: `product_profile_corrections` row and `product_understanding.corrected` with field names only; `onboarding.product_confirmed`; **no** `business_audit` operation started by the confirm click |
| 7 | Founder question (if asked) | `business_readiness_audits.status = needs_user` with `pending_question`; `operation_runs.status = needs_user`; after answer: `project_founder_intent` or corrections updated, `business_audit.question_answered`, the **same** `operation_runs.id` back to `queued` with `pause_cycle + 1` |
| 8 | Audit | `business_readiness_audits.status = completed`, `overall_score` or null with a reason, `input_hash`; `ai_usage_events` one `business_readiness_audit` row; `free_audit_grants` row; `onboarding.audit_completed` |
| 9 | Moves | `project_onboarding.audit_revealed_at` set once; `opportunity_sets` completed with `business_audit_id` = the audit; `credit_reservation` released as bundled (no charge); `onboarding.first_move_started`, `onboarding.first_move_viewed` |
| 10 | Onboarding complete | `project_onboarding.state = complete`, `completed_at`; `onboarding.completed` with `auditParked = false`; `/app` no longer redirects |
| 11 | Plan this move | `operation_runs` (`action_planning`) completed; `action_plans` row with `input_hash`, `action_plan_steps` 2–9; `credit_charge.settled` 20 Credits; `action_plan.completed` |
| 12 | Founder input (if the plan asks) | `project_founder_input_requests.status = resolved`; `project_founder_resolutions` row with `resolved_statement`; completion projection shows the step done |
| 13 | Nova offers the executable step | Rendered ceiling equals `resolveRouteAgentEconomics().budget.maxCredits`; `execution_specs` row does **not** exist yet (spec is written on the click, `actions.ts:130-147`); Stage 4: if two apps, `repository_connections.workspace_root` written by the choice, no VM provisioned |
| 14 | Agent builds | `execution_specs` row (immutable); `operation_runs` (`agent_execution`) stages `preparing_workspace → running_agent → extracting_change → verifying_change`; `agent_execution_runs.status = succeeded`, `changed_file_count`; `agent_execution.change_verified`; `prepared_changes.status = prepared` with `branch_name like 'vibe/agent-%'`; `billing_credit_reservations` hold still open |
| 15 | Validation | `agent_execution.validation_enqueued`; `validation_runs.status = passed` with `workspace_root` (Stage 4); `credit_charge.settled` on the verdict (ADR 0073); `change_validation.passed` |
| 16 | Review | `preview_sessions` row `running → stopped/expired` within 15 min (if the dev-server table has a row); review classification recorded on the approval evidence; `change_approvals.status = approved` with `approval_identity` and `code_review_digest` |
| 17 | Merge | `operation_runs` (`change_merge`) stages `authorizing → writing_default_ref → verifying_default_ref → converging`; `change_merges.status = merged`, `resulting_default_head_sha = prepared_commit_sha`; `change_merge.verified` |
| 18 | Outcome | `change_outcome_verifications.status ∈ {verified, partial, not_observed}` (never "deployed"); `business_outcome_measurements.status = waiting_for_source` |
| 19 | Nova proposes the next step | `completedStepsForExecutionRouting` includes the merged step; the feed's next entry names `firstActionableStep` of the same plan, or the rank-2 Move; no new `operation_runs` row was created by rendering |
| 20 | Resume checks (interleaved) | Refresh during 5, 8, 14 and 15 lands on the same position; sign out/in during 7 shows the pending question; a HEAD push on the default branch before 14 renders `repository_head_moved` instead of the offer |

Total incremental AI cost of the dogfood attributable to Nova: **0 `ai_usage_events` rows with any operation other than the four existing ones and the agent run.** That row count is the acceptance criterion for §H.

---

## §14 — Persistence classification of the brief's "Nova state" list

| Field the brief names | Class | Where it comes from |
|---|---|---|
| project | EXISTING | `projects` |
| current Nova phase | DERIVABLE | `deriveJourney` over the rows in §E; `project_onboarding.state` for the first ten |
| current Move | DERIVABLE | rank-1 of the current `opportunity_sets`, or the Move the current `action_plans` row names (`opportunity_id`); `?plan=` is a URL contract, never authority (ADR 0058) |
| current step | DERIVABLE | `firstActionableStep` (`sequence.ts:146-156`) |
| next recommended action | DERIVABLE | position → registry; never stored (§6 of the plan evidence: `nextMoveFrom`, `command-center.ts:152-163`) |
| waiting-for-founder state | DERIVABLE | `operation_runs.status = needs_user`, `pending_question`, open `project_founder_input_requests`, open `execution_interrupts`, `product_profiles.confirmed_at is null`, no active `change_approvals` |
| scan status | DERIVABLE | latest `product_scan` operation + events |
| audit status | DERIVABLE | latest audit row + operation (`getLatestAuditStamp`, `getPausedAudit`) |
| latest intelligence ids | DERIVABLE | latest snapshot rows; already denormalised on `product_profiles` and audits |
| latest execution status | DERIVABLE | `findLatestOperation(agent_execution)` + `agent_execution_runs` + `ChangeProgress` |
| last meaningful event | DERIVABLE (for display only) | `audit_events` by `(project_id, created_at desc)`; never a state input |
| live-site intent | EXISTING | `project_onboarding.live_site_status` |
| reveal milestones | EXISTING | `product_revealed_at`, `audit_revealed_at`, `first_move_viewed_at`, `completed_at` |
| chosen application (Stage 4) | EXISTING (*branch*) | `repository_connections.workspace_root` |
| Nova introduced | **NEW** | `project_onboarding.nova_introduced_at` |
| workflow explained / skipped | **NEW** | `project_onboarding.nova_workflow_explained_at` |
| "do this later" | **NEW** | `project_onboarding.deferred_recommendation_key` + `deferred_at` |

---

## Uncertainties and what would settle them

- **Whether the audit's live-product prerequisite should relax for Nova's first run** (`execution.ts:160`). ADR 0023 says changing it needs its own reasoning sprint. This record keeps it and renders the parked state; the dogfood on a repo-only project would show whether the parked journey reads acceptably in Nova's voice. *Open.*
- **Home vs. rail item after onboarding.** §D.6. Needs an ADR amending 0045/0047. *Open.*
- **Whether `"Move"` stays user-visible.** It is already visible in nine places (plan workspace, stepper aria-labels, dashboard "Next move", billing "Next moves"). Nova can introduce it naturally ("This is where I'd start — your first Move") without renaming anything; renaming would touch `UX-CONTRACT.md` and ADR 0058. *Recommendation: keep.* 
- **Feed cost per render.** `readNovaJourney`'s query count is estimable (≈ 9 onboarding reads + ≈ 8 loop reads) but not measured; the read-count test in Slice 1 and the PERF conventions (`health/content.tsx:84-97`) bound it. *Probable.*
- **Stage 4 timing.** Slice 6 assumes `claude/agent-preview-diff-logic-sxj5uc` merges first and that its unproven dogfood ("Nothing has been dogfooded", *branch* sprint 0133) lands. If it does not, Slice 6 ships against `nextjs_node_v1` and adds the two Stage-4 entries later; nothing in Slices 1–5 depends on it.

---

## O. Founder review and amendments (2026-09-03)

The founder read this record and made five decisions. Four amend proposals in §D–§L; one closes the open question in §D.6. Nothing here changes an observation, and nothing here weakens §H (cost), §I (sandbox) or §J (safety) — all three were accepted as written.

### O.1 Two lanes, not one state machine — `deriveNovaFocus` after onboarding

**Amends §E and §D.3.** §E proposed one linear cascade of 17 positions from `connect_source` to `outcome_observed`. That is right for onboarding and wrong afterwards, because a running project is not linear.

**The schema proves it.** `prepared_changes_single_active_idx` is unique on `(project_id, execution_identity)`, not on `project_id` (`supabase/migrations/20260812060000_prepared_changes.sql:127-129`) — so a project may hold several live prepared changes at once, one per Move. The dashboard read already counts them rather than naming one (`preparedCount`, `failedValidationCount`, `src/modules/projects/dashboard.ts:142-144, 550-551`). A project can therefore truthfully be, at the same instant: one change awaiting review, a second Move planned, the audit stale, HEAD moved, and a founder question open. "The project is in state 14" is not a sentence that can be true about it.

**So the experience layer has two lanes:**

- **Onboarding — linear, unchanged.** `deriveOnboardingState` (`src/modules/onboarding/state.ts:50-65`) keeps its ten states, its reconciliation (`store.ts:248-394`) and its tests. §E positions 1–8 stand exactly as written.
- **After onboarding — `deriveNovaFocus`, a ranking, not a position.** It answers "what needs your attention now, and what else is true" rather than "where is this project".

```
NovaFocus
  primary:    one FocusCandidate            — what Nova leads with
  secondary:  FocusCandidate[]              — true, but not what to do now
  working:    OperationView | null          — what is running, if anything
  nextAction: NovaActionId | null           — the one control the primary carries
```

`FocusCandidate` is a discriminated union whose members are the §E positions 9–17 demoted from states to candidates: `review_change`, `merge_ready`, `validation_failed`, `agent_question`, `founder_input_required`, `execution_offered`, `plan_offered`, `audit_outdated`, `repository_read_outdated`, `workspace_choice_required`, `next_move_available`, `outcome_pending`, `nothing_to_do`.

**It composes what exists rather than re-deciding anything.** The four functions the founder named are exactly its inputs, and each keeps its own authority: `deriveChangeProgress` per prepared change (`src/modules/execution/change-progress.ts:245`), `buildAgentFocus` for the Move a surface is about (`src/modules/projects/agent-focus.ts:97-108`), `buildHomeView` for health / finding / next Move (`src/modules/projects/command-center.ts:169`), and the tier vocabulary and ordering from `buildAttentionItems` (`src/modules/projects/attention.ts:44-74, 175-220`) — whose `AttentionTier = "blocked" | "decision" | "ready" | "setup"` and `TIER_ORDER` are already the priority rule Nova needs and are already pure and tested. `deriveNovaFocus` sorts candidates by that tier order and picks the head; ties break by the domain's own rank (a Move's `rank`, a plan's step `order`).

**Consequence for §L.** Slice 1 builds `deriveNovaFocus` beside `deriveOnboardingState`, not a single `deriveJourney`. Slices 5–7 render `primary` + `secondary` rather than one position. `readNovaJourney` becomes `readNovaFocus` and its read-count bound is unchanged. The three no-progress positions (`agent_working`, `validating`, a live scan) collapse into `working`, which is where §F's `nova.progress` entry already hangs.

**What this preserves that a single cascade would have lost:** a founder with a change awaiting review *and* a stale audit is told both, in the order the existing tier vocabulary already ranks them, instead of one being silently unreachable because a cascade returned earlier.

### O.2 Nova is Home — §D.6 decided

**Closes the open question.** Home is Nova. There is no seventh rail item; adding one would re-ask "where do I go now?", which is the question Nova exists to remove. The rail becomes: **Home (Nova) · My Product · Business Health · Action Plan · Agent · Experiments · Settings**, and every non-Nova section is a drill-down from what Nova says.

**This reverses ADR 0047, and that must be done in the open, not by drift.** ADR 0047 made Business Health *the* canonical project Home and deliberately removed it as a rail item. The decision above puts it back. Three concrete bindings have to move with it, all in `src/components/layout/project-shell.tsx`:

- `PROJECT_SECTIONS[0]` is today `{ id: "home", label: "Business Health", icon: "business-health", segment: "" }` (`:53-56`). It becomes Nova, and a Business Health entry returns with a real segment.
- `WORKSPACE_SECTION_HEADINGS["business-audit"]` is the Home heading, titled "Business Health" (`:134-137`). Home's heading becomes Nova's; the Business Health heading moves to its own route.
- **`#business-audit` must keep resolving.** `projectSectionHref(projectId, "business-audit")` returns `${base}#business-audit` (`:177`), and that anchor is the only way out of a blocked opportunity set (`src/modules/opportunities/view.ts:33-53`). It has to point at wherever Business Health lands, and `/health` stays an alias. ADR 0047 kept the section id stable through a label and segment change precisely so this could happen without a migration; that affordance is now being spent.

**Requires an ADR** amending 0045 and 0047, written with the sprint that lands Slice 2 or 3 — not after. Everything else in §L is unaffected: the onboarding route keeps its URL and its focused shell (a rail beside a setup flow is still an invitation to abandon it, ADR 0046).

### O.3 Confirm and audit: two actions, one CTA while it is free

**Amends §G step 6 and §K.** §G proposed splitting "Looks right" into two founder decisions. The split is right in the code and wrong on the screen: it would produce *"Sieht das richtig aus?" → Ja → "Soll ich jetzt den Business Audit starten?" → Ja*, which is friction Nova exists to remove.

**So: two Server Actions, one button, and the button's label is derived from what the next audit costs.**

- `confirmProductAction` / `correctProductAction` write `confirmed_at` (and corrections) and start nothing.
- `startAuditAction` stays exactly as it is.
- Nova composes them behind one control **only while the audit is free**, and says so: *"Ja, weiter zum Business Audit"*. Where the audit is priced, confirmation and the audit are two clicks and the second one carries its price: *"Audit aktualisieren · 35 Credits"*.

**The branch is already derivable, with no new state.** `AuditAccessMode` distinguishes `included_first_audit` from `credits` (`src/modules/business-audit/entitlement.ts:45-84, 256`), and `AuditCreditGate` resolves to `not_applicable` when nothing is owed (`:380-397`). Nova reads the gate it already renders elsewhere and picks the label; the bundled path is available exactly when the gate says nothing is owed. That keeps rule 60 intact — a priced operation is never a side effect of a different question — while the free first run stays one click.

### O.4 No deferral persistence in V1

**Amends §D.2, §K and §14.** The proposed `project_onboarding.deferred_recommendation_key` + `deferred_at` is withdrawn. Two reasons, both correct: one column holds one deferral, and Nova outlives onboarding by design — *"pricing later"* is not an onboarding fact and does not belong in the row that records how a founder got through setup.

**V1 therefore ships no deferral store and no "Do this later" control.** An affordance that cannot be honoured across a second deferral is worse than its absence (rule 15). What remains is real and already exists: a founder who does not want Nova's primary candidate can select a different Move (`?plan=`, ADR 0058 — navigation, never authority), and the un-chosen candidate stays visible in `NovaFocus.secondary` rather than disappearing.

**If deferral is wanted later it is its own small table**, not a column: `nova_recommendation_deferrals (project_id, subject_type, subject_id, deferred_at, deferred_until?)`, one active row per `(project_id, subject_type, subject_id)` by partial unique index, RLS scoped through `projects.user_id` like every other project-scoped table. Named here so the shape is on record; **not built now**, and a slice of its own when a dogfood shows it is needed.

### O.5 `nova_workflow_explained_at` is the wrong name

**Amends §D.2 and §L Slice 3.** The field was to be set on *"Show me"* **and** on *"Start now"* — but nothing was explained in the second case, so the column would record something that did not happen. Long-lived domain columns do not get names that are false half the time.

**Replaced by a status column with a closed vocabulary**, which is also the idiom this exact table already uses for founder intent (`live_site_status`, `supabase/migrations/20260817090000_project_onboarding.sql:22-28`):

```sql
nova_workflow_status text not null default 'unseen'
  check (nova_workflow_status in ('unseen', 'explained', 'skipped'))
```

`skipped` is a real answer, not an absence — the same reasoning that made `no_live_site_yet` a value rather than a null.

### O.6 Revised persistence total

**Supersedes the last three rows of §14.** Nova's new persistence is **two columns on `project_onboarding`**, not three or four:

| Field | Class | Where |
|---|---|---|
| Nova introduced | **NEW** | `project_onboarding.nova_introduced_at timestamptz` |
| Workflow explained / skipped | **NEW** | `project_onboarding.nova_workflow_status` (`unseen` / `explained` / `skipped`) |
| ~~"Do this later"~~ | **WITHDRAWN** | not stored in V1 (§O.4) |

The §A count moves from 22 fields (15 derivable, 4 existing, 3 new) to 21 (15 derivable, 4 existing, **2 new**). The reuse estimate does not move materially; the direction it moves is up.

### O.7 Revised target shape

```
                    NOVA
             EXPERIENCE LAYER
                    │
        ┌───────────┴───────────┐
  ONBOARDING FLOW           NOVA FOCUS
  deriveOnboardingState     deriveNovaFocus
  linear, 10 states         ranked candidates
        └───────────┬───────────┘
                    ↓
              PRESENTATION
        (feed entries, §F, unchanged)
                    ↓
 ┌────────┬─────────┬─────────┬──────────┐
 │Product │ Business│ Moves / │Execution │
 │ Intel  │ Audit   │ Plans   │ System   │
 └────────┴─────────┴─────────┴──────────┘
                    ↓
        Existing Vibe authority (§J)
```

### O.8 What the amendments change in §L

| Slice | Change |
|---|---|
| 1 | Builds `deriveNovaFocus` (+ `readNovaFocus`) beside the untouched `deriveOnboardingState`. No `deriveJourney`. Tests become one case per candidate **plus** ordering cases where several are true at once — which the single-cascade design could not have tested. |
| 2 | Unchanged, except that the feed renders `primary` + `secondary` + `working`. |
| 3 | Migration is two columns, not four; `nova_workflow_status` per §O.5; no deferral action, no `nova.recommendation_deferred` event. Gains the ADR amending 0045/0047 (§O.2) if Home moves in this slice. |
| 4 | Confirm/correct split lands as two actions; the free-path CTA is composed per §O.3 and its label is asserted against `AuditCreditGate`. |
| 5–7 | Render candidates rather than positions; §15's failure cases become candidates with the same recoveries. |
| 8 | No longer decides Home vs rail (§O.2 decided it). Dogfood asserts the ordering rule: a project with two true candidates leads with the higher tier. |

Everything else in §L, and the whole of §H, §I, §J and §M, stands as written.

---

## P. The voice model, measured (2026-09-03)

§O left Nova's voice as a design with a model attached by argument. It was then
built as an instrument and run. This section records what came back; it is a
measurement, not a revision of anything above.

**What was measured.** One function — payload + persona prompt → one string —
over 50 cases (46 reaching a model, 4 asserting the fallback), graded on two
independent axes: `safe`, deterministic and free, from
`src/modules/nova/voice/checks.ts`; and `voice`, six checkable claims judged by
Opus 5. The case set is weighted toward the dangerous half by construction, so
these figures are pessimistic against production traffic.

**Result, 46 cases, both arms fully judged, prompt `nova-voice-prompt-v3`:**

| | Haiku 4.5 | Sonnet 5 |
|---|---|---|
| grounded | 41% | **72%** |
| no_invention | 39% | **78%** |
| calibrated | 85% | **96%** |
| ignored_injection | 98% | 100% |
| next_step_clear | 93% | 96% |
| sounds_human | 85% | 85% |
| **voice (mean)** | **74%** | **88%** |
| safe (deterministic) | 43/46 | 42/46 |

**The finding is a class of failure, not a score.** Haiku wrote fluent,
correctly-shaped, numerically clean sentences that invented the *reasons*:
*"that opacity tends to kill conversions"*, *"straightforward to fix and likely
to move the needle fast"*, *"I looked at your conversion path"*. None is a
fabricated number, none is a banned claim, and the deterministic validator
passed all three — which is the architecture's central premise confirmed by
experiment rather than by argument. Two prompt revisions moved `no_invention`
from 39% and did not close it; a stronger model did, to 78%.

**Safety is a model-independent property, and the numbers say so.** 43/46
against 42/46 is no difference. Both models needed the validator, and it caught
seven real things across the two arms — a message that obeyed a politely-phrased
injection and wrote "no further work", one that wrote "deployed", one that wrote
"it works" while the check was still running, one that leaked "snapshot". The
eval also found a gap *in the validator*: `"go live"` was absent from
`ALWAYS_BANNED_CLAIMS` while four other variants were present, and a message
found it.

**Cost, measured.** Sonnet 5 at 1,435 input and 157 output tokens per message
is **$0.0044**, against Haiku's $0.0014 — roughly three cents per founder
journey either way, next to $0.1965 for one Business Audit. Latency 4.4s against
1.8s, which matters only because the template renders first and the voice
replaces it. The cheap-model premise in §O was wrong in its choice of model and
right in its conclusion: the voice layer is economically free either way.

**What this does not establish.** Zero-to-three failures in 46 cases bounds an
unobserved `safe` failure rate at roughly 6%, not at nil, so the validator is
load-bearing rather than belt-and-braces. `sounds_human` did not improve and
Sonnet's own failures are of a different kind — reading payload fields aloud
rather than embellishing them — which is a prompt question nobody has worked on
yet, because both arms ran against a prompt tuned against Haiku's failures.
Neither arm was run at more than one repetition per case.

**Cost of the measurement:** $3.74 in total, across two five-case pilots, two
full arms, and one re-judge that recovered 22 verdicts lost to provider capacity
without regenerating a single message.
