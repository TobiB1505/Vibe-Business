# Nova-first restructure — audit, target architecture and migration plan

**Read on:** 2026-09-16 at `6b44950` · **Baseline:** 541 test files / 9,548 tests, `pnpm lint`, `pnpm typecheck` all green before any change · **Decision:** [ADR 0109](../../decisions/0109-nova-first-application-shell.md) · **First slice landed:** [Sprint 0222](../../sprints/0222-nova-leaves-the-route-layer.md)

This is a **record** of one reading at one revision (rule 83). It is never edited to match a later present; the slices in §D are closed by sprint records, not by rewriting this file.

The brief: turn Vibe Business from *a dashboard with an AI assistant* into *an AI business operator with a visual workspace* — without a rewrite, without leaving Next.js, without touching a domain engine, and without weakening one safety boundary. Nova becomes the primary interaction surface; the workspace beside her shows the object she is talking about or working on; the systems underneath stay the brain.

---

## Correction — 2026-09-16, in review

This record was written and reviewed the same day. The review found two things wrong **at the time of writing**, and they are corrected below rather than quietly rewritten: the original text of each is stated here so a reader can see what was believed.

**1. The original Slice 1 would have broken the boundary it had just drawn.** §C.2 said `src/components` may not import `src/features`, and §D's Slice 1 moved the Agent and Plan surfaces into `src/features` while leaving `src/components/nova/blocks/*` composing them — which forces exactly that import. Eleven files in `src/components` compose a product surface today, and the register's answer would have been a permanent exception rather than a shrinking one. The boundary is right; the slice was wrong. §C.2 now classifies every component, §C.3's map moves product-aware composition out of `src/components`, and the slices are reordered so `src/components` stops knowing the product **before** anything moves into `src/features` beside it (new Slice 1).

**2. The chat as specified was a command palette, not an operator.** The original §C.5 condition 2 read *"the composer resolves text to a closed intent set — the catalogue's ids, a small set of artifact-open intents, and* cannot*"*, and condition 4 read *"Nova's replies come from the tables first"* as a hard boundary. That answers *"run the audit"* and refuses *"why is conversion our biggest problem?"* — which is the question an AI business operator exists for. §C.5 is replaced by a two-lane architecture: a **conversation lane** that may reason and explain generatively over canonical project data, and an **action lane** that stays closed and typed. The conditions are rewritten around that split; none of the safety properties is weakened, and one is strengthened (generation may never happen in a read or a render).

**3. One claim was too absolute.** §C.5's first condition said *"Deleting every thread changes no screen except the thread list."* That is right about canonical business state and wrong about the conversation: a founder who says *"okay, Variante B"* and then *"dann machen wir das"* is relying on the transcript to carry the reference. The rule is now two sentences — deleting a thread must not change canonical business state, and may remove conversational memory.

**The original slice order**, superseded by §D: *0 Nova out of the route layer · 1 Agent and Plan out of the route layer · 2 command/query and URL ownership · 3 workspace host · 4 threads · 5 composer · 6 shell · 7 legacy.* Slice 0 shipped as written and is unaffected.

---

## A. Verdict

1. **The domain layer is ready and does not need to change.** `src/modules/` already exposes the query side a chat needs: nearly every module has a pure `build<Thing>View(input) → object` beside an async `get*`/`read*` in its store (§B.4). The commands are the existing Server Actions. Nothing in the brief needs a new engine, a new provider or a new background technology.
2. **Nova is already a conversation — a stateless one.** The ranking (`deriveNovaFocus`), the sentence tables, the closed action catalogue with real bindings, the bubble/thread/presence/typing primitives and the block registry that composes shipped screens into the thread all exist and are tested. What does not exist is a *turn*: no thread row, no user message, no record of what Nova did, no pointer from a message to the thing it is about (§B.2, §B.5).
3. **Three things stand in the way, and none of them is the domain.** (a) The Nova surface, the Agent surface and the Plan surface live inside the route tree, and `src/components/nova/blocks/*` reaches *up* into `src/app/**/agent/*` to compose them — twenty upward import lines from components alone (§B.4). (b) Three files own the project URL shape independently, and one Server Action imports a layout component to build a redirect (§B.4). (c) Forty-odd tests pin source **paths** and assert on source **text**, so a move is a test change as much as a code change — that is the cost, and it is bounded and known (§B.6).
4. **The chat is foreclosed at HEAD, on purpose, and the foreclosure is load-bearing in three places.** The Nova audit's §M refuses "an unrestricted chat input" and "a transcript as source of truth"; `nova-ui.test.ts` asserts *no chat input anywhere*; `first-run.ts` says *there is nothing to type*. Reopening it is a decision, not a feature. ADR 0109 reopens it the way ADR 0086 reopened the per-message model call: not "yes", but "permitted under conditions, all of them together" (§C.5).
5. **The right first cut is structural, not visible.** Move the Nova surface out of the route tree into `src/features/nova/`, make the route a composition, and add the boundary test that keeps every future slice honest. Zero product change, every URL untouched, every test green — and every later slice has somewhere to land.
6. **Product knowledge is in `src/components`, and that is the first thing to fix.** Eleven files there compose a product surface — the nine Nova blocks and the landing page's two real-component embeds — three more are whole domain views, and the landing page itself is twenty. Twelve of them reach into `src/app` today. Until they leave, "the Agent's view moves to a feature" and "components may not import features" cannot both be true.
7. **Nova needs two lanes, not one.** Everything the closed catalogue answers is *what to do*; a founder also asks *why*, *compare these*, *what does this mean for launch*. Those cannot be pressed into eighteen action ids, and the machinery to answer them safely already exists: `generateStructured` with no tools, `checks.ts` refusing any numeral outside an allowlist Vibe supplied, a template floor under every failure, and `audit-is-a-choice.test.ts`'s invariant that a priced operation is always a press.

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

**2. What only moves?** *[Corrected 2026-09-16 in review: this answer named only the route tree. Eleven files in `src/components` compose a product surface too — the nine Nova blocks and the landing page's two real-component embeds — and three more are whole domain views (`FounderInputCard`, `DiffView`, `ProductScanExperience`). They move first; see §C.2 and Slice 1.]* The Nova surface (`projects/[projectId]/nova/*`, `nova-actions.ts`, `nova-audit-voice.tsx`, `nova-move-voice.tsx`) → `src/features/nova/`. The Agent surface (`agent/*` minus `page.tsx`/`loading.tsx`) → `src/features/agent/`. The Plan surface (`plan/*` minus route files) → `src/features/plan/`. The loose gate panels and the health/product/experiments/settings views → the feature that owns each. Server Actions → beside the feature they serve. Nothing changes inside them on the way.

**3. What is dashboard legacy?** The seven-equal-rows rail and its badges as the primary navigation (ADR 0045 §"Command Center", kept by 0085); `PROJECT_SECTIONS` as the product's mental model; `home-status.tsx`, `agent-panel.tsx`, `intelligence-summary.tsx`, `live-intelligence-summary.tsx`, `reasoning-trail.tsx`, `validation-panel.tsx`, `understanding-progress.tsx` (dead or fixture-only); the `design-studies/legacy-*` fixtures; the "Command Center" vocabulary in `command-center-ui.test.ts` and `command-center-scenarios.ts`; `src/modules/projects/dashboard.ts` and `attention.ts`'s account-level ranking (still used by `/app`'s resolver — keep the function, retire the name).

**4. What contradicts Nova-first?** (a) *"Nothing to type"* as a product claim — `first-run.ts:193`, `WORKFLOW_STEPS`, `nova-how-it-works.tsx` (built to end the hunt for the text box), `nova-ui.test.ts` "has no chat input anywhere", `e2e/nova-name.spec.ts` "nothing to write at her in". (b) *"No transcript"* — `nova-feed.tsx:14`, `nova-onboarding-thread.tsx:36`, `components/nova/nova-ui.test.ts` "keeps no transcript". (c) The rail asking "which of seven places" on every visit, which ADR 0085 named as the question Nova exists to remove. (d) Blocks that can only exist *inside* Home's thread, because their screens live in route directories — and the blocks themselves live in `src/components`, which is the boundary problem the review found (§C.2). (e) `UX-CONTRACT.md:96` — *"leads with exactly one control"* — stays true for the ranking's answer but cannot describe a composer.

**5. Which views become workspace artifacts directly?** In order of readiness: `AuditOverview` (+ `BusinessMap`, `AuditIntelligence`) over `BusinessBrainView` → **BusinessHealthArtifact**; `UnderstandingPanel` + `DeepScanSpotlight` over `UnderstandingView`/`DeepScanSpotlight` → **ProductArtifact**; `MoveCard` + `PlanCompleteCard` + `PlanDetailPanel` over `BusinessOpportunity`/`OpportunityActionState`/`ActionPlan` → **OpportunityArtifact / ActionPlanArtifact**; the four Agent stages over `PreparedChangeWorkspaceItem` → **AgentExecutionArtifact / PreparedChangeArtifact**; `PreviewPanel` + `ReviewPanel` over `PreviewCard`/`ReviewCard` → **PreviewArtifact**; `DiffView` over `PreparedDiff` → **DiffArtifact**; `ExperimentCard` over `ProjectImpactEntry` → **ExperimentArtifact**; `FounderInputCard` over `FounderInputRequest` → **FounderInputArtifact**; `ActivityFeed`, `ProvenancePanel`, `ProjectSettingsView`. Not artifacts: `DeepScanPanel` (a live browser session — stays a route), `ProductScanExperience` in its polling variants (its `showcase` variant proves a read-only artifact is one prop away).

**6. Which Nova components carry into a real chat?** All of `src/components/nova/` unchanged: `NovaBubble` is the message; `speechBubbles` is the grouping; `NovaThreadHeader` is the header; `NovaPresence` is the avatar; `NovaArriving` is the typing beat; `NovaHappened` is the system-event row; `NovaRenderBlock` is the artifact card-in-thread; `NovaRoom` is the two-column room; `NovaMove` is the tool-call control. From the module: `NovaEntry`/`NovaHomeEntry` are message shapes minus author and time; `NOVA_ACTION_META` × `nova-actions.ts` is the tool schema and registry; `NovaVoicePayload` is a per-message context bundle; `deriveNovaFocus` is what Nova opens a thread with. From the surface: `nova-agent-live.tsx`'s tail-poll is the tool-output stream.

**7. What persistence does the chat need?** *[Corrected 2026-09-16 in review: "never sources of state" is right about canonical business state and wrong about conversational memory — see §C.6 and the thread model in §C.9, which this answer's shape otherwise survives.]* Two tables, both *records of interaction*, never sources of canonical business state: `nova_threads` (project-scoped, user-scoped, title, created/updated, status) and `nova_messages` (thread, sequence, author `founder | nova | system`, kind `text | action | artifact | event`, bounded text, `action_id`/`subject` for a catalogue action and its outcome, `artifact_kind` + `artifact_ref` pointing at a canonical row, `operation_run_id`, `created_at`). Plus a read marker per thread. Retention class per [ADR 0068](../../decisions/0068-retention-periods.md) to be decided (operational, 90 days, or derived-by-count); RLS full CRUD on own rows like `project_founder_resolutions`; no service-role write path except operation tails appending `system` messages. **No `nova_state`.** The ranking keeps deriving from canonical rows; a thread is what was said, not what is true.

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
  page.tsx      ← imports @/features/nova          page.tsx      ← composes @/features/nova
  agent/* (38 files, surface + 3 actions)          layout.tsx    ← Nova column + Workspace column
  plan/*  (11 files)                               health/ product/ plan/ agent/ experiments/
  health/content.tsx (loader + screen)               page.tsx      ← access gate + one feature view
  business-brain/* (2 files, 1,353 lines)          threads/[threadId]/page.tsx
  27 loose panels + 22 action files              src/features/
src/components/                                    nova/      home/ thread/ conversation/ actions/ threads/
  nova/blocks/*  → composes @/app/**/agent         workspace/ host/ registry/
  marketing/*    → composes @/app/**/agent         agent/ plan/ health/ product/ experiments/
  product-scan/, founder-input/, change/           project-settings/ founder-input/ marketing/ shell/
src/modules/coding-agent → @/app (2 type-only)   src/modules/  (unchanged, + nova/{threads,conversation,intent})
src/app/palette.ts ← read by 4 components        src/components/ primitives only — no product surface
Rail: Nova · Health · Product · Plan · Agent     Rail: Products · New chat · Threads · Settings
      · Experiments · Settings  (7 equal rooms)   Project: Nova (thread + composer) │ Workspace (artifact)
```

```
TODAY                                   TARGET
component                               UI (features/*)
  ↓ any server action                     ↓ features/<x>/commands.ts   (typed, named)
  ↓ any module internal                   ↓ features/<x>/queries.ts    (composed reads)
                                          ↓ modules/*                  (domain, unchanged)
```

### C.2 Layer rules, and what belongs in `src/components`

| Layer | Owns | May import | May not import |
| --- | --- | --- | --- |
| `src/app` | Routing, layouts, `page.tsx`/`loading.tsx`/`error.tsx`, route handlers, metadata, the `@rail` slot. **Composition only.** | `@/features`, `@/components`, `@/modules`, `@/lib` | — |
| `src/features` | Product surfaces and use cases: screens, feature-scoped client components, `commands.ts` (`"use server"`), `queries.ts` (composed reads), feature-local view models. | `@/components`, `@/modules`, `@/lib`, other features | `@/app` (transitional entries only, each naming the slice that retires it) |
| `src/components` | Presentation primitives with no product knowledge. | `@/components`, `@/lib`, **types and label tables** from `@/modules` | `@/features` — **never, under any entry**; `@/app` |
| `src/modules` | Domain: stores, services, view builders, operations, providers. | `@/modules`, `@/lib` | `@/features` — never; `@/app` (two type-only entries, retired by Slice 2) |
| `src/lib` | Cross-cutting utilities, Supabase clients, routing tables, consistency tests. | `@/lib`, `@/modules` types | everything above, unconditionally |

**`components → features` and `modules → features` can never be registered.** The register exists for crossings that are being retired on a named slice; an import into a feature is not a crossing to retire, it is the layering inverted. `feature-boundaries.test.ts` asserts it unconditionally and refuses any register entry that targets `features/`.

Which means the question is not *may a component import a feature* but **what is a component**. Every file under `src/components` today, classified:

| Class | What it is | Files | Where it belongs |
| --- | --- | --- | --- |
| **Presentation primitive** | Renders a shape. No product vocabulary, no domain import. | `ui/*` (41), `brand/*` (4), `consent/*` (5), `analytics/*` (1), `layout/{app-frame,atmosphere,auth-shell,settings-column}`, `nova/{nova-bubble,nova-thread,nova-speech,nova-presence,nova-arriving,nova-dissolving,nova-room,nova-clock,nova-motion,nova-opening,nova-opening-beats,nova-move}` | **stays** |
| **Domain-shaped primitive** | Renders one module's view type or label table. Names no surface, composes no screen. | `system/*` (13 — `FindingCard`, `CostDisclosure`, `EvidenceDrawer`, `SourceCoverage`, `ActionBlock`, `OperationProgress`, `Wallet`, `status-vocabulary`…), `nova/{nova-feed,nova-message,nova-choice}` | **stays** — `components → modules` is legal and is what keeps Vibe's semantic components from becoming generic ones (DESIGN.md) |
| **Feature composition** | Mounts a product surface inside another surface's frame. | `nova/blocks/*` (9 files, 592 lines) | `features/nova/thread/blocks/` — **Slice 1** |
| **Domain view** | The whole view of one canonical object, with its action injected rather than bound. | `founder-input/founder-input-card.tsx` (419), `change/diff-view.tsx` (207), `product-scan/product-scan-experience.tsx` (1,382) | `features/founder-input/`, `features/agent/`, `features/product/` — **Slice 1** |
| **Product surface** | A screen, or the navigation of one. | `marketing/*` (20), `layout/{project-shell,project-nav,project-switcher,project-breadcrumb-trail,mobile-tab-bar,account-shell,account-nav,account-card,mobile-account,app-shell,marketing-header,marketing-shell,record-visit,palette-switch}` (14) | `features/marketing/` — **Slice 1**; `features/shell/` — **Slice 7**, with the navigation change that rewrites them anyway |

Two consequences worth stating plainly. **`src/components` is not primitive-only until Slice 7**, because the shell's fourteen files are rewritten by the navigation change and moving them twice would be churn — they cross no boundary today, so they wait. And **the mechanical guarantee arrives in Slice 1**: after it, no file under `src/components` imports `@/app`, none composes a product surface, and none ever needs `@/features`.

`src/app/palette.ts` moves to `src/lib/palette.ts` in the same slice. It imports one thing (`@/lib/env/app-url`), four components read it, and it is the only reason four layout primitives reach into `src/app` at all.

### C.3 Directory map (target)

```
src/
  app/
    (marketing)…  auth/  login/  signup/  …                      unchanged
    api/                                                         unchanged
    app/
      layout.tsx  page.tsx  @rail/                               unchanged mechanism; rail contents change in Slice 7
      (account)/settings/**  connect/  onboarding/  internal/    unchanged
      projects/[projectId]/
        layout.tsx          ProjectShell: Nova column + Workspace column   (Slice 4)
        page.tsx            Nova + the artifact the ranking opens
        threads/[threadId]/page.tsx                              (Slice 5)
        health/ product/ product/deep-scan/ plan/ agent/ experiments/ settings/ settings/activity/
                            each page.tsx = access gate + one feature view; URLs unchanged
  features/
    nova/
      home/          the ranking mounted as a thread                        (exists)
      bindings/      catalogue id → Server Action or href                   (exists)
      voice/         Nova's sentence on two pages                           (exists)
      thread/
        blocks/      BlockKind → the owning feature's view, framed          (Slice 1)
        thread-view  the turn list, once threads exist                      (Slice 5)
      threads/       the thread list and its commands                       (Slice 5)
      conversation/  composer, turn rendering, the generation command       (Slice 6)
      actions/       proposal → existing control → existing command         (Slice 6)
    workspace/
      host/          the pane on desktop, the sheet below `lg`              (Slice 4)
      registry/      ArtifactKind → { read, view, href }  (total, tested)   (Slice 4)
    agent/           the 35 files from agent/, the gate panels, diff-view; commands.ts   (Slices 1, 2)
    plan/            the plan surface; commands.ts                          (Slices 1, 2)
    health/          business-brain + content.tsx split into queries + view (Slice 2)
    product/         product views, understanding, deep-scan, scan experience (Slices 1, 2)
    founder-input/   the question and its answer, shared by agent and plan  (Slice 1)
    marketing/       the landing page and the legal pages                   (Slice 1)
    experiments/  project-settings/  onboarding/                            (Slice 2)
    shell/           the project and account navigation                     (Slice 7)
  components/        primitives only (see C.2)
  modules/
    nova/
      focus  read  actions  feed  home-view  blocks  briefing  voice        (unchanged)
      threads/       thread and message store, schema, read model           (Slice 5)
      conversation/  payload, prompt, checks, service — `voice/`'s shape    (Slice 6)
      intent/        text → one catalogue id, or nothing                    (Slice 6)
    … every other module unchanged
  lib/
    palette.ts       moved from src/app                                     (Slice 1)
    routing/         retired-addresses.ts (unchanged), project-urls.ts      (Slice 3)
    consistency/     feature-boundaries.test.ts                             (exists)
```

A feature is cut by **what a founder does**, a module by **what is true**. One feature reads several modules; one module serves several features. `features → features` is legal — the thread's blocks mount the Agent's and the Plan's views, which is the whole point of the correction.

### C.4 Keep / Move / Refactor / Replace / New

**Keep** — every `src/modules/*` engine, store, service, operation, provider and view builder; every migration and RLS policy; the service-role allowlist; the agent gateway and sandbox runtime; `src/modules/nova/` in full; the primitives and domain-shaped primitives of §C.2; auth, connect, onboarding and settings routes; the `/app` resolver; the retired-address redirects; the API routes and middleware; every URL contract in §C.7.

**Move** — in slice order: the nine blocks, the three domain views, the twenty marketing files and `palette.ts` out of `src/components` and `src/app` (Slice 1); the Agent, Plan, Business Health, product, experiments and project-settings surfaces out of the route tree (Slice 2); the twenty-two root action files into each feature's `commands.ts` (Slice 3); the shell's fourteen files into `features/shell/` (Slice 7).

**Refactor** — `PROJECT_SECTIONS` stops being the navigation and stays the address table the workspace host and the retired routes read (Slices 4, 7). The three URL owners collapse into `src/lib/routing/project-urls.ts` (Slice 3). `health/content.tsx`, `agent/page.tsx`, `plan/page.tsx` and `product/page.tsx` split into `queries.ts` plus a view (Slice 2). The Agent stages, the gate panels and `FounderInputCard` gain nothing — they already carry the `presentation` prop the host needs (§C.6). `blocks/*` import `@/features/*` instead of `@/app/**` (Slices 1, 2). `nova-how-it-works.tsx`, `WORKFLOW_STEPS` and `first-run.ts:193` — every sentence telling a founder there is nothing to type — are rewritten by the slice that gives them something to type (Slice 6), not before.

**Replace** — the seven-row project rail as primary navigation (Slice 7); the seven dead or fixture-only files and the `design-studies/legacy-*` fixtures (Slice 8); the "Command Center" vocabulary in tests and scenario names (Slice 8); the phone's four section tabs (Slice 7).

**New** — `features/workspace/{host,registry}` (Slice 4); `nova_threads` and `nova_messages` with their store and read model (Slice 5); `modules/nova/conversation/` and `modules/nova/intent/`, the composer and the proposal control (Slice 6); `src/lib/consistency/feature-boundaries.test.ts` (shipped, Slice 0).

### C.5 Nova: two lanes

The closed catalogue answers *what to do*. A founder also asks *why is conversion the blocker*, *how do you read our pricing*, *what changed since last week*, *why Move 1 before Move 2*, *explain the audit more simply*, *what are our two options*. None of those is an action, none can be pressed into eighteen ids, and refusing them is refusing the product.

So Nova has two capabilities with one boundary between them:

```
                         NOVA
                          │
              ┌───────────┴───────────┐
              │                       │
       CONVERSATION                ACTION
       reasons, explains           does
              │                       │
   generateStructured, no tools   typed intent → catalogue id
   deterministic context pack     → existing binding
   validated before display       → existing authorization
   template floor underneath      → existing confirmation and price
              │                   → existing execution path
              │                       │
        text + an artifact        a control the founder presses
              └───────────┬───────────┘
                          │
                    DOMAIN ENGINE
                 (canonical, unchanged)
```

**The conversation lane may reason freely and may not act.** It reads canonical project context — identity, product understanding, repository and live intelligence, Deep Scan, the audit, opportunities, plans, execution and change state, experiments, measurements, and the thread's own recent turns — and returns prose plus, optionally, a pointer at an artifact and a proposal. It writes nothing but its own message.

**The action lane is unchanged from what ships today.** A proposal is a catalogue id and a subject; it renders the control that id already has, with the label, the price kind, the consequence flag and the confirmation `NOVA_ACTION_META` already carries. The founder presses it. `audit-is-a-choice.test.ts` already holds both halves of this — *a priced operation is always a press*, and *no Nova module starts an operation itself* — and the conversation is not an exemption from either.

**One sentence joins them:** generated text is never the last thing before a consequential effect; a press always is. A read-only navigation (open the diff, show the plan) has no consequence and may follow a resolved intent directly.

**How the truth rules stay mechanical.** The model's output is structured, not free: one message string, an optional `{ kind, ref }` from a closed artifact union, an optional catalogue id from the closed catalogue. Vibe then validates before a founder sees any of it — `checkNovaMessage` already refuses a numeral that is not in the `allowedNumericFacts` list Vibe supplied, refuses `ALWAYS_BANNED_CLAIMS`, and the service already has five ways to fall back to a deterministic template. An artifact reference that does not resolve to a row the founder owns is dropped; an action id that is not in `NOVA_ACTION_META` is dropped. A discarded field degrades the reply; it never becomes an unverifiable claim on screen (rule 45's shape, applied to a sentence instead of an evidence id).

**What the model never gets:** a tool, a URL, a database handle, the service-role client, a credential, a branch, or the choice of what to read. Context assembly is deterministic Vibe code against a byte budget; the model receives a pack and returns a shape. Removing capability, not prompt wording, is what bounds injection (rule 41), and customer-derived content in the pack stays fenced and untrusted-labelled (rule 42), as does the founder's own message.

**Replies from the tables are a preference, not a boundary.** Where a moment already has a written sentence — the twenty-one in `feed.ts`, the eleven setup states, the two voice slots — that sentence is used, because it is free, tested and consistent. The generative path exists for the questions those tables cannot answer, and a question is not pushed into a template to avoid a model call.

**What a generated reply may never do:** claim a cause the evidence does not carry, state a figure Vibe did not measure, call anything safe, correct, deployed or live, say that something was done when nothing ran, or present a plan step as executed. Those are truth rules, not style, and they are not revisable ([ADR 0098](../../decisions/0098-design-rules-are-revisable-truth-rules-are-not.md)); `feed.test.ts` and `checks.ts` already sweep the vocabulary and both extend to the new path.

### C.6 Canonical state and conversational state

**Canonical business state is never conversational, and never derived from chat text**: audit scores and findings, opportunities, action plans, execution state, prepared changes, approvals, validation, merge state, experiments, business measurements, credits and pricing, repository and product intelligence. Every one of those has a store, an identity and a write path today, and the conversation reads them and writes none of them.

**The transcript is conversational memory.** It is what lets *"the second one"*, *"that option"*, *"like you just did"* and *"then let's do that"* resolve to something, and a Nova that cannot resolve them is a search box with a personality. So the thread's recent turns are part of the context pack, bounded like everything else in it.

The rule, in two sentences:

> Deleting a thread must not change canonical business state.
> Deleting a thread may remove conversational memory, and therefore what Nova can infer from earlier dialogue.

And the seam between them: **a preference expressed in conversation becomes canonical only by passing through a canonical write that already exists** — a founder input resolution, a product correction, a founder intent, an attestation, an approval. *"Variante B gefällt mir besser"* is memory. *"Dann machen wir das"* is a proposal, a control and a press, and what it writes is written by the command that already owns that write.

### C.7 Workspace artifacts — one view, two frames

Not a universal engine, and not a second copy of every screen. The repository already models this: eight components carry a `presentation` prop today (`"section" | "workspace"` on the five gate panels, `"panel" | "block"` on `NeedsUserPanel`, `"card" | "workspace" | "block"` on `FounderInputCard`, `"page" | "block"` on the Agent's validate stage). The artifact view **is** the feature's view, mounted with a frame.

So `features/workspace/` holds two things and no views: the **host** (the pane beside the thread on desktop, the bottom sheet below `lg`) and a **registry** — one total record over a closed union:

| Kind | Reads (exists) | View (exists, after Slice 2 in its feature) | Address (exists) |
| --- | --- | --- | --- |
| `business_health` | `getProjectAuditById` → `buildBusinessBrainView` | `AuditOverview` | `/health`, `#business-audit` |
| `product` | `getLatestProfile` → `buildUnderstandingView`, `buildDeepScanSpotlight` | `UnderstandingPanel`, `DeepScanSpotlight` | `/product` |
| `opportunity` | `getLatestOpportunities` + `buildOpportunityActionState` | `MoveCard` | `/plan?plan=<id>#planned-work` |
| `action_plan` | `getLatestActionPlan` + `readActionPlanReadinessInputs` | `PlanDetailPanel`, `PlanCompleteCard` | `/plan?plan=<id>` |
| `agent_execution` | `readAgentWorkspace`, `listExecutionEvents` | `AgentBuildStage` + `AgentCore`, `NovaAgentLive` | `/agent?plan=<id>` |
| `prepared_change` | `getPreparedChangeWorkspaceItem` | the four `*-stage` components, by `agentStageForChange` | `/agent?change=<id>#prepared-change-<id>` |
| `preview` | `buildPreviewCard`, `buildReviewCard` | `PreviewPanel`, `ReviewPanel` | same |
| `diff` | `getPreparedDiffAction` | `DiffView` | same |
| `experiment` | `getProjectImpact` | `ExperimentCard` | `/experiments` |
| `founder_input` | `getFounderInputRequest` | `FounderInputCard` | `/agent` or `/plan` |

`BLOCK_FOR_MOMENT` keeps deciding what a moment shows; one more total record maps a `BlockKind` to an `ArtifactKind`. The host resolves `{ kind, ref }` to one read and one view and gives it a frame with the artifact's own address on it, so "open it properly" is always one click and every deep link still works.

**Nova explains, the workspace shows.** A reply that would be a wall of text is a short reply and an artifact; the message field carries a paragraph bound like the voice slots already do, and what it would have listed is the thing beside it. The workspace is not a second navigation — it shows the object under discussion, and its full-page address is how a founder leaves the conversation for it.

### C.8 What must not leak into the conversation layer

Every one of these is an existing rule, restated where the new lane could erode it:

- **No service-role client** anywhere in `features/nova/conversation/` or `modules/nova/conversation/`. The conversation reads under the founder's own session and RLS; `service-boundary.test.ts` is the guard and gains no entry (rule 53).
- **No credential in model context** — not the Anthropic key, not GitHub, Supabase, Stripe or a sandbox token (rules 8, 62, 79).
- **No tool, no web access, no URL fetch, no code execution, no database handle** for the conversation model (rule 41). The one agent that has tools stays in its VM behind the gateway (rules 75–82).
- **No branch write, no merge, no approval** through generated text. An approval binds to an immutable artifact identity and a person; a sentence can never be that (rules 67–74).
- **No hidden paid operation and no implicit spend.** Every model call is counted before and recorded after (rule 47), and a priced *domain* operation is still a press with its price shown first (rule 60).
- **No user or customer content in a system prompt.** The founder's message and every evidence excerpt are fenced, untrusted-labelled user content (rules 25, 36, 42).
- **No model reasoning requested, stored or displayed** (rule 43). `NovaThinking` shows a status line, never a thought.
- **No raw source or page content persisted** in a thread — a message may name a file path as evidence, never carry a file (rules 26, 37).
- **No generation on a read or a render.** A thread renders from rows; only a founder-initiated command generates. This is stronger than [ADR 0086](../../decisions/0086-nova-presentation-is-claimed-stored-and-attempted-once.md)'s condition 5 and is what keeps the cost of looking at a screen knowable.

### C.9 The thread model

One table for threads, one for messages, a `kind` discriminator and per-kind CHECK constraints — the idiom `nova_voice_messages` already uses, where three CHECKs enforce that a resolution is whole, that a voice row carries its message and that a fallback row carries none. No table per message kind, and no JSON blob standing in for a schema.

```
nova_threads
  id · project_id → projects · user_id · title (≤120, Vibe-composed or the founder's first line)
  status: open | archived · created_at · updated_at · last_message_at · last_read_sequence

nova_messages
  id · thread_id → nova_threads · project_id · user_id · sequence (monotonic per thread, unique)
  author: founder | nova | system
  kind:   text | action_proposal | action_result | artifact | event
  body            text ≤1200, and only for `text`
  action_id       a NovaActionId, and only for proposal/result
  subject_kind, subject_id      the catalogue's NovaActionSubject, for proposal/result
  artifact_kind, artifact_ref   a closed union + a canonical row id, for artifact
  operation_run_id → operation_runs, for result/event
  outcome         the observed result of a pressed proposal, never the model's account of it
  context_version, context_hash   what the turn was answered from (the shape, never the content)
  created_at
```

`confirmation` is not a kind: whether a proposal needs one is `NOVA_ACTION_META.requiresConfirmation`, and what happened to it is the `action_result`. A turn is therefore a real turn — founder text, Nova text, an artifact beside it, a proposal, and the result when it is pressed — rather than a list of system events with a chat theme.

RLS as `project_founder_resolutions`: the owner may read and insert their own rows; `system` messages are appended from operation tails through `src/modules/operations/`, which is the one module that may hold the service-role client. Retention under [ADR 0068](../../decisions/0068-retention-periods.md)'s frame — which class is §E.1.

### C.10 URL contracts — every address and what happens to it

| Address today | Target | Guaranteed by |
| --- | --- | --- |
| `/app` | unchanged resolver | `loading-coverage.test.ts`, ADR 0104 |
| `/app/projects/:id` | Nova + the artifact the ranking opens (unchanged address) | `workspace-routes.test.ts` |
| `/app/projects/:id/health`, `#business-audit` | renders `BusinessHealthArtifact` full-page; anchor kept | `project-sections.test.ts`, `opportunities/view.ts` |
| `/app/projects/:id/product`, `#product-scan` | `ProductArtifact` full-page | same |
| `/app/projects/:id/product/deep-scan` | unchanged route (only `maxDuration` route) | `workspace-routes.test.ts:288` |
| `/app/projects/:id/plan`, `?plan=`, `?from=`, `#planned-work` | `ActionPlanArtifact` full-page; params unchanged | ADR 0058, `one-loop.test.ts` |
| `/app/projects/:id/agent`, `?plan=`, `?change=`, `#prepared-change-<id>` | `PreparedChangeArtifact` full-page; params unchanged | same |
| `/app/projects/:id/experiments` | `ExperimentArtifact` list full-page | — |
| `/app/projects/:id/settings`, `#founder-intent`, `/settings/activity` | unchanged | — |
| `/app/projects/:id/threads/:threadId` | **new** (Slice 5) | — |
| `/app/projects/:id/{score,prepared,understanding}` | 307 as today | `retired-addresses.ts` |
| `/app/{products,repositories,billing,profile}[/…]` | 307 as today | same |
| `/app/settings/**`, `#credit-packs`, `#plans` | unchanged | `rail-switch.test.ts` |
| `/app/onboarding[/…]`, `/app/connect/github{,/callback,/accounts,/repositories}` | unchanged | `first-journey.test.ts` |
| `/`, `/privacy`, `/terms` | unchanged addresses; their components move to `features/marketing/` | `landing-contract.test.ts`, `sitemap.test.ts` |
| `/auth/callback`, `/auth/confirm`, `?next=`, `?error=` | unchanged | `auth/*.test.ts` |
| `/api/**`, `src/proxy.ts` matcher | unchanged | — |
| `/e2e/[scenario]` | unchanged (imports move) | `fixture-guard.test.ts` |
| `revalidatePath` targets | unchanged strings, one owner | Slice 3 adds a test; `/app/profile` corrected |

A section page whose surface became an artifact still renders that artifact at its own URL, full page, with the same heading id and `scroll-mt`. Deep links, recovery fragments and bookmarks resolve exactly as before. The rail row disappears (Slice 7); the address does not.

---

## D. Phase 3 — Migration slices

Reordered by the review (see the correction above). The order is forced by the dependency graph: `src/components` must stop composing product surfaces **before** those surfaces move into `src/features` beside it, or the move itself inverts the layering. Everything after that is unchanged in substance and renumbered by one, except that the conversation slice grew a lane.

Each slice is independently green, changes no domain engine, and reverts by deleting its files.

### Slice 0 — Nova leaves the route layer ✅ *shipped ([Sprint 0222](../../sprints/0222-nova-leaves-the-route-layer.md))*

`src/features/nova/{home,bindings,voice}`, the project index as a composition, `feature-boundaries.test.ts` with its register. 542 files / 9,559 tests green; no address and no rendered output changed.

### Slice 1 — `src/components` stops knowing the product ✅ *shipped ([Sprint 0223](../../sprints/0223-a-component-that-knew-the-product.md))*

- **Goal.** Make the boundary structurally true rather than registered: after this slice no file under `src/components` imports `@/app`, none composes a product surface, and none can ever need `@/features`.
- **Affected.** Moves, with no change inside the files beyond imports:
  - `components/nova/blocks/*` (9 files, 592 L) → `features/nova/thread/blocks/`
  - `components/product-scan/product-scan-experience.tsx` (1,382 L) → `features/product/`
  - `components/founder-input/founder-input-card.tsx` (419 L) → `features/founder-input/`
  - `components/change/diff-view.tsx` (207 L) → `features/agent/`
  - `components/marketing/*` (20 files) → `features/marketing/`
  - `src/app/palette.ts` → `src/lib/palette.ts`
  Importers to rewrite: `features/nova/home/{nova-home,nova-agent-live}.tsx`, `app/app/projects/[projectId]/{agent/page,agent/interrupt-actions,plan/plan-detail-panel,prepare-change-panel,change-diff-section,product/page}`, `app/app/onboarding/[projectId]/page.tsx`, `app/{page,privacy/page,terms/page}.tsx`, `app/e2e/[scenario]/page.tsx`, `app/e2e/product-scan-reveal-fixture.tsx`, five `design-studies/*`, `components/layout/{app-frame,account-card,mobile-account,palette-switch}.tsx`, `app/layout.tsx`.
  Tests to re-point: `features/nova/home/nova-ui.test.ts` (the `block()` helper and the barrel assertion at :409), `app/landing-contract.test.ts` (5 paths), `app/narrow-widths.test.ts` (2), `app/design-tokens.test.ts` (1), `app/app/projects/[projectId]/command-center-ui.test.ts` (1), `app/palette.test.ts`, and the register in `feature-boundaries.test.ts`.
- **New.** `features/{product,founder-input,marketing}/README.md`, `features/nova/thread/README.md` or a paragraph in the feature's own.
- **Migration.** None.
- **Risks.** The blocks' imports of `@/app/**/agent/*` become `features → app` — the same crossings one layer down, retired by Slice 2. The register's total does not grow and no new *kind* of crossing appears; say so in the sprint record rather than letting a reader count. `landing-contract.test.ts` reads five marketing files by path and is the tightest coupling in the move.
- **Tests.** Existing, re-pointed. The boundary test gains: no file under `src/components` imports `@/app`; `src/components/nova/blocks` does not exist; no register entry names a `components/` file.
- **Done when.** The `components → app` section of the register is empty and deleted; `pnpm lint`, `pnpm typecheck`, `pnpm test` green; nothing a founder sees changed.
- **Not in this slice.** The Agent, Plan and Health surfaces (Slice 2). The shell's fourteen files (Slice 7). Any change inside a moved file.

### Slice 2 — The product surfaces leave the route tree ✅ *shipped ([Sprint 0224](../../sprints/0224-the-surfaces-leave-the-routes.md))*

- **Goal.** Close `features → app` and `modules → app`: a route file becomes an access gate plus one feature view.
- **Affected.** `agent/*` (35 non-route files) → `features/agent/`; `plan/*` (9) → `features/plan/`; `business-brain/*` (2) and `health/content.tsx` → `features/health/`; `product/*` views and the loose `understanding-*`, `deep-scan-*`, `scan-handoff`, `live-browser-canvas`, `scan-glyphs` → `features/product/`; the seven gate panels and `change-origin`, `change-rationale`, `reasoning-trail` → `features/agent/`; `experiment-card` → `features/experiments/`; `settings/*`, `founder-intent-form`, `production-url-form`, `disconnect-button`, `delete-project-button`, `activity-feed` → `features/project-settings/`. `AgentTask`, `ValidationCheck`, `PreviewChange`, `MergeSummary` and `ChangeCost` move into `src/modules/coding-agent/`; `modules/coding-agent/ui/agent-execution-live-view.tsx` moves to `features/agent/` or is deleted if nothing mounts it.
- **New.** A `README.md` and a `queries.ts` per feature; `commands.ts` stubs re-exporting the actions that still live beside the routes until Slice 3.
- **Migration.** None.
- **Risks.** The largest test churn of the plan: `test-support.ts`'s hard-coded `DIR`, `one-loop.test.ts` (~23 paths), eight `*-ui.test.ts`, `workspace-routes.test.ts`'s route walk, `design-tokens.test.ts`, `narrow-widths.test.ts`, and the fixture route's imports. `test-support.ts`'s refusal to return an empty control list is the guard that makes a missed move loud.
- **Tests.** Existing, re-pointed. The register's `features → app` and `modules → app` sections empty and are deleted.
- **Done when.** Every `page.tsx` under `projects/[projectId]` is a gate plus a mount; `src/modules` imports nothing above it; `pnpm test` green.
- **Not in this slice.** Splitting the loaders (the page may still hold its reads; `queries.ts` arrives with Slice 3). Any new UI.

### Slice 3 — One URL owner, one command/query door per feature ✅ *shipped ([Sprint 0225](../../sprints/0225-one-address-and-a-door-per-feature.md))*

- **Goal.** The typed boundary: a route imports `queries.ts` and `commands.ts` and nothing deeper; URLs have one owner.
- **Affected.** `modules/projects/attention.ts` (`projectHref`), `features/nova/home/nova-home-actions.ts` (`homePath`), `features/agent/agent-run-actions.ts` (which builds its redirect from `@/components/layout/project-shell`) → all read `src/lib/routing/project-urls.ts`. The 22 root action files → each feature's `commands.ts`. Each feature's page-level reads → `queries.ts`. `revalidatePath("/app/profile")` → `/app/settings/profile`. `modules/execution/change-history-view.ts` and `modules/projects/business-brain-view.ts` stop importing `@/components/ui/*` — `StatusTone` and `scoreDisplay` move to `src/lib`.
- **New.** `src/lib/routing/project-urls.ts` (+ test); `src/lib/ui-vocabulary.ts` or similar for the tone type and the score formatter; a `revalidate-targets.test.ts`.
- **Risks.** `PLAN_OPPORTUNITY_PARAM` and `planMoveHref` are pinned as literal source text in `one-loop.test.ts:491-495` and belong to `action-plans/source.ts` by ADR 0058 — they do **not** move; `project-urls.ts` imports them. `attention.ts` feeds the `/app` resolver and must stay byte-identical in output.
- **Done when.** One file builds `/app/projects/${id}` from parts; no `"use server"` file imports from `@/components`; the register is empty and `TRANSITIONAL_CROSSINGS` ships as `[]`.
- **Not in this slice.** Refactoring the bodies of the orchestrating actions — onboarding's free-versus-charged decision stays where it is until a feature owns onboarding.

### Slice 4 — The workspace host and the first artifacts

- **Goal.** Nova + Workspace becomes real on the project index: what the ranking opens shows in the pane on desktop and inline below `lg`, and the same view renders full-page at its own address.
- **Affected.** `features/nova/home/nova-home.tsx` (the block becomes a card plus a host mount), `components/nova/nova-room.tsx` (the work column takes the host), `projects/[projectId]/layout.tsx` (the host slot), and the six section pages (render the artifact view full-page — same output, one indirection).
- **New.** `features/workspace/{host,registry}/`, `ARTIFACT_KINDS` (closed union), `ARTIFACT_FOR_BLOCK` (total over `BlockKind`), `artifact-registry.test.ts` (every kind has a read, a view and an address; every address is a `PROJECT_SECTIONS` address; rendering an artifact starts nothing), fixture scenarios at 1280 and 390, `e2e/workspace-host.spec.ts`.
- **Risks.** Read budgets — the host renders from what `nova-home-data.ts` already loaded and adds no query to the index; `workspace-routes.test.ts` keeps its per-route budget rows. Rule 69: both widths tested in a browser before it ships. ADR 0108: below `lg` it is the bottom sheet, never a stacked column.
- **Done when.** A change awaiting review shows as a card in the thread and as the prepared-change artifact in the pane, and `/agent?change=<id>` renders the same stage full-page.
- **Not in this slice.** Threads, the composer, the rail.

### Slice 5 — Persistent threads

- **Goal.** A thread is an address and a record (§C.9): the tables, a store and read model, system-authored messages from operation tails, and a read marker. No composer yet — a thread opens with the ranking and fills with what happened.
- **Affected.** `src/modules/operations/*/execution.ts` tails (append a `system` message beside `speakAfterOperation`), `features/nova/home/*` (opening a thread from a moment), the retention sweep, `src/types/database.ts` regenerated.
- **New.** The migration; `src/modules/nova/threads/{schema,store,view}.ts`; `features/nova/{threads,thread}/`; `projects/[projectId]/threads/[threadId]/{page,loading}.tsx`; `db:test` RLS tests; `read-bounds.test.ts` entries for the new growth tables.
- **Migration.** Yes — `pnpm db:status` before `pnpm db:push`, never by SQL editor (rules 29–34).
- **Risks.** The transcript must not become a position: a test asserts that nothing under `src/modules/nova/` except `threads/` imports the thread store, and that `focus.ts` and `read.ts` cannot see a message. A thread must add no read to Home.
- **Done when.** A run started from Home leaves a `system` message in the thread; reloading shows it; deleting the thread changes no canonical state; `database.ts` matches the migration.
- **Not in this slice.** Typing. Generation. The sidebar.

### Slice 6 — The conversation lane and the action resolver

- **Goal.** The founder types; Nova answers from canonical data or proposes a catalogue action; the workspace shows what she is talking about. §C.5 and §C.8 are the contract.
- **Affected.** Every sentence in the product that says there is nothing to type — `first-run.ts:193`, `WORKFLOW_STEPS`, `nova-how-it-works.tsx`, `e2e/nova-name.spec.ts`, `nova-ui.test.ts`'s "has no chat input anywhere" (rewritten in the open to "has exactly one input, and it is the composer, bounded"), `UX-CONTRACT.md:96`, `DESIGN.md` §Nova, `src/modules/nova/README.md`.
- **New.** `modules/nova/conversation/{payload,prompt,checks,service}.ts` mirroring `voice/`'s proven shape; `modules/nova/intent/` (deterministic resolution over labels, subjects and artifact names, with `cannot` as a real answer); `features/nova/conversation/` (composer, turn view, the generation command); `features/nova/actions/` (proposal → existing control → existing command); a `nova_conversation` entry in `ai/operations.ts` with its own ADR for the price (§E.2); per-thread and per-window turn bounds beside `operations/start-limits.ts`.
- **Risks.** This is the slice where a safety property could erode silently, so each one is a test: no service-role import in the conversation layer; the founder's text never reaches a system prompt; the model's reply is validated before persistence; an action id that is not in the catalogue is dropped; a merge intent resolves to the approval artifact and never to `mergeApprovedChangeAction`; generation happens in a command and never in a render.
- **Done when.** *"Why is conversion our biggest problem?"* gets a grounded answer with the business-health artifact beside it; *"run the audit again"* ends on the same priced control the ranking offers; *"merge it"* opens the approval; an injection attempt produces a refusal and a row; and a founder who says *"the second one"* is understood.
- **Not in this slice.** Multi-turn model memory beyond the bounded pack. Nova initiating a conversation on her own.

### Slice 7 — The app shell

- **Goal.** Products · New chat · Threads · Settings at the app level; Nova + Workspace inside a project; every old section address still resolving full-page.
- **Affected.** `@rail/project-rail.tsx` and the rail layouts (contents, not mechanism), `mobile-tab-bar.tsx` (Nova · Workspace · Threads · Account), `project-shell.tsx` (`PROJECT_SECTIONS` stays the address table), the shell's fourteen files → `features/shell/`, `rail-switch.test.ts`, `project-sections.test.ts`, `e2e/{rail-fold,mobile-shell}.spec.ts`.
- **Risks.** ADR 0085's foreclosure holds — Nova is not a rail item, she is the project. ADR 0106's fluency (rail as a layout, prefetch across the fold) must survive; `rail-fold.spec.ts` is the guard. Rule 69 at both widths.
- **Done when.** A founder opening a project sees Nova and the workspace, and every old section URL resolves to its artifact full-page.
- **Not in this slice.** Deleting anything.

### Slice 8 — Legacy retirement

- **Goal.** Remove what nothing reaches: the seven dead or fixture-only files, `design-studies/legacy-*`, their scenarios and the negative assertions guarding them, the "Command Center" vocabulary, and the ROADMAP entries that closed.
- **New.** Nothing. `RETIRED_CLAIMS` entries for the sentences that stop being true.
- **Done when.** `grep -r "command-center\|home-status\|agent-panel" src` returns only history.
- **Not in this slice.** Removing any address — retired addresses stay 307s.

---

## E. What this plan does not decide (rule 14)

Each changes what a slice builds, and none can be settled from the code:

1. **Retention class for threads and messages** — operational (90 days), derived-by-count, or a new class. ADR 0068 frames it; Slice 5 needs the answer.
2. **What a conversation turn costs, and who pays.** A turn is a metered inference with its own ledger key either way. Whether it is charged at retail like the other operations, absorbed as a free operation that says so ([ADR 0094](../../decisions/0094-a-free-operation-says-so.md)), or bounded per thread and per window, is its own decision before Slice 6 ships — and the bound is not optional, only its shape is. Recommended: absorbed and bounded at launch, because a founder who hesitates before asking a question is a founder not using the product, and priced later from measured cost the way `agent_execution` was.
3. **Whether intent resolution may call a model at all.** Deterministic resolution over the catalogue's own labels and subjects ships first; a classifier is an `ai/operations.ts` entry or it does not exist.
4. **Thread scope** — per project only (this plan's assumption, because Nova's facts are project-scoped) or also account-level.
5. **The phone's fourth tab** — Threads or Account; ADR 0108's four-tab ceiling forces one out.
6. **Whether `modules/coding-agent/ui/agent-execution-live-view.tsx` has a caller at all.** Nothing in `src/` mounts it; Slice 2 either moves it to `features/agent/` or deletes it, and that is a reading, not a plan.
