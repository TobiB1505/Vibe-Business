# Nova-first restructure — audit, target architecture and migration plan

**Read on:** 2026-09-16 at `6b44950` · **Baseline:** 541 test files / 9,548 tests, `pnpm lint`, `pnpm typecheck` all green before any change · **Decision:** [ADR 0109](../../decisions/0109-nova-first-application-shell.md) · **First slice landed:** [Sprint 0222](../../sprints/0222-nova-leaves-the-route-layer.md)

This is a **record** of one reading at one revision (rule 83). It is never edited to match a later present; the slices in §D are closed by sprint records, not by rewriting this file.

The brief: turn Vibe Business from *a dashboard with an AI assistant* into *an AI business operator with a visual workspace* — without a rewrite, without leaving Next.js, without touching a domain engine, and without weakening one safety boundary. Nova becomes the primary interaction surface; the workspace beside her shows the object she is talking about or working on; the systems underneath stay the brain.

---

## A. Verdict

1. **The domain layer is ready and does not need to change.** `src/modules/` already exposes the query side a chat needs: nearly every module has a pure `build<Thing>View(input) → object` beside an async `get*`/`read*` in its store (§B.4). The commands are the existing Server Actions. Nothing in the brief needs a new engine, a new provider or a new background technology.
2. **Nova is already a conversation — a stateless one.** The ranking (`deriveNovaFocus`), the sentence tables, the closed action catalogue with real bindings, the bubble/thread/presence/typing primitives and the block registry that composes shipped screens into the thread all exist and are tested. What does not exist is a *turn*: no thread row, no user message, no record of what Nova did, no pointer from a message to the thing it is about (§B.2, §B.5).
3. **Three things stand in the way, and none of them is the domain.** (a) The Nova surface, the Agent surface and the Plan surface live inside the route tree, and `src/components/nova/blocks/*` reaches *up* into `src/app/**/agent/*` to compose them — twenty upward import lines from components alone (§B.4). (b) Three files own the project URL shape independently, and one Server Action imports a layout component to build a redirect (§B.4). (c) Forty-odd tests pin source **paths** and assert on source **text**, so a move is a test change as much as a code change — that is the cost, and it is bounded and known (§B.6).
4. **The chat is foreclosed at HEAD, on purpose, and the foreclosure is load-bearing in three places.** The Nova audit's §M refuses "an unrestricted chat input" and "a transcript as source of truth"; `nova-ui.test.ts` asserts *no chat input anywhere*; `first-run.ts` says *there is nothing to type*. Reopening it is a decision, not a feature. ADR 0109 reopens it the way ADR 0086 reopened the per-message model call: not "yes", but "permitted under conditions, all of them together" (§C.5).
5. **The right first cut is structural, not visible.** Move the Nova surface out of the route tree into `src/features/nova/`, make the route a composition, and add the boundary test that keeps every future slice honest. Zero product change, every URL untouched, every test green — and every later slice has somewhere to land.

---

## B. Phase 1 — Audit

### B.1 The shell today

| Layer | File | What it does |
| --- | --- | --- |
| Auth gate + frame | `src/app/app/layout.tsx` | `requireSession()`, renders `AppFrame` with the `@rail` slot. Fetches nothing. |
| The one `<aside>` | `src/components/layout/app-frame.tsx` | 256px sticky rail on desktop; below `lg` a `fixed inset-0 pointer-events-none` layer holding a top bar and a tab bar ([ADR 0108](../../decisions/0108-a-phone-is-not-a-narrow-desktop.md)). `empty:hidden` removes all chrome when the slot renders `null`. |
| Navigation per area | `src/app/app/@rail/projects/[projectId]/layout.tsx`, `@rail/settings/layout.tsx`, `@rail/default.tsx` | A layout per area so a section click never refetches the rail ([ADR 0106](../../decisions/0106-the-rail-is-a-layout-per-area.md)). Onboarding, connect and the internal console render no rail. |
| Project rail contents | `src/app/app/@rail/project-rail.tsx` | Switcher (name, plan, siblings), the seven `PROJECT_SECTIONS`, badges from `getProjectWorkspaceCounts` and `readAgentRailStatus`, the fold into Settings. |
| Section table | `src/components/layout/project-shell.tsx` | `PROJECT_SECTIONS` (Nova · Business Health · My Product · Action Plan · Agent · Experiments · Project Settings), `PROJECT_SUBSECTIONS` (`product/deep-scan`, `settings/activity`), `WORKSPACE_SECTION_HEADINGS`, `projectSectionHref`, `projectSectionLabel`, `preparedChangeHref`, `WorkspaceSection`, `ProjectShell`, `ProjectRail`, the phone tab bar mount. |
| Project frame | `src/app/app/projects/[projectId]/layout.tsx` | One `getProjectFrameContext` read (shared with the rail by `cache()`), breadcrumb, `RecordVisit` cookie. Every route re-checks ownership itself. |
| Entry | `src/app/app/page.tsx` | `/app` is a resolver, not a screen: onboarding → resumable onboarding → last-visited product ([ADR 0104](../../decisions/0104-the-account-level-is-settings.md)). |
| Account | `src/app/app/(account)/settings/*`, `src/components/layout/account-shell.tsx` | General · Products · Repositories · Billing · Profile. |

The information architecture is the one [ADR 0045](../../decisions/0045-command-center-information-architecture.md) chose and [ADR 0085](../../decisions/0085-nova-is-the-project-home.md) amended: seven equal rail destinations, the first of which is Nova. ADR 0085 already said what the brief says — *"every non-Nova section becomes a drill-down from something Nova said"* — and then kept the seven-row menu that makes them equal. The rail is the dashboard the brief is describing.

### B.2 Nova today

**Domain (`src/modules/nova/`, 7,724 lines, pure except two I/O files).**

- `focus.ts` — `deriveNovaFocus(facts)`: 21 candidate kinds ranked into `{ primary, secondary[], working, nextAction }`. Pure. Recency between prepared changes, tier order between kinds. This is the whole decision and it is not a state machine — a project can hold several live changes at once (§O.1 of the [Nova audit](../2026-09-03-nova-architecture-audit/README.md)).
- `read.ts` — the I/O half. Constant queries in the number of changes, no service-role client, no network call; `read.test.ts` bounds what a render costs.
- `actions.ts` — the closed catalogue: 18 `NovaActionId`s with label, price *kind*, consequence flag, confirmation requirement. Data only. The binding of id → real Server Action is `src/app/app/projects/[projectId]/nova-actions.ts`, a total `Record` the compiler checks.
- `feed.ts`, `home-view.ts` — two projections of one ranking: linear (`NovaEntry[]`) and composed (`NovaHomeEntry` with one control). Both pure. All of Nova's sentences are data here, which is what makes the language rules unit tests over values.
- `blocks.ts` — `BLOCK_FOR_MOMENT` (total over the 21 kinds) and `BLOCK_FOR_OPERATION` (total over 15 operation types) decide which composed screen a moment gets. No React.
- `briefing/` — what Nova knows before she speaks: provenance chain → `NovaSituation`, freshness buckets, the aside. Hashed into the voice identity.
- `voice/` — the paid tier. Two live slots (`audit_result`, `move_recommendation`), one string out, validated by `checks.ts`, claimed once per identity in `nova_voice_messages` ([ADR 0086](../../decisions/0086-nova-presentation-is-claimed-stored-and-attempted-once.md)). **The read path cannot reach a provider by construction**; the only permitted caller is an operation tail. A conversational reply cannot be an edit to this path.
- `first-run.ts`, `onboarding.ts` — the introduction and the eleven setup states, each with a sentence.

**Presentation primitives (`src/components/nova/`, 2,991 lines).** Bubble, thread furniture (`NovaLine`, `NovaAside`, `NovaThreadHeader`, `NovaHappened`, `NovaThinking`, `NovaRenderBlock`), `speechBubbles` grouping, presence avatar with four derived states, `NovaArriving` (the beat before a turn), `NovaDissolving`, `NovaRoom` (status row + work column + thread — already the two-column layout), `NovaMove` (the control with the price inside it), the opening choreography, and `blocks/*` which compose shipped screens (`AgentBuildStage`, `MoveCard`, `FounderInputCard`, `ProductScanExperience`…) into thread blocks. **Every chat primitive but the composer exists.**

**The surface (`src/app/app/projects/[projectId]/nova/`, 17 files, 4,170 lines including tests).** `nova-home.tsx` mounts the ranking as a thread; `nova-home-data.ts` is the one composed read (eleven module reads, bounded by `workspace-routes.test.ts`); `nova-focus-thread.tsx` renders bubbles → block → control → asides; `nova-rail.tsx` is the work column with "Earlier" from `audit_events`; `nova-header-live.tsx` polls at 2.5s and fires `router.refresh()` once when a run settles; `nova-agent-live.tsx` tails `agent_execution_events`; `nova-agent-stage.tsx` and `nova-ready-stage.tsx` stream the Agent's own stages behind `Suspense`; `nova-control.tsx` binds the one control; `nova-home-actions.ts` dispatches five subject-bearing actions; `nova-opening-screen.tsx` plays the introduction once and holds the product's only free-text field (the founder's name, bounded).

**What it is:** a *render of rows*, re-derived on every load, with no memory of the last render. Its own docblocks say so — `nova-feed.tsx`: *"Not a chat. There is no input, no history and nothing to scroll back through."*

### B.3 The sections today

| Section | Route + loader | Composes | Artifact-shaped already? |
| --- | --- | --- | --- |
| Business Health | `health/page.tsx` → `health/content.tsx` (515 L, loads ~20 read models) | `AuditOverview` → `business-brain/audit-intelligence.tsx` (910 L) + `business-map.tsx` (443 L), `ProvenancePanel`, `SourceCoverageStrip`, `NovaAuditVoice`, `RunAuditButton`, `NeedsUserPanel` | **Yes** — `AuditOverview` is pure over `BusinessBrainView`. The loader is the page. |
| My Product | `product/page.tsx` (242 L) | `ProductScanExperience` (1,382 L, four variants incl. read-only `showcase`), `DeepScanSpotlight` (pure), `UnderstandingPanel` (pure, takes `actions` as a slot) | **Yes** for spotlight and understanding; scan experience owns a poll. |
| Deep Scan | `product/deep-scan/page.tsx` (`maxDuration = 240`) | `DeepScanPanel` (1,978 L, live browser session over WebSocket) | No — it is a session, not a view. Stays a route. |
| Action Plan | `plan/page.tsx` (392 L, two search params) | `ActionPlanWorkspace` (client, selection + poll) → `MoveStepper`, `MoveCard` (pure-ish), `PlanDetailPanel` (1,006 L, four actions, poll), `PlanCompleteCard` (pure), `HandoffCard`, `AttestationForm` | `MoveCard`, `PlanCompleteCard` yes; the detail panel is a working surface. |
| Agent | `agent/page.tsx` (923 L, two search params, streamed body) | 38 files: four `*-stage` components over a resolved `PreparedChangeWorkspaceItem`, `AgentWorkspacePanel` + `AgentStageRail`, `agent-stage-actions.tsx` (the only importer of the seven loose gate panels), `AgentTaskPanel`, `AgentCore`, `ChangeHistoryTable` (pure) | The stages are artifact-shaped (Nova already composes them). The page is the loader. |
| Experiments | `experiments/page.tsx` (one read) | `ExperimentCard` (pure over `ProjectImpactEntry`) | **Yes.** |
| Project Settings | `settings/page.tsx` → `project-settings-view.tsx` | Pure view given a settings object, extracted "so the browser suite can render it without a session" | **Yes** — the repo's best example of the pattern. |
| Activity | `settings/activity/page.tsx` | `ActivityFeed` (pure over `ActivityEntry[]`) | **Yes.** |

**Dead or fixture-only (never imported by a production route):** `validation-panel.tsx` (a different `ValidationPanel` in `modules/coding-agent/ui/` is the live one), `reasoning-trail.tsx`, `live-intelligence-summary.tsx` — imported by nothing; `agent-panel.tsx`, `intelligence-summary.tsx`, `home-status.tsx`, `understanding-progress.tsx` — reachable only from `src/app/e2e/[scenario]/page.tsx`, with *negative* assertions in `command-center-ui.test.ts` and `one-loop.test.ts` keeping the first two off the pages. Seven files, ~1,500 lines, of dashboard legacy.

### B.4 Boundaries today

**Server Actions.** 36 `"use server"` files; 35 under `src/app`, one in `src/modules/auth/actions.ts`. Seventeen are thin (`requireSession → createClient → one module call → revalidatePath → map error to copy`). The rest carry application logic that belongs in a named layer:

- `src/app/app/onboarding/[projectId]/actions.ts` (681 L, 15 exports) — decides whether an operation is *free or charged* (`requestedBy: "bundled_with_free_audit" | "customer_requested"`, the VB-009 guard) inside a route file.
- `src/app/app/projects/[projectId]/agent/agent-run-actions.ts` (403 L) — preflight → persist spec → start durable run → **builds its redirect from `@/components/layout/project-shell`**. An action importing a layout component is the clearest wrong-direction dependency in the tree.
- `understanding-actions.ts`, `deep-scan-actions.ts`, `preview-actions.ts`, `(account)/settings/billing/actions.ts`, `connect/github/repositories/actions.ts` — 180–220 L each, provider wiring and branching redirects.

**Read models.** Unusually clean: `approvals/view.ts`, `merge/view.ts`, `review/view.ts`, `change-preview/view.ts`, `validation/view.ts`, `outcome-verification/view.ts`, `business-measurement/view.ts`, `execution/view.ts`, `opportunities/view.ts`, `action-plans/view.ts`, `projects/business-brain-view.ts`, `product-understanding/view.ts`, `operations/view.ts`, `audit-log/view.ts`, `coding-agent/change-stage-view.ts` … all `build<Card|View>(input) → plain object`, pure and synchronous, with async `get*` beside them. This *is* the query side of the command/query boundary the brief asks for; it needs a front door, not a rewrite.

**URL shape.** Three independent owners of `/app/projects/${id}[/segment]`: `project-shell.tsx` (tested), `src/modules/projects/attention.ts:83` (`projectHref`), `nova-home-actions.ts:59` (`homePath`). Domain code already publishes URL contracts — `BUSINESS_AUDIT_ANCHOR` (`opportunities/view.ts`), `PLAN_OPPORTUNITY_PARAM` / `planMoveHref` / `agentMoveHref` / `agentChangeHref` (`action-plans/source.ts`, [ADR 0058](../../decisions/0058-move-focus-url-contract.md)), `MOVES_CONTEXT_PARAM` (`opportunities/lineage.ts`), `auth/redirects.ts`. And one `revalidatePath("/app/profile")` points at an address that has been a redirect since ADR 0104.

**Upward imports (the layering the brief wants to end).**

| From | To | Count | Why it exists |
| --- | --- | --- | --- |
| `src/components/nova/blocks/*` | `@/app/app/projects/[projectId]/agent/*`, `plan/move-card`, `business-brain/business-map` | 11 lines, 5 files | Blocks compose shipped screens (Sprint 0162's rule) and the screens live in the route tree. |
| `src/components/marketing/landing-{agent,business-map}.tsx` | the same Agent and business-map components | 3 | The landing page shows the real components. |
| `src/components/product-scan/product-scan-experience.tsx` | `understanding-actions`, `product-scan-status-action` | 2 | A shared component binding two route-side Server Actions. |
| `src/components/layout/{app-frame,account-card,mobile-account,palette-switch}.tsx` | `@/app/palette` | 4 | The palette module lives under `src/app` without being a route. |
| `src/modules/coding-agent/{agent-workspace,change-stage-view}.ts` | `@/app/app/projects/[projectId]/agent/*` | 6 lines, 2 files (type-only) | `AgentTask`, `ValidationCheck`, `PreviewChange`, `MergeSummary` are declared beside the components. |
| `src/modules/{coding-agent/ui,coding-agent,execution,projects}` | `@/components/ui/*`, `system/cost-line` | 8 lines, 4 files (3 type-only) | A screen inside a module, and three view builders naming a primitive's tone type. |
| `src/app/**/nova/*`, `nova-actions.ts` (now `src/features/nova/`) | `../agent/*`, `../*-action.ts`, `@/app/app/onboarding/[projectId]/actions` | 25 lines, 6 files | The Nova surface binds to actions and stages that live in sibling route directories. |
| `src/app/**/agent/agent-run-actions.ts` | `@/components/layout/project-shell` | 1 | Redirect URL built from the layout's table. |
| `src/components/layout/app-frame.tsx` | `@/app/palette` | 1 | Palette switch lives under `src/app`. |

None of these is a bug today. All of them are what makes "put the Agent view in a workspace pane" a route-tree surgery instead of an import.

**Service-role and RLS.** Unchanged by anything here and not to be touched: `service-boundary.test.ts` allowlists every service-role site outside `src/modules/operations/`; every route re-runs `requireProjectAccess`; `read-bounds.test.ts` bounds every growth-table read by site path.

### B.5 Persistence today

56 tables (`src/types/database.ts` is stale — it lacks `founder_profiles` and the handoff tables; regenerate with `pnpm db:types` in the slice that next needs it). What a thread could stand on:

| Table | What it already is | What it is not |
| --- | --- | --- |
| `nova_voice_messages` | Nova-authored text, one row per reuse identity, claimed once, service-role write only, no delete grant | Not ordered, not a conversation, not writable from a request |
| `audit_events` | The append-only record of what happened; already rendered as "Earlier" in Nova's rail | Not addressed to a thread; metadata scrubbed by design |
| `agent_execution_events` | A tool-call record in all but name: monotonic sequence, 24 types, Vibe-composed summaries, redacted, bounded | Scoped to one coding-agent run, not to Nova |
| `product_scan_events` | A bounded, ordered discovery feed (≤24 per run) | Same |
| `project_founder_input_requests` / `_resolutions` | The product's existing answer to *"a founder types and a system reads it"*: `question ≤400`, `raw_answer ≤1200`, secret guard, closed `response_type` with `custom` as one arm, `context_hash`, immutable supersession | Addressed to a plan step or a run, not to Nova |
| `founder_profiles.display_name` | The one persisted utterance to Nova (bounded, ≤60) | — |
| `project_onboarding.nova_introduced_at`, `nova_workflow_status` | Nova's journey milestones as columns, per [ADR 0023](../../decisions/0023-project-scoped-onboarding-orchestration.md) | — |

**Absent:** a thread table, a message table with an author and an order, a record of *which catalogue action Nova ran and what came back* (`runNovaHomeAction`'s result lives in a `useActionState` hook and dies with the render), an artifact pointer from a message to a domain row, a read marker ("Home holds no read marker by decision").

### B.6 Tests today

Two facts shape every slice:

1. **Component tests are source assertions.** `vitest` runs in `node` with no DOM; the `*-ui.test.ts` files `readFileSync` a component and assert on its text (labels, forbidden words, which import it does not have). `src/app/app/projects/[projectId]/test-support.ts` reads from a hard-coded directory. Browser truth comes only from the Playwright suite against the fixture route `src/app/e2e/[scenario]/page.tsx`, which renders the *real* components from complete read-model objects — that harness is already "render one component from one domain object", which is what an artifact host is.
2. **Forty-two test files pin paths under `src/app/app/`.** The ones a move touches: `nova/nova-ui.test.ts` and `components/system/status-vocabulary.test.ts` (`readdirSync` of the Nova directory), `components/nova/nova-room.test.ts` (which screens compose the room, by path), `components/layout/atmosphere.test.ts` (who wears `AtmosphereField`, by path), `components/nova/nova-opening-beats.test.ts`, `projects/one-loop.test.ts` (`NOVA_HOME`), `workspace-routes.test.ts:253` (Nova's read budget by path), `nova-actions.test.ts`, `nova-audit-voice.test.ts`, `nova-move-voice.test.ts`. Whole-tree sweeps (`design-tokens`, `narrow-widths`, `material`, `button`, `read-bounds`, `service-boundary`, `table-writers`) walk `src/` and follow a file wherever it goes.

Boundary tests that a new directory must respect: `service-boundary.test.ts` (`REVIEWED_SITES`), `read-bounds.test.ts` (site paths), `table-writers.test.ts`, `policy-version-literals.test.ts`, `documentation-currency.test.ts` (`RETIRED_CLAIMS` by path; module READMEs must name files that exist), `economy/isolation.test.ts`, `projects/repository-connection-boundary.test.ts`, `projects/delete-authority.test.ts`. **No test enforces the AI-provider import boundary (rules 40, 46, 75)** — documented, not mechanical; out of scope here but worth its own sprint.

### B.7 The ten questions

**1. What stays unchanged?** Every domain module and every engine: repository/live/authenticated intelligence, product understanding, business audit, opportunities, action plans, execution contract/context, coding agent + gateway + sandbox runtime, validation, change preview, review, approvals, merge, outcome verification, business measurement, credits/billing/economy, operations, audit log, retention. All migrations and RLS. `src/modules/nova/` (focus, read, actions, feed, home-view, blocks, briefing, voice) — it is the chat's ranking, catalogue and voice already. `src/components/nova/` primitives. The auth, connect, onboarding and settings routes. The `@rail` slot mechanism and `AppFrame`. All URL contracts (§C.7).

**2. What only moves?** The Nova surface (`projects/[projectId]/nova/*`, `nova-actions.ts`, `nova-audit-voice.tsx`, `nova-move-voice.tsx`) → `src/features/nova/`. The Agent surface (`agent/*` minus `page.tsx`/`loading.tsx`) → `src/features/agent/`. The Plan surface (`plan/*` minus route files) → `src/features/plan/`. The loose gate panels and the health/product/experiments/settings views → the feature that owns each. Server Actions → beside the feature they serve. Nothing changes inside them on the way.

**3. What is dashboard legacy?** The seven-equal-rows rail and its badges as the primary navigation (ADR 0045 §"Command Center", kept by 0085); `PROJECT_SECTIONS` as the product's mental model; `home-status.tsx`, `agent-panel.tsx`, `intelligence-summary.tsx`, `live-intelligence-summary.tsx`, `reasoning-trail.tsx`, `validation-panel.tsx`, `understanding-progress.tsx` (dead or fixture-only); the `design-studies/legacy-*` fixtures; the "Command Center" vocabulary in `command-center-ui.test.ts` and `command-center-scenarios.ts`; `src/modules/projects/dashboard.ts` and `attention.ts`'s account-level ranking (still used by `/app`'s resolver — keep the function, retire the name).

**4. What contradicts Nova-first?** (a) *"Nothing to type"* as a product claim — `first-run.ts:193`, `WORKFLOW_STEPS`, `nova-how-it-works.tsx` (built to end the hunt for the text box), `nova-ui.test.ts` "has no chat input anywhere", `e2e/nova-name.spec.ts` "nothing to write at her in". (b) *"No transcript"* — `nova-feed.tsx:14`, `nova-onboarding-thread.tsx:36`, `components/nova/nova-ui.test.ts` "keeps no transcript". (c) The rail asking "which of seven places" on every visit, which ADR 0085 named as the question Nova exists to remove. (d) Blocks that can only exist *inside* Home's thread, because their screens live in route directories. (e) `UX-CONTRACT.md:96` — *"leads with exactly one control"* — stays true for the ranking's answer but cannot describe a composer.

**5. Which views become workspace artifacts directly?** In order of readiness: `AuditOverview` (+ `BusinessMap`, `AuditIntelligence`) over `BusinessBrainView` → **BusinessHealthArtifact**; `UnderstandingPanel` + `DeepScanSpotlight` over `UnderstandingView`/`DeepScanSpotlight` → **ProductArtifact**; `MoveCard` + `PlanCompleteCard` + `PlanDetailPanel` over `BusinessOpportunity`/`OpportunityActionState`/`ActionPlan` → **OpportunityArtifact / ActionPlanArtifact**; the four Agent stages over `PreparedChangeWorkspaceItem` → **AgentExecutionArtifact / PreparedChangeArtifact**; `PreviewPanel` + `ReviewPanel` over `PreviewCard`/`ReviewCard` → **PreviewArtifact**; `DiffView` over `PreparedDiff` → **DiffArtifact**; `ExperimentCard` over `ProjectImpactEntry` → **ExperimentArtifact**; `FounderInputCard` over `FounderInputRequest` → **FounderInputArtifact**; `ActivityFeed`, `ProvenancePanel`, `ProjectSettingsView`. Not artifacts: `DeepScanPanel` (a live browser session — stays a route), `ProductScanExperience` in its polling variants (its `showcase` variant proves a read-only artifact is one prop away).

**6. Which Nova components carry into a real chat?** All of `src/components/nova/` unchanged: `NovaBubble` is the message; `speechBubbles` is the grouping; `NovaThreadHeader` is the header; `NovaPresence` is the avatar; `NovaArriving` is the typing beat; `NovaHappened` is the system-event row; `NovaRenderBlock` is the artifact card-in-thread; `NovaRoom` is the two-column room; `NovaMove` is the tool-call control. From the module: `NovaEntry`/`NovaHomeEntry` are message shapes minus author and time; `NOVA_ACTION_META` × `nova-actions.ts` is the tool schema and registry; `NovaVoicePayload` is a per-message context bundle; `deriveNovaFocus` is what Nova opens a thread with. From the surface: `nova-agent-live.tsx`'s tail-poll is the tool-output stream.

**7. What persistence does the chat need?** Two tables, both *records of interaction*, never sources of state (§C.5): `nova_threads` (project-scoped, user-scoped, title, created/updated, status) and `nova_messages` (thread, sequence, author `founder | nova | system`, kind `text | action | artifact | event`, bounded text, `action_id`/`subject` for a catalogue action and its outcome, `artifact_kind` + `artifact_ref` pointing at a canonical row, `operation_run_id`, `created_at`). Plus a read marker per thread. Retention class per [ADR 0068](../../decisions/0068-retention-periods.md) to be decided (operational, 90 days, or derived-by-count); RLS full CRUD on own rows like `project_founder_resolutions`; no service-role write path except operation tails appending `system` messages. **No `nova_state`.** The ranking keeps deriving from canonical rows; a thread is what was said, not what is true.

**8. Where is the UI too coupled to server/domain logic?** `health/content.tsx` (515 L loader-as-page, ~20 reads), `agent/page.tsx` (923 L), `plan/page.tsx` (392 L), `onboarding/[projectId]/page.tsx` (975 L state machine), `product/page.tsx` — each is the read composition *and* the screen. `PlanDetailPanel`, `ActionPlanWorkspace`, `PreviewPanel`, `DeepScanPanel` bind actions and polls inside presentation. `blocks/*` compose route components. `agent-run-actions.ts` builds URLs from a layout.

**9. Which Server Actions need a clearer application boundary?** The orchestrating ones: `onboarding/[projectId]/actions.ts` (billing policy in a route), `agent/agent-run-actions.ts`, `understanding-actions.ts`, `deep-scan-actions.ts`, `preview-actions.ts`, `(account)/settings/billing/actions.ts`, `connect/github/repositories/actions.ts`, `projects/[projectId]/actions.ts`. The thin seventeen simply move. The shape (§C.2): a feature exposes `commands.ts` (the `"use server"` file) and `queries.ts` (the composed read, which `nova-home-data.ts` already is); route files import only those; URL building goes through one owner.

**10. Which URLs and contracts must not break?** Every row of §C.7. In one line: every `PROJECT_SECTIONS` and `PROJECT_SUBSECTIONS` address, `/health` as a rendering alias, `#business-audit`, `#planned-work`, `#prepared-change-<id>`, `#product-scan`, `#founder-intent`, `#credit-packs`, `?plan=`, `?change=`, `?from=`, `?opening`, `?installation=`, `?connect_error=`, `?checkout=`, `?next=`, `?error=`; the 307 table in `src/lib/routing/retired-addresses.ts`; `/auth/callback`, `/auth/confirm`, `/app/connect/github{,/callback}`; the API routes and the middleware matcher in `src/proxy.ts`; `revalidatePath` targets; the e2e fixture route.

---

## C. Phase 2 — Target architecture

### C.1 CURRENT → TARGET

```
CURRENT                                          TARGET
────────────────────────────────────────         ────────────────────────────────────────
src/app/app/projects/[projectId]/                src/app/app/projects/[projectId]/
  page.tsx      ← imports ./nova/nova-home         page.tsx      ← composes @/features/nova
  nova/*  (17 files, the surface)                  layout.tsx    ← ProjectShell → Nova + Workspace
  agent/* (38 files, the surface + 3 actions)      health/ product/ plan/ agent/ experiments/
  plan/*  (11 files)                                 page.tsx      ← thin: access + one feature view
  health/content.tsx (loader + screen)           src/features/
  27 loose panels + 22 action files                nova/        home/ thread/ composer/ threads/ voice/
src/components/nova/blocks → @/app/**/agent       workspace/   host/ registry/ artifacts/
src/modules/coding-agent → @/app/**/agent (types) agent/ plan/ health/ product/ experiments/ settings/
src/modules/nova (ranking, catalogue, voice)     src/modules/  (unchanged)
                                                 src/components/ (unchanged; blocks import @/features)
Rail: Nova · Health · Product · Plan · Agent     Rail: Products · New chat · Threads · Settings
      · Experiments · Settings   (7 equal rooms)  Project: Nova (thread + composer) │ Workspace (artifact)
```

```
TODAY                                   TARGET
component                               UI (features/*)
  ↓ any server action                     ↓ features/<x>/commands.ts   (typed, named)
  ↓ any module internal                   ↓ features/<x>/queries.ts    (composed reads)
                                          ↓ modules/*                  (domain, unchanged)
```

### C.2 Layer rules

| Layer | Owns | May import | May not import |
| --- | --- | --- | --- |
| `src/app` | Routing, layouts, `page.tsx`/`loading.tsx`/`error.tsx`, route handlers, metadata, the `@rail` slot. **Composition only.** | `@/features`, `@/components`, `@/modules`, `@/lib` | — |
| `src/features` | Product surfaces and use cases: screens, feature-scoped client components, `commands.ts` (`"use server"`), `queries.ts` (composed reads), feature-local view models, artifact views. | `@/components`, `@/modules`, `@/lib`, other features' *public* files | `@/app` (transitional exceptions recorded in `src/lib/consistency/feature-boundaries.test.ts`, each with the slice that retires it) |
| `src/components` | Presentation primitives with no product knowledge: `ui/`, `system/`, `layout/`, `nova/` (bubble, thread, presence…). | `@/components`, `@/lib`, types from `@/modules` | `@/features`, `@/app` (the ten `blocks/*` imports are transitional, retired by Slice 1) |
| `src/modules` | Domain: stores, services, view builders, operations, providers. | `@/modules`, `@/lib` | `@/features`, `@/app` (two type-only crossings retired by Slice 1) |
| `src/lib` | Cross-cutting utilities, Supabase clients, routing tables, consistency tests. | `@/lib`, `@/modules` types | `@/features`, `@/app` |

Import direction is downward only. The test that holds it is the deliverable of Slice 0; the allowlist inside it is the debt register, and the test fails when an entry stops being true — the same shape as `REVIEWED_SITES`.

Not a rule: a feature per module. Features are cut by **what a founder does** (talk to Nova, look at an artifact, review a change), modules by **what is true** (an audit, a plan, a merge). One feature reads several modules; one module serves several features.

### C.3 Directory map (target, end of Slice 7)

```
src/
  app/
    (marketing)…  auth/  login/  signup/  …                      unchanged
    api/                                                         unchanged
    app/
      layout.tsx  page.tsx  @rail/                               unchanged mechanism; rail contents change in Slice 6
      (account)/settings/**                                      unchanged
      connect/  onboarding/  internal/                           unchanged
      projects/[projectId]/
        layout.tsx          ProjectShell: Nova column + Workspace column (Slice 3)
        page.tsx            Nova + default artifact (the ranking's block)
        loading.tsx error.tsx
        threads/[threadId]/page.tsx                              Slice 4 — a thread is an address
        health/  product/  product/deep-scan/  plan/  agent/  experiments/  settings/  settings/activity/
                            each page.tsx = access gate + one feature view; URLs unchanged
  features/
    nova/
      README.md
      home/          nova-home.tsx, nova-home-data.ts (queries), nova-home-actions.ts (commands), nova-dispatch.ts,
                     nova-focus-thread.tsx, nova-rail.tsx, nova-control.tsx, nova-header-live.tsx,
                     nova-agent-live.tsx, nova-agent-stage.tsx, nova-agent-events-action.ts, nova-ready-stage.tsx,
                     nova-opening-screen.tsx, nova-rise.tsx, footnote.ts                     ← Slice 0 (moved)
      bindings/      nova-actions.ts (catalogue id → command)                              ← Slice 0 (moved)
      voice/         nova-audit-voice.tsx, nova-move-voice.tsx                              ← Slice 0 (moved)
      threads/       thread-list.tsx, thread read model, new-thread command                 ← Slice 4
      messages/      message rows: founder / nova / system / action / artifact              ← Slice 4
      composer/      the bounded input, intent resolution, refusal copy                     ← Slice 5
      tools/         catalogue dispatch with a recorded outcome (extends nova-dispatch)      ← Slice 5
    workspace/
      README.md
      host/          workspace-host.tsx (desktop pane / phone sheet), empty state, artifact chrome   ← Slice 3
      registry/      artifact-kinds.ts: kind → { read, view, href }  (total record, tested)          ← Slice 3
      artifacts/     business-health.tsx, product.tsx, opportunity.tsx, action-plan.tsx,
                     prepared-change.tsx, preview.tsx, diff.tsx, experiment.tsx, founder-input.tsx    ← Slices 3, 6, 7
    agent/           the 38 files from agent/ minus route files; commands.ts (3 actions)      ← Slice 1
    plan/            the plan/ surface; commands.ts                                         ← Slice 1
    health/          content.tsx → queries.ts + business-health view; run-audit, needs-user  ← Slice 6
    product/         product page views, understanding, deep-scan spotlight                  ← Slice 6
    experiments/     experiment card + query                                                 ← Slice 6
    project-settings/ settings view + forms + actions                                        ← Slice 6
    onboarding/      (later, unchanged in this plan)
  components/        unchanged; nova/blocks/* import @/features/agent and @/features/plan   ← Slice 1
  modules/           unchanged
  lib/
    routing/         retired-addresses.ts (unchanged), project-urls.ts (one owner)           ← Slice 2
    consistency/     feature-boundaries.test.ts                                              ← Slice 0
```

### C.4 Keep / Move / Refactor / Replace / New

**Keep** (unchanged, not even a path):
- Every `src/modules/*` engine, store, service, operation, provider, view builder; every migration; every RLS policy; the service-role allowlist; the agent gateway; the sandbox runtime.
- `src/modules/nova/` in full — the chat ranks, speaks and prices with it.
- `src/components/nova/`, `src/components/system/`, `src/components/ui/`, `src/components/layout/app-frame.tsx` and the `@rail` mechanism.
- Auth, connect, onboarding and settings routes; `/app` resolver; retired-address redirects; API routes; middleware.
- All URL contracts (§C.7). The e2e fixture route and its scenario data (their imports move).

**Move** (a better layer, same code):
- `projects/[projectId]/nova/*` → `features/nova/home/`; `nova-actions.ts` → `features/nova/bindings/`; `nova-audit-voice.tsx`, `nova-move-voice.tsx` → `features/nova/voice/`. *(Slice 0)*
- `agent/*` (35 non-route files) → `features/agent/`; `plan/*` (9) → `features/plan/`; the seven gate panels, `change-diff-section`, `change-origin`, `change-rationale`, `prepare-change-panel` → `features/agent/` and `features/plan/`. *(Slice 1)*
- The 22 root `*-action.ts` files → `features/<owner>/commands.ts` (one file per feature, same exports). *(Slice 2)*
- `health/content.tsx`, `business-brain/*`, `audit-*`, `run-audit-button`, `needs-user-panel`, `provenance-panel` → `features/health/`; `product/*`, `understanding-*`, `deep-scan-*`, `scan-handoff`, `live-browser-canvas`, `scan-glyphs` → `features/product/`; `experiment-card` → `features/experiments/`; `settings/*`, `founder-intent-form`, `production-url-form`, `disconnect-button`, `delete-project-button` → `features/project-settings/`; `activity-feed` → `features/project-settings/`. *(Slice 6)*

**Refactor** (responsibility changes):
- `PROJECT_SECTIONS` stops being the navigation and becomes the **artifact-kind → address** table the workspace host and the retired-URL routes read from. `projectSectionHref` keeps its signature. *(Slices 3, 6)*
- The three URL owners collapse into `src/lib/routing/project-urls.ts`; `attention.ts`, `nova-home-actions.ts` and `agent-run-actions.ts` import it. *(Slice 2)*
- `health/content.tsx`, `agent/page.tsx`, `plan/page.tsx`, `product/page.tsx`: the read composition becomes `queries.ts`; the route becomes access gate + view. *(Slices 1, 6)*
- `nova-home.tsx`'s block: on desktop the block opens as the workspace artifact and the thread keeps a `NovaRenderBlock` *card* pointing at it; on a phone the block stays inline (ADR 0108's two shells). *(Slice 3)*
- `deriveNovaFocus` gains no state. A thread *opens* with the ranking's primary as Nova's first message; every later Nova message is either a catalogue action's recorded outcome, a system event, or a bounded reply. *(Slices 4, 5)*
- `blocks/*` import `@/features/agent`, `@/features/plan`; `coding-agent` type crossings move the two types into `src/modules/coding-agent/` where their data is. *(Slice 1)*
- `nova-how-it-works.tsx`, `WORKFLOW_STEPS` ("you don't need to write prompts") and `first-run.ts:193` are rewritten when the composer lands, not before — a claim that stays true until the slice that makes it false. *(Slice 5)*

**Replace** (should disappear):
- The seven-row project rail as primary navigation → app sidebar (Products · New chat · Threads · Settings) and, inside a project, Nova + Workspace. *(Slice 6)*
- `home-status.tsx`, `agent-panel.tsx`, `intelligence-summary.tsx`, `live-intelligence-summary.tsx`, `reasoning-trail.tsx`, `validation-panel.tsx`, `understanding-progress.tsx`, `design-studies/legacy-*` → deleted with their fixture scenarios and the negative assertions that guard them. *(Slice 7)*
- The "Command Center" vocabulary in tests and scenario names. *(Slice 7)*
- The phone tab bar's four sections → Nova · Workspace · Threads · Account. *(Slice 6)*

**New** (genuinely new systems, each behind ADR 0109's conditions):
- `src/features/workspace/` — the artifact host and a **total** registry `ArtifactKind → { read, view, href }`. Not a universal engine: a `Record` over a closed union, checked by the compiler and a test, each entry pointing at an existing read model and an existing view. *(Slice 3)*
- `nova_threads` + `nova_messages` (§C.5) with RLS, retention class and a read model. *(Slice 4)*
- The composer and the **bounded intent resolver**: free text → one of the catalogue's ids (or a query kind, or "cannot") → the existing binding. *(Slice 5)*
- `src/lib/consistency/feature-boundaries.test.ts`. *(Slice 0)*

### C.5 The chat model — and the conditions it lives under

The Nova audit refused a chat for reasons that are still right: no system in the product reads free text into a decision; a transcript must never become the source of a position; there is exactly one agent loop and it lives in a sandbox with no credential. ADR 0109 does not overrule those; it states the conditions under which a thread and a composer satisfy them.

```
Thread        { id, projectId, userId, title, status: open|archived, createdAt, updatedAt, lastReadSequence }
Message       { id, threadId, sequence, author: founder|nova|system, kind, createdAt, ... }
  kind = text      { text ≤ 1200 }                                       founder's words, or Nova's bounded reply
       | action    { actionId: NovaActionId, subject, outcome }           Nova ran a catalogue action; outcome is Vibe-observed
       | artifact  { artifactKind, artifactRef }                          "here is the thing" — a pointer, never a copy
       | event     { operationRunId | auditEventId }                      a run started/settled/failed — from the tail, not the model
```

Conditions (the ADR's, restated for the plan):

1. **A message is a record, never an input to a ranking.** `deriveNovaFocus` and every position stay derived from canonical rows. A thread is what was said. Deleting every thread changes no screen except the thread list.
2. **Free text is bounded and closed.** ≤1200 characters, the founder-input secret guard, never interpolated into a system prompt (rule 42), never handed to a tool-bearing model (rule 41). The composer resolves text to a **closed intent set**: the 18 catalogue ids, a small set of artifact-open intents ("show me the change" → `PreparedChangeArtifact`), and *cannot*. Resolution is deterministic first (labels, subjects, artifact names); if a model is used to classify, it returns one enum value from a fenced user message, is metered under a named operation with a price that says so (rule 94), and its answer is looked up — never executed.
3. **Every action is the existing binding.** A resolved intent calls the same Server Action the button calls, with the same preflight, the same price disclosure, the same confirmation for consequential actions. The thread records the outcome Vibe observed (`{ ok, reused }`, an operation id), never the model's account of it. Nothing in a thread authorizes a branch write; approval and merge stay bound to a commit and a person (rules 67–74).
4. **Nova's replies come from the tables first.** The sentence for a moment is `novaCandidateMessage`; the reply to an unresolvable request is a template; a generated sentence goes through the voice path with its five conditions (ADR 0086) — claimed once per identity, validated by `checks.ts`, template underneath. There is no per-keystroke and no per-message unbounded generation.
5. **No second agent loop.** The composer never gets tools. The coding agent stays the only agent, in its VM, reached through the gateway.
6. **Threads are project-scoped and owner-scoped.** RLS as `project_founder_resolutions`; `system` messages appended from operation tails through `src/modules/operations/` (the one place the service-role client belongs); retention per ADR 0068's classes.

### C.6 Workspace artifacts

Not a universal artifact engine. A closed union and a total record:

| Kind | Reads (exists) | View (exists) | Address (exists) |
| --- | --- | --- | --- |
| `business_health` | `getProjectAuditById` → `buildBusinessBrainView` | `AuditOverview` | `/health`, `#business-audit` |
| `product` | `getLatestProfile` → `buildUnderstandingView`, `buildDeepScanSpotlight` | `UnderstandingPanel`, `DeepScanSpotlight` | `/product` |
| `opportunity` | `getLatestOpportunities` + `buildOpportunityActionState` | `MoveCard` | `/plan?plan=<id>#planned-work` |
| `action_plan` | `getLatestActionPlan` + `readActionPlanReadinessInputs` | `PlanDetailPanel`, `PlanCompleteCard` | `/plan?plan=<id>` |
| `agent_execution` | `readAgentWorkspace`, `listExecutionEvents` | `AgentBuildStage` + `AgentCore`, `NovaAgentLive` | `/agent?plan=<id>` |
| `prepared_change` | `getPreparedChangeWorkspaceItem` | the four `*-stage` components by `agentStageForChange` | `/agent?change=<id>#prepared-change-<id>` |
| `preview` | `buildPreviewCard`, `buildReviewCard` | `PreviewPanel`, `ReviewPanel` | same |
| `diff` | `getPreparedDiffAction` | `DiffView` | same |
| `experiment` | `getProjectImpact` | `ExperimentCard` | `/experiments` |
| `founder_input` | `getFounderInputRequest` | `FounderInputCard` (via `AskBlock`) | `/agent` or `/plan` |

The host does two things: resolve `{ kind, ref }` → one read → one view, and give the thing a frame (title, "open full page" link to its existing address, close). On desktop it is the right column of `NovaRoom`; below `lg` it is the bottom `Sheet` ADR 0108 already fixed. `BLOCK_FOR_MOMENT` keeps deciding which artifact a moment opens — the registry maps a `BlockKind` to an `ArtifactKind` in one more total record.

### C.7 URL contracts — every address and what happens to it

| Address today | Target | Guaranteed by |
| --- | --- | --- |
| `/app` | unchanged resolver | `loading-coverage.test.ts`, ADR 0104 |
| `/app/projects/:id` | Nova + default artifact (unchanged address) | `workspace-routes.test.ts` |
| `/app/projects/:id/health`, `#business-audit` | renders `BusinessHealthArtifact` full-page; anchor kept | `project-sections.test.ts`, `opportunities/view.ts` |
| `/app/projects/:id/product`, `#product-scan` | `ProductArtifact` full-page | same |
| `/app/projects/:id/product/deep-scan` | unchanged route (only `maxDuration` route) | `workspace-routes.test.ts:288` |
| `/app/projects/:id/plan`, `?plan=`, `?from=`, `#planned-work` | `ActionPlanArtifact` full-page; params unchanged | ADR 0058, `one-loop.test.ts` |
| `/app/projects/:id/agent`, `?plan=`, `?change=`, `#prepared-change-<id>` | `PreparedChangeArtifact` full-page; params unchanged | same |
| `/app/projects/:id/experiments` | `ExperimentArtifact` list full-page | — |
| `/app/projects/:id/settings`, `#founder-intent`, `/settings/activity` | unchanged | — |
| `/app/projects/:id/threads/:threadId` | **new** (Slice 4) | — |
| `/app/projects/:id/{score,prepared,understanding}` | 307 as today | `retired-addresses.ts` |
| `/app/{products,repositories,billing,profile}[/…]` | 307 as today | same |
| `/app/settings/**`, `#credit-packs`, `#plans` | unchanged | `rail-switch.test.ts` |
| `/app/onboarding[/…]`, `/app/connect/github{,/callback,/accounts,/repositories}` | unchanged | `first-journey.test.ts` |
| `/auth/callback`, `/auth/confirm`, `?next=`, `?error=` | unchanged | `auth/*.test.ts` |
| `/api/**`, `src/proxy.ts` matcher | unchanged | — |
| `/e2e/[scenario]` | unchanged (imports move) | `fixture-guard.test.ts` |
| `revalidatePath` targets | unchanged strings, one owner | Slice 2 adds a test; `/app/profile` corrected |

A section page whose surface became an artifact still renders that artifact at its own URL, full page, with the same heading id and `scroll-mt`. Deep links, recovery fragments and bookmarks resolve exactly as before. The rail row disappears (Slice 6); the address does not.

---

## D. Phase 3 — Migration slices

Derived from the dependency graph in §B.4, not from the brief's example list. Each slice is independently green, changes no domain module, and can be reverted by deleting its files. The order is forced: artifacts need the Agent and Plan surfaces out of the route tree (1) before they can be hosted (3); the shell change (6) needs artifacts (3) and threads (4) to have something to navigate to; legacy removal (7) is last because it is the only slice that removes an address from the rail.

### Slice 0 — Nova leaves the route layer *(this sprint)*

- **Goal.** Establish `src/features/` with the Nova surface as its first tenant, make `page.tsx` a composition, and land the boundary test that turns the layering into a build failure rather than a convention.
- **Affected.** `src/app/app/projects/[projectId]/page.tsx` (imports), `onboarding/[projectId]/page.tsx` (imports), `health/content.tsx`, `plan/page.tsx` (voice imports), `src/app/e2e/[scenario]/page.tsx` and four `design-studies/*` (imports), ten path-pinned tests (§B.6), `src/modules/nova/README.md` and `src/modules/nova/actions.ts` docblock (they name the old path and say every action lives under `src/app/`).
- **New.** `src/features/nova/{home,bindings,voice}/` (moved files), `src/features/nova/README.md`, `src/features/README.md`, `src/lib/consistency/feature-boundaries.test.ts`, CLAUDE.md rule 86.
- **Migration.** None.
- **Risks.** A path-pinned test silently stops sweeping (e.g. `status-vocabulary.test.ts` reading an empty directory) — every moved sweep asserts it found files. A relative import that pointed at a sibling action now crosses into `src/app` — recorded in the boundary test's transitional list with the retiring slice.
- **Tests.** The existing 9,548 pass unchanged in meaning; the ten path-pinned tests point at the new paths; the boundary test asserts: `modules` → nothing above it beyond the recorded crossings (two type-only into the route tree, four into components); `components` → no `@/features`, no `@/app` beyond the recorded twelve files; `features` → no `@/app` beyond the recorded six files; `lib` → nothing above it, unconditionally; `app` route files under `projects/[projectId]` import Nova only through `@/features/nova`; every register entry still exists (so the register cannot rot).
- **Done when.** `pnpm lint`, `pnpm typecheck`, `pnpm test` green; no file under `src/app/app/projects/[projectId]/` is named `nova*`; the boundary test is in the suite; documentation-currency passes with the README fix.
- **Not in this slice.** Any visible change. Any move of Agent, Plan or the actions. Any new table. The app shell. The composer.

### Slice 1 — The Agent and the Plan leave the route layer

- **Goal.** Close the `components → app` and `modules → app` crossings (the register in `feature-boundaries.test.ts`) by moving the surfaces the blocks compose.
- **Affected.** `agent/*` (35 files) → `src/features/agent/`; `plan/*` (9) → `src/features/plan/`; the seven gate panels + `change-diff-section`, `change-origin`, `change-rationale`, `change-meaning`, `withheld-paths` → `features/agent/`; `prepare-change-panel` → `features/plan/`; `src/components/nova/blocks/*` imports; `AgentTask` and `ValidationCheck` types → `src/modules/coding-agent/`; `agent-run-actions.ts` stops importing `project-shell` (uses `src/lib/routing` after Slice 2, or a local builder until then). Tests: `test-support.ts` `DIR`, `one-loop.test.ts` (~10 paths), `approval-ui`, `merge-ui`, `command-center-ui`, `outcome-ui`, `business-impact-ui`, `change-origin-ui`, `change-rationale-ui`, `agent-run-actions.security.test.ts`, `plan-actions-on-a-stale-plan.test.ts`, `question-promise.test.ts`, `narrow-widths.test.ts`, `design-tokens.test.ts` (two path entries), `workspace-routes.test.ts` (route dir walk excludes moved non-route files — it already only reads `page.tsx`), fixture imports.
- **New.** `src/features/agent/README.md`, `src/features/plan/README.md`; `commands.ts` in each (the three Agent actions and the Plan actions re-exported from their moved files, so import sites have one door).
- **Migration.** None.
- **Risks.** `test-support.ts`'s `actionLabels` refusing an empty list is the guard — moving a panel without moving its test makes the test fail loudly, which is the intended direction. `workspace-routes.test.ts` "no prepared workspace outside `/agent`" reads route files only; the moved components keep the same read budget because their pages did not change.
- **Tests.** All existing, re-pointed. Boundary test's transitional list shrinks to zero for `components` and `modules`.
- **Done when.** `src/components/nova/blocks/*` import only `@/features/*` and `@/components/*`; `src/modules/coding-agent` imports nothing from `@/app`, and `modules/coding-agent/ui/` no longer exists; the Agent and Plan pages are ≤ their loader plus one view mount.
- **Not in this slice.** Changing what the stages render. The workspace host. Moving Health/Product/Experiments/Settings (they have no upward importers and can wait for Slice 6).

### Slice 2 — One URL owner and a command/query door per feature

- **Goal.** The typed boundary the brief asks for: a route imports `queries.ts` and `commands.ts` from a feature and nothing deeper; URLs have one owner.
- **Affected.** `src/modules/projects/attention.ts:83` (`projectHref`), `features/nova/home/nova-home-actions.ts` (`homePath`), `features/agent/agent-run-actions.ts` → all import `src/lib/routing/project-urls.ts`; `project-shell.tsx` re-exports `projectSectionHref` from it (signature unchanged); the 22 root `*-action.ts` files → `features/<owner>/commands.ts`; `revalidatePath("/app/profile")` → `/app/settings/profile`.
- **New.** `src/lib/routing/project-urls.ts` (project base, section hrefs, prepared-change anchor — moved, not rewritten); `src/lib/routing/project-urls.test.ts`; a `revalidate-targets.test.ts` asserting every `revalidatePath` literal resolves to a live route or the `/app` layout.
- **Migration.** None.
- **Risks.** `PLAN_OPPORTUNITY_PARAM`/`planMoveHref` are pinned as *literal source text* in `one-loop.test.ts:491-495` and belong to `action-plans/source.ts` by ADR 0058 — they do **not** move; `project-urls.ts` imports them. `attention.ts` is used by `/app`'s resolver — its output must be byte-identical (assert in its test).
- **Tests.** `project-sections.test.ts` unchanged; new URL tests; the source-text assertions in `one-loop.test.ts` unchanged.
- **Done when.** Exactly one file in `src/` builds `/app/projects/${id}` from parts; no `"use server"` file imports from `@/components`; `pnpm test` green.
- **Not in this slice.** Refactoring the *bodies* of the orchestrating actions (onboarding's free-vs-charged decision stays where it is until a feature owns onboarding). Any UI change.

### Slice 3 — The workspace host and the first artifacts

- **Goal.** Nova + Workspace becomes real on the project index: the ranking's block opens in the workspace pane on desktop and stays inline on a phone; the same artifact views are rendered full-page by their existing section routes.
- **Affected.** `features/nova/home/nova-home.tsx` (the block becomes an artifact card + host mount), `components/nova/nova-room.tsx` (the work column takes the host; the rail moves into it or beside it — decide in the sprint with the ui-audit skill), `projects/[projectId]/layout.tsx` (host slot), `health/page.tsx`, `agent/page.tsx`, `plan/page.tsx`, `experiments/page.tsx` (render the artifact view full-page — same output, one indirection).
- **New.** `src/features/workspace/{host,registry,artifacts}/`, `ARTIFACT_KINDS` (closed union) and `ARTIFACT_FOR_BLOCK: Record<BlockKind, ArtifactKind | null>` (total), `artifact-registry.test.ts` (every kind has a read, a view and an address; every address is a `PROJECT_SECTIONS` address; no artifact starts an operation on render — the same rule `workspace-routes.test.ts` holds for routes), fixture scenarios for the host at 1280 and 390, `e2e/workspace-host.spec.ts`.
- **Migration.** None.
- **Risks.** Read budgets: the host must not add reads to the index — it renders from what `nova-home-data.ts` already loaded, and a full-page artifact route keeps its own budget line in `workspace-routes.test.ts`. Rule 69: the browser-visible state must be tested at both widths before it ships. ADR 0108: below `lg` the pane is the bottom sheet, never a stacked column.
- **Tests.** Registry totality; `workspace-routes.test.ts` read-budget rows unchanged; the four `nova-*.spec.ts` unchanged; new host spec.
- **Done when.** A change awaiting review shows as a card in the thread and as the `PreparedChangeArtifact` in the pane; `/agent?change=<id>` still renders the same stage full page; no new query on the index.
- **Not in this slice.** Threads, the composer, the rail change, Business Health/Product moving to features (they are rendered *through* the registry from where they are).

### Slice 4 — Persistent threads

- **Goal.** A thread is an address and a record: `nova_threads`, `nova_messages`, a read model, and system-authored messages from operation tails. No composer yet — a thread opens with the ranking and fills with what happened.
- **Affected.** `src/modules/operations/*/execution.ts` tails (append a `system` message beside `speakAfterOperation`), `features/nova/home/*` (opening a thread from a moment; the thread route renders the same `NovaFocusThread` plus history), `@rail` (a Threads section becomes possible; landed in Slice 6), retention sweep (a new class or membership in an existing one — a decision inside ADR 0068's frame), `src/types/database.ts` regenerated.
- **New.** Migration `nova_threads` + `nova_messages` (RLS full CRUD on own rows; `system` inserts via service role from `operations/`; CHECKs: text ≤1200, sequence monotonic per thread, `artifact_ref` shape, author ∈ {founder, nova, system}); `src/modules/nova/threads/{schema,store,view}.ts` (module-level, because operations append to it); `features/nova/threads/`, `features/nova/messages/`; `projects/[projectId]/threads/[threadId]/page.tsx` + `loading.tsx`; `db:test` migration tests; `read-bounds.test.ts` entries for the new growth table; `table-writers.test.ts` sees a writer.
- **Migration.** Yes — deployed with `pnpm db:push` after `pnpm db:status` (rules 29–34), never by SQL editor.
- **Risks.** "Transcript as source of truth" — held by a test: no file under `src/modules/nova/` except `threads/` imports the thread store, and `read.ts`/`focus.ts` do not. A thread must not add reads to Home: the index opens the *latest open thread* by one bounded query or none. Retention class is a decision (§E).
- **Tests.** Store tests with the fake client; RLS contract in `db:test`; `feature-boundaries` unchanged; a source test that `deriveNovaFocus` cannot see a message.
- **Done when.** A run started from Home leaves a `system` message in the thread; reloading shows it; deleting the thread changes nothing on Home; the migration is live and `database.ts` matches it.
- **Not in this slice.** Typing. Nova generating anything new. The sidebar.

### Slice 5 — The composer and the bounded intent resolver

- **Goal.** The founder can type at Nova; the text resolves to a closed intent; the intent runs the existing binding; the thread records the founder's words, the resolution, and the observed outcome.
- **Affected.** `nova-ui.test.ts` "has no chat input anywhere" (rewritten in the open to "has exactly one input and it is the composer, bounded"), `first-run.ts:193` and `WORKFLOW_STEPS`, `nova-how-it-works.tsx` (now an illustration of a *turn*), `e2e/nova-name.spec.ts`, `UX-CONTRACT.md:96`, `DESIGN.md` §Nova, `src/modules/nova/README.md`.
- **New.** `features/nova/composer/` (the input; ≤1200; the founder-input secret guard reused; submit is a command), `src/modules/nova/intent/{resolve,catalogue}.ts` (deterministic resolution over labels, subjects and artifact names; `cannot` as a real answer with a sentence), optionally `nova_intent_classification` as a named, priced `ai/operations.ts` entry returning one enum value from a fenced payload (its own tiny ADR if it is priced; free if ADR 0094 applies), `features/nova/tools/` (dispatch with a recorded outcome), `intent.test.ts` (fifty phrasings → ids; injection strings → `cannot`; no id outside the catalogue is reachable).
- **Migration.** None beyond Slice 4 (a `founder` message and an `action` message are rows).
- **Risks.** Rule 41/42 — the classifier has no tools and no system-prompt interpolation; rule 47 — metered; rule 60 — a resolved *paid* intent still stops at the priced control with confirmation, never auto-starts; the merge intent resolves to the approval artifact, never to `mergeApprovedChangeAction` directly (rules 67–74). The `feed.test.ts` language rules apply to every new sentence.
- **Tests.** Intent resolution; the boundary that no resolved intent reaches a command the catalogue does not name; source test that the composer's text never reaches a `system` prompt.
- **Done when.** "Run the audit again" from the composer ends on the same priced control the ranking offers; "show me the change" opens the artifact; "merge it" opens the approval, never merges; an injection attempt produces `cannot` and a row.
- **Not in this slice.** Nova answering open questions in generated prose (a later decision with its own measurement, per ADR 0084's method). Multi-turn model context.

### Slice 6 — The app shell

- **Goal.** The sidebar becomes Products · New chat · Threads · Settings; inside a project the screen is Nova + Workspace; Health, Product, Experiments and Settings render through the registry at their unchanged addresses.
- **Affected.** `@rail/project-rail.tsx` and `@rail/projects/[projectId]/layout.tsx` (the rail's contents — the slot mechanism is unchanged), `mobile-tab-bar.tsx` (four tabs: Nova · Workspace · Threads · Account), `project-shell.tsx` (`PROJECT_SECTIONS` remains the address table, no longer the nav), `health/content.tsx` → `features/health/queries.ts` + view; `product/*`, `experiments/*`, `settings/*` → their features; `rail-switch.test.ts`, `project-sections.test.ts` (rewritten to assert addresses, not rail rows), `e2e/rail-fold.spec.ts`, `mobile-shell.spec.ts`.
- **New.** `features/nova/threads/thread-list.tsx` in the rail; `features/health`, `features/product`, `features/experiments`, `features/project-settings`.
- **Migration.** None.
- **Risks.** ADR 0085's foreclosure (*a seventh rail item for Nova*) is honoured — Nova is not a rail item, she is the project. ADR 0106's fluency (rail as a layout, prefetch across the fold) must survive: `rail-fold.spec.ts` is the guard. The two rail widths must stay one (`rail-switch.test.ts`). Rule 69 at both widths.
- **Done when.** A founder opening a project sees Nova and the workspace, and every old section URL still resolves to its artifact full-page.
- **Not in this slice.** Deleting anything.

### Slice 7 — Legacy retirement

- **Goal.** Remove what nothing reaches.
- **Affected.** The seven dead/fixture-only files, `design-studies/legacy-*`, their scenarios and the negative assertions that kept them off pages; `command-center-*` names; `PROJECT_SECTIONS` rows that no longer render a heading (the table keeps the address); `docs/ROADMAP.md` entries that closed.
- **New.** Nothing. `RETIRED_CLAIMS` entries for the sentences that stop being true.
- **Migration.** None.
- **Done when.** `grep -r "command-center\|home-status\|agent-panel" src` returns only history.
- **Not in this slice.** Removing any address (retired addresses stay 307s).

---

## E. What this plan does not decide (rule 14)

Each of these changes what a slice builds, and none can be settled from the code:

1. **Retention class for threads and messages** — operational (90 days), derived-by-count, or a new class. ADR 0068 frames it; Slice 4 needs an answer.
2. **Whether intent classification may call a model at all, and at what price.** Deterministic resolution ships first; a classifier is an `ai/operations.ts` entry with a rate-card line (ADR 0061's method) or a documented free operation (ADR 0094). Slice 5.
3. **Whether Nova ever answers in generated prose beyond the slot templates.** ADR 0084's measurement method applies; not scoped here.
4. **Thread scope** — per project only (the plan's assumption, because Nova's facts are project-scoped) or also account-level.
5. **The phone's fourth tab** — Threads or Account; ADR 0108's four-tab ceiling forces one out.
