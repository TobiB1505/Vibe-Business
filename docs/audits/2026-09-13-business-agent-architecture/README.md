# Vibe Business as an AI Business Agent — architecture audit and plan — 2026-09-13

**Scope:** whether Vibe Business can evolve from a dashboard-driven product with AI features into an AI-native Business Agent whose primary interface is a conversation — one orchestrator, a typed tool layer over the systems that already exist, a skill layer above the tools, persisted conversations, and rich artifacts in the thread — and, if so, exactly what is reusable, what is missing, what must be decided, and in which order to build it. Read-only; nothing was implemented.
**Audited at:** commit `6b44950` (HEAD of `claude/vibe-business-agent-arch-dhlch0`, equal to `main` at the time of reading). 132 migrations, 60 live tables, 15 operation kinds, 5 single-call AI operations plus the sandboxed coding agent.
**Method:** the implementation was read — provider boundary, operations registry, ledgers, gateway, workflow steps, stores, read models, Nova, the components and the tests that pin them. Every material claim names a file. Line numbers are deliberately omitted: this record will be read after the files move, and a path survives a refactor better than a line.
**Record status:** audit record under `docs/audits/` (CLAUDE.md rule 83). It describes the state at `6b44950` and is not edited to match the present. The decision it argues for is recorded separately as [ADR 0109](../../decisions/0109-the-business-agent-is-the-orchestrator.md), **Proposed** — nothing in this document is decided until that ADR is accepted.
**Relation to the Nova audit:** [the Nova audit of 2026-09-03](../2026-09-03-nova-architecture-audit/README.md) asked whether a guided, deterministic product agent could be built as a presentation layer over existing systems, and answered yes. It was built: Nova is the project Home ([ADR 0085](../../decisions/0085-nova-is-the-project-home.md)). This audit asks the next question, which that record explicitly declined — a conversation with a model that chooses tools — and it says so in the open rather than by drift (§K).

Vocabulary: **Confirmed** (read in code) · **Probable** (derived from code, not run) · **Open** (needs a decision or a measurement the code cannot give).

---

## A. Executive verdict

**The capabilities exist; the orchestration does not, and the repository's own rules forbid the shape the brief asks for until they are amended in the open.** Three findings carry the whole plan:

1. **Every capability the brief lists as a tool has a working, tested, ownership-scoped implementation.** Repository intelligence, public and signed-in product scans, Product Understanding, the Business Audit, the Opportunity Engine, the Action Planner, the execution resolver, agent execution, validation, preview, review classification, approval, fast-forward merge, outcome verification, business measurement, cost ceilings, the Credit ledger, the audit log — all built, reuse-keyed, priced where priced, and read through functions that take `(supabase, { projectId, … })`. §B maps 27 capabilities; **24 are reusable as-is behind a thin adapter, 3 need a redirect-free or screen-free variant, and 5 tool contracts have no implementation at all** (§B, §E). Nothing here needs a second scan, audit or planner.

2. **Nova is already three-quarters of the agent surface — and one-quarter of it is the opposite of a chat by decision.** Nova has the thread furniture, a total block registry that maps domain unions to artifact renderers, a ranked "what needs attention" read model, a control catalogue with prices and confirmation semantics, a standing context block with freshness buckets, a persona prompt with an untrusted fence, a post-hoc output validator, and a measured model-choice instrument (§A.2). What it does not have — and refuses by test — is a text input, a transcript, and a model that acts: `nova-ui.test.ts` asserts "has no chat input anywhere" and "keeps no transcript", and the Nova audit's §M lists "another agent loop", "an unrestricted chat input" and "a transcript as source of truth" under **DO NOT BUILD**. The brief reverses those three. Sprint 0215 is the precedent for how this repository reverses a guard: narrowed in the open with an argument, never edited green.

3. **The provider boundary cannot express a tool-calling turn, and CLAUDE.md rule 41 forbids adding one without a second, explicitly bounded exception.** `AIProvider` has two methods, one hard-coded user turn, no tools, no streaming, no retries — each a stated security property, not an omission. Rule 41's last sentence is aimed squarely at this design: *"It is not a licence to give any other model a tool."* The honest path is the one the rule itself names — a second exception with its own bounding triple, recorded as an ADR, with rule 41 rewritten in place (rule 83). §C.2 states the triple; ADR 0109 proposes it.

**What the target looks like, in one paragraph.** Nova stays the name, the presence and the Home. Beneath her, a **Business Agent orchestrator** runs each founder message as a **durable operation** (`agent_turn`, a Vercel Workflow), where each model call is one step with no retries, the transcript is rebuilt from persisted rows inside every step, and the model is given a **closed set of read and prepare tools** that resolve every identifier server-side against the project's own rows. **No tool starts a paid operation, writes to a repository, or moves money**: consequential actions are rendered as priced controls in the thread and pressed by the founder, which calls the same Server Action the Action Plan and Agent screens call today. Skills are Vibe-authored procedures the model loads by name. Conversations, messages, artifact references and tool calls are persisted under RLS in four tables modelled on the agent-execution trace. Progress is polled through the existing `useOperationPoll` hook, so no new liveness mechanism is introduced (rule 24). The first slice proves "What should I work on next?" end to end with zero write tools; the second proves "Fix this" through the existing plan → execute → validate → preview pipeline, with every approval a click.

**Reuse estimate, from code.** Of the 27 capabilities in §B, 24 are wrapped without change. Of the 14 artifact types the brief names (§6 of the brief), 11 have a component that takes a domain read-model type today; 3 are new copy over existing data (§G.3). Of the 5 platform primitives the orchestrator needs (provider turn, operation type, ledger exemption, trace tables, message store), all 5 have a direct precedent in the coding-agent layer. **Existing capability ≈ 80%; new agent-specific capability ≈ 20%** — and the new 20% contains one provider method, one workflow, four tables, one registry pair, and one composer.

### A.1 What is decided by this reading and what is not

| | Confirmed / Probable | Open — needs the founder |
|---|---|---|
| The capabilities are reusable behind adapters | Confirmed (§B) | — |
| The provider needs a third method; the loop belongs in the domain module | Confirmed (§C.3) | Seam A (native tool use) vs Seam B (structured-output loop) — pilot both on the existing instrument (§C.3, §I) |
| Turns run as a durable operation, polled | Probable (§C.5) | Whether token streaming is worth a second liveness mechanism later (rule 24) |
| Consequential actions are founder-pressed controls, not model tool calls | Confirmed by the existing authority model (§C.6) | — |
| Four new tables, shaped on the agent-execution trace | Probable (§D) | Retention class of conversations (§D.5) |
| The turn is `free` in `launch-v1` with hard budgets, until measured | Probable (§I.3) | The price, once measured (rule 78) |
| Rule 41 gets a second exception; rules 42, 43, 47 are restated for multi-turn | Confirmed as necessary (§K) | Acceptance of ADR 0109 |

### A.2 What Nova already is (the foundation)

Read from `src/modules/nova/`, `src/components/nova/`, `src/app/app/projects/[projectId]/nova/` and the Nova audit. Three layers under one name:

| Layer | Where | What it is | Reuse |
|---|---|---|---|
| **Ranking / read model** | `src/modules/nova/focus.ts` (pure, 21 candidate kinds, five tiers from `projects/attention.ts`), `read.ts` (bounded queries, no service role, no network), `home-view.ts`, `feed.ts`, `actions.ts`, `blocks.ts` | A deterministic function from rows to one ranked moment plus a control. "It decides order, and nothing else." | **As-is**, as the `get_project_focus` tool and as the conversation's opening system message |
| **Presence / thread UI** | `src/components/nova/` — `nova-thread.tsx` (`NovaRenderBlock` is the artifact envelope), `nova-bubble.tsx`, `nova-speech.ts` (message grouping), `nova-presence.tsx`, `nova-room.tsx`, `blocks/` (eight artifact renderers) | Bubbles, a mark, a rail, render blocks dispatched through a **total** registry (`BLOCK_FOR_MOMENT`, `BLOCK_FOR_OPERATION` in `blocks.ts`) | **As-is**, widened: a third total record `BLOCK_FOR_ARTIFACT` over the new artifact union |
| **Voice** | `src/modules/nova/voice/` — `prompt.ts` (persona + `<untrusted>` fence with the numeric allowlist outside it), `checks.ts` (nine deterministic refusals), `payload.ts` (reuse identity), `store.ts` (claimed once), `eval/` (54 cases, six-criterion rubric, two judges, `pnpm nova:probe-voice`) | One Sonnet 5 call that rephrases decided facts into one string, attempted once per identity ([ADR 0086](../../decisions/0086-nova-presentation-is-claimed-stored-and-attempted-once.md)) | **Apparatus as-is** (fence, validator, eval); the one-string operation itself is **not** widened — a tool-calling turn is a new operation (§C.3) |
| **Briefing** | `src/modules/nova/briefing/` — `briefing.ts`, `situation.ts`, `freshness.ts` | Everything Nova knows about a project in one object, cut to a number-free situation block with **freshness buckets** hashed into the reuse identity | **As-is**, as the seed of the agent context model (§C.7) |

Two facts from the same reading belong in the risk register (§I): the voice tier has run **four times in production, ever** (ADR 0086 amendment), and `docs/ROADMAP.md` records that *"Nova's thread is the primary surface and has never been seen with real data."* The agent surface inherits both.

One current-state defect found on the way: `src/modules/nova/README.md` still opens with *"Nova speaks on the onboarding route and nowhere else yet"* and *"the project Home is still Business Health"*. Both are false at HEAD — `src/app/app/projects/[projectId]/page.tsx` is titled "Nova" and mounts `NovaHome`. Rule 83 makes that a defect with the standing of a failing test; this record names it and the next sprint that touches the module closes it (§L).

---

## B. Capability inventory

Every row was read in code. "Reusable" means the existing function can be called from a tool adapter without changing its contract. "Skill consumers" are from §F.

| Capability | Current implementation | Reusable? | Proposed agent tool | Skill consumers | Gaps |
|---|---|---|---|---|---|
| Project identity, ownership, repository connection | `projects/workspace-context.ts` (`requireProjectAccess`, `getProjectWorkspaceContext`), `projects/queries.ts` | As-is | `get_project_context` | all | None. Every tool resolves ownership here, never from a model argument |
| Founder intent | `projects/founder-intent-store.ts` (`getFounderIntent`), `founder-intent.ts` (`hashFounderIntent`, closed enums) | As-is | `get_founder_intent` | all | None |
| Founder profile (name) | `auth/founder-profile.ts`, `founder_profiles` | As-is | (context only) | — | Already fenced when it reaches a model (Sprint 0215) |
| Repository intelligence — read | `repository-intelligence/store.ts` (`getLatestSuccessfulSnapshot`, `getLatestSnapshotAttempt`, `getSnapshotsByIds`), `human-view.ts` (`buildRepositoryHumanView`), `cross-check.ts` | As-is | `get_repository_context` | implementation, launch-readiness, security-readiness, performance-audit, seo | The snapshot carries no `generatedAt`; the row's `completedAt` is the freshness stamp (`provenance/from-evidence.ts` already codifies the fallback) |
| Repository intelligence — refresh | `repository-intelligence/service.ts` (`inspectRepository`, synchronous, ~20 s, free, reuse on commit SHA + analyzer version) | Variant | `scan_repository` → **founder-pressed control** bound to `startProductScanOperation` | implementation, launch-readiness | A repository-only durable refresh does not exist; `product_scan` refreshes both sources (`operations/service.ts`). Acceptable: the scan is free |
| Bounded repository file read | `repository-intelligence/reader.ts` (`RepositoryReader.getTextFile(path, sha, maxBytes)`), `github/repository-reader.ts`, `path-policy.ts` (`mayFetchContent`, `isSensitivePath`) | Pieces | `read_repository_file` | implementation, security-readiness, performance-audit | **No single function** resolves ownership → connection → installation → reader → path policy → budget. A naïve wrapper bypasses the sensitive-path gate (rule 28). New adapter, ~1 file, with its own file/byte budget |
| Repository search | Sandbox-only: `coding-agent/prompt.ts` `search_repository` brokered inside a paid `agent_execution` | No | `search_repository` — **deferred** | implementation | No GitHub-API search exists; `DEFAULT_ANALYSIS_BUDGETS` (40 files / 2 MiB) is far too small for one. Route table + `read_repository_file` cover v1; a search tool is a later budgeted addition |
| Public product intelligence — read | `live-product-intelligence/store.ts` (`getLatestSuccessfulLiveSnapshot`), `human-view.ts` (`buildLiveProductHumanView`, `describeIncompleteness`) | As-is | `get_public_product_context` | conversion, onboarding, pricing, seo, product-positioning, launch-readiness | None. `source.analyzedAt` is the freshness stamp; `readability` says when a page could not be read |
| Public product intelligence — refresh | `live-product-intelligence/service.ts` (`inspectLiveProduct`, free, 24 h reuse) | Variant | `scan_public_product` → founder-pressed control (same `product_scan` operation) | same | Same as repository refresh |
| Single-page inspection | `live-product-intelligence/crawler.ts` (`crawlSite`, whole-site only), `net/safe-fetch.ts` | No | `inspect_page` — **deferred** | conversion, onboarding | No fetch-and-classify-one-URL entry point; building one is small but it is a new outbound-request site under ADR 0010 and needs its own budget row in `budgets.ts` (rule 39) |
| Deep Scan — read | `authenticated-product-intelligence/service.ts` (`loadDeepScanViewModel`, `getDeepScanAccessStatus`), `view.ts` | As-is | `get_signed_in_product_context` | onboarding, retention, feature-validation | None |
| Deep Scan — run | `startDeepScan` / `probeDeepScanSignIn` / `analyzeDeepScan` (Server Actions; a founder signs in within two minutes) | Control only | `run_deep_scan` → founder-pressed control that opens `/product/deep-scan` | same | Cannot be started headlessly by design ([ADR 0012](../../decisions/0012-authenticated-browser-analysis.md)); the tool can only offer it, priced (25 Credits after the included one) |
| Product Understanding | `product-understanding/store.ts` (`getLatestProfile`, corrections applied on read), `view.ts` (`buildUnderstandingView`) | As-is | `get_product_context` | all | `getProfileById` is not project-scoped; the tool uses `getLatestProfile` only |
| Product Scan feed | `product-scan/store.ts` (`getProductScanEvents`, ≤24 Vibe-authored events) | As-is | (progress rendering via `ScanBlock`) | — | None |
| Provenance chain / source coverage | `provenance/chain.ts` (`buildProvenanceChain`), `from-evidence.ts`, `source-coverage.ts` — pure, no reads | As-is | inside `get_project_context` (freshness) | all | None. This is the freshness model the brief asks for, already built |
| Business Audit — read | `business-audit/store.ts` (`getLatestSuccessfulAudit`, `getProjectAuditReadings`, `getPausedAudit`), `service.ts` (`readAuditEvidence`, `getAuditCurrency`, `getAuditAccessStatus`), `projects/business-brain-view.ts` (`buildBusinessBrainView`) | As-is (view model); screen-shaped (assembly) | `get_business_health`, `get_business_audit` | business-audit, launch-readiness, growth, pricing, conversion, retention | The ten-way assembly lives in `health/content.tsx`; extract `readBusinessHealth(supabase, projectId)` into `src/modules/projects/` |
| Business Audit — run | `operations/service.ts` (`startBusinessAuditOperation`, 35 Credits, first included, reuse on `input_hash`) | As-is | `run_business_audit` → founder-pressed control | business-audit | None |
| Explain a finding | `business-audit/conclusions.ts` (`findConclusionByKey`), `evidence-labels.ts` (`describeEvidenceId`) | Pieces | `explain_finding` | business-audit, conversion, pricing | **No composed read** returns a founder-safe explanation with resolved evidence; `rootProblem` and lens `summary` are marked internal and dropped at the boundary. Needs a policy on what crosses (§E note) |
| Evidence item lookup | `business-audit/evidence-v3.ts` (`buildEvidencePackForVersion`, `evidenceIdSetV3`) | Pieces | (inside `explain_finding`) | same | No `getEvidenceItem(auditId, id)`; the pack is rebuilt from the stored snapshot ids, which `pack-provenance.ts` verifies |
| Opportunities — read | `opportunities/service.ts` (`getLatestOpportunities` with `stale`, `getMoveLineage`), `view.ts` (`moveBand`, `moveHeadline`) | As-is | `get_opportunities` | growth, product-strategy, revenue, conversion | None |
| Opportunities — run | `startOpportunityOperation` (20 Credits) | As-is | `find_opportunities` → founder-pressed control | growth | None |
| Action Plan — read | `action-plans/service.ts` (`getLatestActionPlan`, `readPlanEvidence`, `planStaleness`), `completion.ts`, `sequence.ts` (`firstActionableStep`) | As-is | `get_action_plan` | implementation, all | The plan and the resolver are joined only in `plan/page.tsx`; extract `getPlanWithExecutionRoutes` |
| Action Plan — run | `startActionPlanOperation` (20 Credits; `opportunityId` bound by the surface) | As-is | `plan_move` → founder-pressed control | implementation | None |
| Founder input, attestation, handoff | `founder-input/`, `action-plans/founder-action-store.ts`, `handoff/prompt.ts` | As-is | rendered as `AskBlock`; `founder-input` is answered by a control | implementation | None. Two question systems stay separate (audit vs plan) |
| Execution resolver | `execution-contract/resolver.ts` (`resolveStepExecution`, pure), `coding-agent/website-preflight.ts` (`resolvePlanExecutionRoutes` — reads state, never the network) | As-is | `resolve_execution` (can Vibe build this, and why not) | implementation | None. This is the "estimate/plan execution" read; it reads `executionSupport` from nowhere on purpose (rule 55) |
| Cost ceiling and forecast | `coding-agent/website-preflight.ts` (`resolveRouteAgentEconomics`), `execution-contract/budget.ts` (`LAUNCH_V1_BUDGET_POLICY`), `coding-agent/run-forecast.ts` (`forecastRun` — four fields, none money) | As-is | `estimate_execution_cost` | implementation | A **predicted** price is refused by [ADR 0072](../../decisions/0072-the-evidence-behind-the-ceiling.md); the tool returns the ceiling and the forecast's structure, nothing else |
| Agent execution — start | `app/.../agent/agent-run-actions.ts` (`startAgentRunAction`, ends in `redirect()`), `coding-agent/service.ts` (`startAgentExecution`, redirect-free primitive) | Variant | `start_execution` → founder-pressed control bound to a **redirect-free** action | implementation | `previewAgentStep → persistAgentExecutionSpec → startAgentExecution` needs one thin server function that returns instead of navigating |
| Agent execution — status | `coding-agent/service.ts` (`getAgentExecutionStatus`), `observability/live-view.ts`, `agent-stages.ts`, `timeline.ts`, `execution/change-progress.ts` (`deriveChangeProgress`, twelve stages with headlines) | As-is | `get_execution_status` | implementation | Five readers with five shapes; `getPreparedChangeWorkspaceItem` assembles them but is the expensive path (GitHub reads). The tool returns `ChangeProgress` + stages, not the workspace item |
| Validation, preview, review, approval, merge | `validation/store.ts`, `change-preview/service.ts` (`getPreviewCard`), `review/classification-service.ts` (`resolveReviewClassification`), `approvals/service.ts` (`approveChange`, `getApprovalCard`), `merge/service.ts` (`startMerge`, `getMergeCard`) | As-is, via `ReviewBlock` | `get_change_review`; approval and merge are **controls**, never tools | implementation | There is no pending-approval state (`APPROVAL_STATUSES` has no `pending`); a "request approval" tool can only render the disclosure |
| Outcome verification, business measurement | `business-measurement/project-impact.ts` (`getProjectImpact` — already tool-shaped) | As-is | `get_impact` | feature-validation, retention, all "did it work" questions | No metric source is connected; every project resolves to `waiting_for_source` and the tool must say so |
| Credits, prices, balance | `credits/retail.ts` (`resolveRetailPrice`, `retailChargeFor`), `credits/service.ts` (`getBillingBalance`), `components/ui/credit-price.tsx` (`priceDisplayFor`) | As-is | `get_cost_disclosure` (inside every priced control) | all | None. `0 Credits` is never rendered; `free` says `Included` ([ADR 0094](../../decisions/0094-a-free-operation-says-so.md)) |
| Operations, progress | `operations/service.ts` (`getOperationStatus`, `getLastFailedOperation`), `view.ts` (`OperationView`, `OPERATION_STAGE_LABELS`, `operationPollPhase`), `lib/client/use-operation-poll.ts` | As-is | (turn progress) | — | None. Pull-only by design; no SSE, no realtime |
| Audit log / activity | `audit-log/events.ts` (`recordAuditEvent`, closed vocabulary), `view.ts` (`buildActivityFeed`) | As-is | `get_recent_activity` | all | None |
| Nova focus ranking | `nova/focus.ts` (`deriveNovaFocus`), `read.ts` (`readNovaFocus`) | As-is | `get_project_focus` | all — this is the deterministic answer to "what needs attention" | None |
| Situation / freshness block | `nova/briefing/situation.ts` (`novaSituationFrom`), `freshness.ts` | As-is | (context, §C.7) | all | None |

**Duplicated AI work today: none** — the Nova audit's §C finding holds at HEAD. Each operation checks a reuse identity before any hold, and `maxRetries = 0` on every billable step.

---

## C. Proposed target architecture

### C.1 Shape

```
 Founder
   │  types, or presses a control
   ▼
 Composer / thread  ────────────────────────────────  src/app/app/projects/[projectId]/nova/   (A: Nova, extended)
   │  startAgentTurnOperation(projectId, text)          src/modules/operations/business-agent/
   ▼
 agent_turn  (durable operation, Vercel Workflow)     ADR 0013 · rule 49 · rule 52
   │  step: rebuild transcript from rows
   │  step: one model call  (maxRetries = 0)           AIProvider.generateWithTools   (new, §C.3)
   │  step: dispatch tool calls, persist results
   │  … bounded loop …
   │  step: validate the reply, persist message + artifact refs, finish
   ▼
 Business Agent module                                src/modules/business-agent/
   ├── orchestrator/   the loop, budgets, stop rules, output validation
   ├── tools/          registry (total), adapters over existing modules, renderers for the model
   ├── skills/         registry (total), Vibe-authored procedures
   ├── context/        AgentContextBrief — composed from briefing, profile, focus, provenance
   └── conversation/   store: conversations, messages, artifact refs, tool calls
   ▼
 Existing Vibe systems (unchanged)                    intelligence · reasoning · execution · verification · economics
   ▼
 Evidence rows · canonical artifacts · operations · ledgers
```

**Dependency direction.** `business-agent/tools/` imports the existing modules' read models and start functions; nothing in the existing modules imports the agent. `business-agent/` imports `ai/provider.ts` (the boundary) and never a provider SDK (rule 40). `operations/business-agent/` owns the workflow, the service-role writes and the only calls to `generateWithTools` (rule 53). `src/components/nova/` renders values and holds no prose of its own, exactly as today (`src/components/nova/nova-ui.test.ts`).

### C.2 The bounding triple (the argument rule 41 requires)

Rule 41 admits agentic execution as an exception because it is bounded by three named mechanisms: an isolated VM holding no credential, an explicitly named tool set with no network tool, and Vibe's own verification of the result. A chat orchestrator in a Vibe process has none of those three as written. The proposal names its own three, and asks that they be judged as strong:

1. **Absent capability, not denied capability** (rule 76). The tool set is a closed `as const` union. It contains **no** tool that writes to a repository, moves money, starts a paid operation, opens an outbound connection to a customer URL, runs a command, issues a query the model composes, or selects a model. Every tool is a read against Vibe's own rows scoped by the project id taken from the persisted operation row, a bounded read through an already-budgeted port (`RepositoryReader` under `path-policy.ts`), or a **preparation** that builds an offer — which is rendered as a control the founder presses. A tool the model was not given cannot be called; there is nothing to grant or revoke.
2. **Arguments are requests; the runtime's own check is the fact.** Every identifier a tool receives (`opportunityId`, `stepKey`, `path`, `auditId`) is sanitized and resolved against that project's own rows before use, the way `?plan=` already is ([ADR 0058](../../decisions/0058-move-focus-url-contract.md): sanitized, resolved against stored Moves, carries no authority). A stale, foreign or malformed id degrades to a typed tool error the model can route around — never to another project's row. The schema shown to the model constrains its output shape; it decides nothing about legality (`coding-agent/provider.ts` states this doctrine for `AgentToolDescriptor` already).
3. **Vibe verifies what the founder reads.** The assistant's reply is validated deterministically before it is persisted: no banned claim (`checks.ts` vocabulary — never "deployed", "live", "safe", "fixed"), no causal claim (`business-measurement/causality`), no number that did not appear in a tool result of this turn (the `allowedNumericFacts` mechanism, generalised), and every artifact reference must name an id a tool returned in this turn (rule 45, generalised). A reply that fails is replaced by a template that says the agent could not answer, and the turn is recorded as such — the same five-way fallback `voice/service.ts` has today.

What the triple does **not** claim: that prompt injection is impossible. It claims that an injected instruction has nothing to reach — no write, no spend, no network, no other tenant — and that anything it makes the model *say* is checked before a founder sees it. That is the same claim ADR 0011 makes for single-call inference, restated for a model that can read more than one document.

### C.3 The provider seam

`AIProvider` in `src/modules/ai/provider.ts` gains a **third method**; `StructuredRequest` stays structurally tool-free for the five shipped operations:

```ts
// beside countInputTokens / generateStructured — names illustrative
export type AgentTurn =
  | { role: "user"; content: string }                                   // fenced by the caller
  | { role: "assistant"; content: readonly AssistantBlock[] }           // text and tool_use blocks
  | { role: "tool_result"; toolCallId: string; content: string; isError: boolean };

export type ToolCallingRequest = {
  operation: AIOperation; model: string; system: string;                // authored, integers only
  messages: readonly AgentTurn[];                                       // rebuilt each turn from rows
  tools: readonly AIToolDescriptor[];                                   // { name, description, inputSchema }
  maxOutputTokens: number; reasoning: AIReasoning; timeoutMs: number;
};

export type ToolCallingResult =
  | { ok: true; stopReason: "end_turn" | "tool_use" | "max_tokens";
      text: string; toolCalls: readonly { id: string; name: string; input: unknown }[];
      usage: AIUsage & { cacheReadInputTokens: number; cacheCreationInputTokens: number };
      model: string; latencyMs: number }
  | StructuredFailure;

interface AIProvider {
  countInputTokens(request: StructuredRequest | ToolCallingRequest): Promise<TokenCountResult>;
  generateStructured(request: StructuredRequest): Promise<StructuredResult>;
  generateWithTools(request: ToolCallingRequest): Promise<ToolCallingResult>;   // ONE turn, no loop
}
```

Four properties carried over deliberately: the method performs **one** turn and the loop lives in the domain module (as `business-audit/runner.ts` owns its pipeline today); cache-token fields live on the tool-calling result, not on `AIUsage`, so the five existing operations stay byte-identical (`ai/usage.ts` already accepts them, `pricing.ts` already prices them); `AIFailureCode` gains `tool_arguments_invalid` and `tool_loop_exhausted` in the one-code-per-stage spirit; streaming stays out at first (`anthropic/adapter.ts` ties non-streaming to exact usage accounting — the gateway's `tee()` + `after()` + `createUsageAccumulator` in `coding-agent/gateway-usage.ts` is the worked example if it is wanted later).

**Seam B, the control arm.** The loop can also be run against `generateStructured` with an output schema of the form `{ action: "call_tool" | "answer", tool?, args?, message? }`, dispatching in Vibe and appending results to `userContent`. It violates no current rule and needs no provider change; it costs native tool-use quality, prompt-cache efficiency (one user string is re-sent uncached every turn), and puts turn-shaped JSON through a grammar compiler that has already rejected an over-large schema once (`business-audit/wire-schema.ts`). [ADR 0084](../../decisions/0084-nova-voice-is-measured-not-argued.md) asks that a cheaper assumption be a five-case pilot before it is a config. **Recommendation:** pilot Seam B as the control arm against Seam A on the Nova eval instrument, forked to grade trajectories (§C.8), before ADR 0109 is accepted.

### C.4 The orchestrator loop

```
startAgentTurnOperation(supabase, executor, { projectId, userId, conversationId | null, text })
  ownership by query (RLS client) → sanitize + bound the text (rule 42; MAX_MESSAGE_CHARS) →
  insert conversation if needed, insert the user message (service role, operations module) →
  reuse: identical (conversationId, text, context hash) within the window → reused turn →
  start limits (FREE_WORK class at first) → kill switch → createOperationRun("agent_turn") → enqueue

agentTurnWorkflow(operationId)
  load_context   step: rebuild AgentContextBrief from rows; persist nothing but its hash
  loop (i < maxModelCalls):
    sample       step: rebuild transcript from agent_messages + this turn's tool calls;
                       countInputTokens on the exact request; refuse over maxInputTokens;
                       generateWithTools; recordAIUsage (jobId = turn run id); maxRetries = 0
    if stopReason !== "tool_use": break
    dispatch     step: for each tool call — validate against the registry schema, resolve ids,
                       execute with { projectId, userId } from the operation row, bound the
                       rendered result, persist an agent_turn_tool_calls row, persist the
                       tool_result content for the next sample step
  finish         step: validate the reply (§C.2.3), persist the assistant message + artifact refs,
                       completeOperationRun; on any budget stop, persist the template reply and
                       fail the run with a typed code
```

Budgets live in one config beside `AGENTIC_EXECUTION_CONFIG` in `src/modules/ai/operations.ts` (model, effort) and in `business-agent/orchestrator/budgets.ts` (turn shape): `maxModelCalls` (8), `maxToolCalls` (12), `maxInputTokensPerCall`, `maxTotalOutputTokens`, `maxWallClockMs` (120 000), `maxToolResultBytes` per tool. Every ceiling is a number in a file, not a prompt sentence.

**What crosses a step boundary:** the operation id and row ids. The transcript, the tool results and the model output are persisted in Supabase inside the step that produced them and read back by the next (rule 52). This is not a cost: it is the message store doing the job the brief asks of it.

### C.5 Why a durable operation, and why polled

Rule 49 puts anything measured in tens of seconds outside the request; a turn that reads two documents and calls the model three times is that. ADR 0013 makes the durable form a Workflow; rule 24 forbids a second background technology, and a push channel for tokens would be a second liveness mechanism beside polling. The existing hook (`use-operation-poll.ts`: one reading in flight, hidden-tab skip, backoff to eight intervals) and `NovaHeaderLive` (refreshes the thread when the phase leaves `working`) already give the thread a working progress model at no new infrastructure. **Progress events** are three things, all existing: `operation_runs.stage` (new closed values — `understanding_request`, `consulting_evidence`, `composing_reply` — a migration widening the CHECK, as `20260825120000` did), the turn's tool-call rows (each tool carries a Vibe-authored `progressLabel`: "Checking latest repository intelligence", "Reading your Business Health"), and `OPERATION_STAGE_LABELS`. No percentage, no step counter (DESIGN.md truth rule).

Latency is the price: a Workflow start plus a hop per step. It is named in §I.6 with the measurement that would decide whether streaming earns its ADR.

### C.6 Authority: the model proposes, the founder presses

The existing product has one authority model and this design does not add a second (Nova audit §J, unchanged): a priced operation is always a press on a control that states its price ([ADR 0094](../../decisions/0094-a-free-operation-says-so.md), `nova/audit-is-a-choice.test.ts`), an approval binds to one commit (rule 67), a merge re-reads live state before the write (rule 70), and no model output selects a path, a branch or a model (rules 46, 57).

So the tool layer has three classifications and one absence:

| Class | Model may call | Examples | What it does |
|---|---|---|---|
| `READ_ONLY` | yes | `get_business_health`, `get_opportunities`, `read_repository_file` | reads, bounded, project-scoped |
| `PREPARE` | yes | `resolve_execution`, `estimate_execution_cost`, `offer_operation` | builds an **offer** artifact carrying a control bound to an existing Server Action, with its price |
| `WRITE` / `EXTERNAL_SIDE_EFFECT` | **no — absent** | starting an audit, plan or run; approving; merging; a Deep Scan | pressed by the founder; the press calls the same action the Action Plan and Agent screens call; the press is recorded in the conversation as a founder message plus an artifact |

"Implement that." therefore ends in a card, not a spend: the model calls `resolve_execution` and `estimate_execution_cost`, the thread renders the offer with "Run with Vibe · up to 200 Credits", and the founder's click — through `NovaServerActionControl` and the catalogue in `nova/actions.ts` — starts the run. A `request_approval` "tool" is thereby a rendering, which is also the only thing it *can* be: `APPROVAL_STATUSES` has no `pending` (`approvals/schema.ts`), and a persisted pending approval would be a new authority concept with its own ADR.

### C.7 Context model and memory

**`AgentContextBrief`** (`business-agent/context/`) is composed, never stored, from what exists: the product identity block (`product_profiles` columns, corrected on read), the founder's intent and name (fenced), the situation block with freshness buckets (`nova/briefing/situation.ts`), the focus ranking (`deriveNovaFocus`), the provenance chain (`buildProvenanceChain`), balance and plan, and the last N messages of the conversation. It is bounded like the execution brief (`execution-context/compiler.ts`: max facts, max bytes) and every customer-derived value sits inside the fence. Freshness is per source: `{ source, snapshotId, producedAt, producedBy, state: current | outdated | missing }` — the shape `provenance/chain.ts` already returns. The system prompt tells the model to say which it is (known fact, cached intelligence, outdated intelligence, inference, recommendation) and the validator refuses "live" and "deployed" regardless.

**Memory, kept apart** (brief §14): conversation memory is `agent_messages`; project memory is the canonical rows (profile, intent, corrections, resolutions) and is written only through their existing actions; intelligence snapshots are the four snapshot tables; founder intent is `project_founder_intent`; agent artifacts are **references** — `agent_message_artifacts(kind, subject_id)` pointing at `business_opportunities`, `action_plans`, `prepared_changes`, `business_readiness_audits` — never copies (brief §22, rule 26 in spirit). The thread renders an artifact by reading the canonical row through the block registry, so a Move that was replanned renders as it is now, with the message's own date beside it.

### C.8 Skills

A skill is a Vibe-authored procedure, not a mode: `AgentSkill = { id, description, whenToUse, goals, procedure (markdown, authored), recommendedTools, constraints, completion }` in `business-agent/skills/<id>/skill.ts` with the procedure in a sibling `SKILL.md`, both versioned by one `SKILL_REGISTRY_VERSION`. The system prompt carries the **index** (id and `whenToUse`, ~15 lines); the model loads a procedure with `use_skill(id)`, a `READ_ONLY` tool that returns Vibe's own text — trusted, so not fenced — bounded by a byte cap. Selection is the model's, from the index; multiple skills per conversation are ordinary. There is no DSL, no router, and no keyword table to keep in sync: `skills.test.ts` asserts that every skill names only tools the registry has and that every procedure cites no file path and no model.

The eval instrument for skills and for the seam decision is the Nova one, forked at the case/rubric/runner seam ADR 0084 anticipated: a case carries a scripted tool environment (fixture rows) and a founder message; the judge reads a transcript; the criteria are trajectory-shaped (right skill, right tools, stopped when it should, no invented fact, no obeyed injection). `judgeMessage`, the pool, retries and re-judge carry over unchanged.

---

## D. Data model changes

Only where the brief's questions have no existing home. Four tables, shaped on the agent-execution trace ([ADR 0030](../../decisions/0030-agent-execution-observability.md), migrations `20260818210000_agent_execution.sql`, `20260819120000_agent_execution_events.sql`), following the conventions of the most recent table migration (`20260907115045_action_plan_handoff.sql`): prose header, comments, `(select auth.uid())` in every policy, `revoke all … from anon, authenticated` then explicit grants, a covering index per foreign key in the order the query uses.

### D.1 Tables

| Table | Holds | Key columns | Constraints worth stating |
|---|---|---|---|
| `agent_conversations` | one thread of a project | `id`, `project_id → projects (cascade)`, `user_id`, `title` (Vibe-derived, ≤120), `created_at`, `last_message_at`, `archived_at` | index `(project_id, last_message_at desc)` |
| `agent_messages` | one message | `id`, `conversation_id`, `project_id`, `sequence`, `role ∈ {founder, assistant, system}`, `content text` (CHECK 1..4000 for founder, 20..2000 for assistant; system messages carry a `template_key` and no content), `origin ∈ {typed, control_press, template, model}`, `turn_run_id`, `created_at` | `unique (conversation_id, sequence)`; `origin = model ⇒ turn_run_id not null`; assistant content is model output — the `nova_voice_messages.message` precedent, validated before insert (§C.2.3), length-checked; **no column a reasoning trace can occupy** (rule 43) |
| `agent_message_artifacts` | a reference from a message to a canonical row | `message_id`, `project_id`, `kind` (closed CHECK: `opportunity`, `action_plan`, `plan_step`, `prepared_change`, `audit`, `finding`, `execution_offer`, `operation_offer`, `impact`, `progress`), `subject_id uuid`, `subject_key text` (for composite subjects such as a plan step), `position` | `unique (message_id, position)`; composite FK where the subject has a `(id, project_id)` unique key (`action_plans`, `prepared_changes`) |
| `agent_turn_runs` | one turn: what it was given, did, cost | `id`, `conversation_id`, `project_id`, `user_id`, `operation_run_id → operation_runs (restrict)`, `founder_message_id`, `assistant_message_id`, `status ∈ {queued, running, succeeded, failed, cancelled}`, `failure_code`, `model`, `prompt_version`, `skill_registry_version`, `tool_registry_version`, `policy_version`, `context_hash`, counters (`model_calls`, `tool_calls`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `duration_ms`), `started_at`, `completed_at` | partial unique `(conversation_id) where status in ('queued','running')` — one live turn per conversation, the `execution_interrupts` idiom; four version columns as `agent_execution_runs` has |
| `agent_turn_tool_calls` | one tool call | `turn_run_id`, `project_id`, `sequence`, `tool` (≤80), `classification ∈ {read_only, prepare}`, `decision ∈ {allowed, denied}`, `denial_reason`, `input jsonb` (≤4 KiB, key-allowlisted per tool, never a file body), `result_kind ∈ {ok, error, empty}`, `result_bytes`, `subject_ids jsonb`, `duration_ms`, `started_at` | `unique (turn_run_id, sequence)`; `decision <> 'denied' or denial_reason is not null` — verbatim from `agent_tool_events`, which has had **zero rows since ADR 0070 deleted its writer** and whose reviewed shape is exactly this |

**RLS posture:** `select` to `authenticated` via project ownership on all four; **no** client write policy on any; `service_role` gets `select, insert, update` (delete only through the project cascade). All writes come from `src/modules/operations/business-agent/`, so rule 53 needs no new `REVIEWED_SITES` entry. `src/lib/consistency/table-writers.test.ts` will demand a writer for each table in the same change.

### D.2 Existing tables touched

- `operation_runs.operation_type` CHECK widened with `agent_turn` (migration; `OPERATION_TYPES` in `operations/schema.ts`; `START_LIMITS` entry — `FREE_WORK` at first, §I.3).
- `operation_runs.stage` CHECK widened with the three turn stages (§C.5); `OPERATION_STAGE_LABELS` gains three founder-voice sentences.
- `ai_usage_events_job_idx` — unique on `job_id` except `agentic_execution` (`20260819010000_agent_usage_cardinality.sql`). A turn makes N calls under one job id and **will hit this constraint on call two**; the exemption is extended to `agent_turn` exactly as the agent's was, and `src/modules/ai/usage-cardinality.test.ts` asserts both halves.
- `AIOperation` gains `agent_turn`; `operations.ts` gains its config; `pricing.ts` needs no new row while the model is Sonnet 5 or Haiku 4.5.
- Two `audit_events` types with real callers: `agent_conversation.started`, `agent_turn.completed` (rule 15: none ahead of a caller).

### D.3 What is deliberately not stored

Model reasoning (rule 43; there is no column for it). Tool results in full — a tool result is persisted only as the bounded text the next model call needs, on the turn, and is not a message; the canonical row it came from is the record. Repository file bodies (rule 26) — `read_repository_file` returns a bounded excerpt to the model and stores the path, the byte count and the commit SHA on the tool-call row. Prompt text (rule 47). The system prompt (versioned by constant, like `PROMPT_VERSION`).

### D.4 Idempotency

Turn start is keyed like every other start: a reuse identity over `(conversationId, normalized text, context hash)` within a short window answers a double submit with the existing turn; the partial unique index on live turns is the database guarantee. Each model call is one step with `maxRetries = 0` (rule 50), and `inference_started_at` on the turn is written before the first call and never cleared, so an ambiguous outcome resolves to a failed turn, never a second call.

### D.5 Retention (Open)

By the taxonomy of [ADR 0068](../../decisions/0068-retention-periods.md), `agent_turn_runs` is a cascade parent and `NEVER_SWEPT_BY_AGE`; `agent_turn_tool_calls` is an operational event and joins the 90-day sweep in `retention/periods.ts` and `retention_sweep()` (both must name it, `sweep.test.ts` string-matches). **Conversations and messages are the open question:** as operational events they would vanish after 90 days, which contradicts "reopen conversations" (brief §21); as derived intelligence they fall under the count rule nobody enforces. Recommendation: retained until project deletion (cascade) with an `archived_at` the founder controls, and named in `NEVER_SWEPT_BY_AGE` with that reason — a founder's record of what Vibe told them is closer to the audit trail than to a scan event. The privacy page's retention disclosure test will demand the sentence.

---

## E. Tool catalog v1

Classification: `READ_ONLY` and `PREPARE` are model-callable. Anything that spends, writes or acts is a **control** — a founder press bound to an existing Server Action through the catalogue in `nova/actions.ts` — listed here so the catalogue is complete, and marked as absent from the model's tool set. Input identifiers are always resolved against the project's own rows; "approval" means what the founder must do, never what the model may do.

| Tool | Purpose | Class | Underlying implementation | Input | Output | Approval |
|---|---|---|---|---|---|---|
| `get_project_context` | identity, repository, live URL, intent, balance, provenance chain with freshness | READ_ONLY | `getProjectWorkspaceContext`, `getFounderIntent`, `product_profiles` identity columns, `buildProvenanceChain`, `getHeaderCreditBalance` | — | `ProjectContext { product, repository, founder, sources: ProvenanceLink[], balance }` | none |
| `get_project_focus` | what needs attention now, ranked, and what is running | READ_ONLY | `readNovaFocus` → `deriveNovaFocus` | — | `NovaFocus` (primary, secondary, working) | none |
| `get_product_context` | what the product is, corrected on read, with confidence and sources | READ_ONLY | `getLatestProfile`, `buildUnderstandingView` | — | `UnderstandingView` + `generatedAt`, `completeness`, `limitations` | none |
| `get_repository_context` | stack, structure, routes, business surfaces, scripts, completeness | READ_ONLY | `getLatestSuccessfulSnapshot`, `buildRepositoryHumanView` | `{ section?: enum }` | bounded human view + `source.commitSha`, `analyzerVersion`, `completedAt`, partial reasons | none |
| `read_repository_file` | one text file at the analyzed commit, bounded | READ_ONLY | new adapter: connection → installation → `createGithubRepositoryReader` → `mayFetchContent(path)` → `getTextFile(path, snapshotSha, maxBytes)` | `{ path }` | `{ path, commitSha, bytes, truncated, excerpt }` fenced; sensitive path → typed refusal | none; per-turn budget (files, bytes) |
| `get_public_product_context` | pages, surfaces, SEO/conversion signals, pricing, readability | READ_ONLY | `getLatestSuccessfulLiveSnapshot`, `buildLiveProductHumanView`, `describeIncompleteness` | `{ section?: enum }` | bounded view + `analyzedAt`, `analyzerVersion`, completeness | none |
| `get_signed_in_product_context` | Deep Scan result and access status | READ_ONLY | `loadDeepScanViewModel` | — | `DeepScanViewModel` (no provider id, no URL, no cost) | none |
| `get_business_health` | overall score or its absence, lens map, priorities, trend | READ_ONLY | `readAuditEvidence`, `getLatestSuccessfulAudit`, `buildBusinessBrainView`, `buildScoreSeries` — assembly extracted from `health/content.tsx` | `{ lens?: BusinessLens }` | `BusinessBrainView` + `AuditCurrency` | none |
| `explain_finding` | one conclusion with its evidence resolved to labels | READ_ONLY | `findConclusionByKey`, `describeEvidenceId`; **policy needed** on `rootProblem`/`summary` (internal today) | `{ conclusionKey }` | `{ headline, explanation, whyItMatters, evidence: { id, label, source }[], confidence }` | none |
| `get_opportunities` | the ranked Moves with lineage and staleness | READ_ONLY | `getLatestOpportunities`, `getMoveLineage`, `moveBand` | — | `OpportunitySetView` | none |
| `get_action_plan` | the plan, step completion, first actionable step, staleness, open questions | READ_ONLY | `getLatestActionPlan` (+ `resolvePlanExecutionRoutes` via the extracted `getPlanWithExecutionRoutes`) | `{ opportunityId? }` resolved against the project's Moves | `ActionPlanView` + `ExecutionResolution[]` | none |
| `resolve_execution` | can Vibe build this step, and why not | PREPARE | `resolvePlanExecutionRoutes` (reads state, never the network), `stepResponsibility` | `{ stepKey }` | `ExecutionResolution` + responsibility copy | none — a forecast, never an admission |
| `estimate_execution_cost` | the Credit ceiling and the forecast's structure | PREPARE | `resolveRouteAgentEconomics`, `forecastRun` | `{ stepKey, chain? }` | `{ maxCredits, pricingClass, forecast: RunForecast }` — **no predicted amount** (ADR 0072) | none |
| `offer_operation` | render a priced control for a paid or included operation | PREPARE | `resolveRetailPrice`, `getAuditAccessStatus` / readiness checks; emits an `operation_offer` artifact bound to `refresh_audit`, `plan_move`, `rescan_product`, `find_moves`, `run_deep_scan` in `nova/actions.ts` | `{ operation, opportunityId? }` | artifact ref | **founder press**; the press re-runs the action's own admission |
| `offer_execution` | render the run offer for one step | PREPARE | `previewAgentStep` (redirect-free) → `execution_offer` artifact bound to the redirect-free start (§B) | `{ stepKey, chain? }` | artifact ref with ceiling, risk label, caveats, workspace-choice or stale-read substitutes | **founder press** |
| `get_execution_status` | where a change is, in one word and named stages | READ_ONLY | `deriveChangeProgress` inputs from rows, `agentStageSteps`, `listExecutionEvents(audience = customer)` | `{ preparedChangeId? }` resolved | `ChangeProgress` + stages + customer timeline | none |
| `get_change_review` | validation verdict, preview availability, classification, diff summary | READ_ONLY | `getLatestValidationForPreparedChange`, `getPreviewCard`, `resolveReviewClassification` (computed once, threaded) | `{ preparedChangeId }` | review artifact ref rendered by `ReviewBlock` (approval and merge controls inside it) | approve and merge are **presses** with `confirmed: true` and the CI/CD sentence |
| `get_impact` | what became true after each merged change | READ_ONLY | `getProjectImpact` | — | `ProjectImpact` (`waiting_for_source` stated, never "worked") | none |
| `get_recent_activity` | the last N audit events | READ_ONLY | `listAuditEventsForProject`, `buildActivityFeed` | `{ limit ≤ 20 }` | `ActivityEntry[]` | none |
| `use_skill` | load one Vibe-authored procedure | READ_ONLY | skill registry | `{ skillId }` | procedure text, bounded | none |

**Absent from the model's tool set, present as controls:** `run_business_audit`, `find_opportunities`, `plan_move`, `scan_repository` / `scan_public_product` (one `product_scan`), `run_deep_scan`, `start_execution`, `validate_change`, `create_preview`, `approve_change`, `merge_change`, `verify_outcome`, `answer_founder_question`, `attest_founder_step`. Each already exists as a Server Action with its own admission, price and confirmation semantics, and each is already in `nova/actions.ts` or one line away from it.

**Deferred with a reason:** `search_repository` (no budgeted implementation; §B), `inspect_page` (new outbound site under ADR 0010; §B), `get_analytics` / `get_product_metrics` (no metric source is connected; the tool would have one answer).

---

## F. Skill catalog v1

Each skill is a procedure over the tools above; none owns a tool. "Intent" is what the index tells the model; the procedure is the SKILL.md body.

| Skill | Intent (when to use) | Recommended tools | Workflow |
|---|---|---|---|
| `next-move` | "What should I work on next?", "where do I start", a fresh conversation with no question | `get_project_focus`, `get_business_health`, `get_opportunities`, `get_action_plan`, `resolve_execution` | lead with the focus ranking's primary; explain the highest-priority Move with its conclusion; say what Vibe can build of it; offer the next control at its price |
| `business-audit` | "audit my product/business", "how healthy is this", a lens by name | `get_business_health`, `explain_finding`, `get_product_context`, `offer_operation(business_audit)` | read the latest audit and its currency; if outdated or missing, say so and offer the audit; otherwise explain overall, the primary priority and the strengths, per lens on request |
| `launch-readiness` | "are we ready to launch", "what's missing before launch" | `get_business_health` (Business Readiness lens first), `get_public_product_context`, `get_repository_context`, `get_action_plan` | walk the readiness lens, then conversion and measurement; list absences the scans observed (never absences a page could not be read for); offer the plan for the top gap |
| `conversion-optimization` | "why aren't people signing up/buying", "improve conversion" | `get_public_product_context` (conversion signals, forms, CTAs), `get_signed_in_product_context`, `get_business_health(conversion)`, `explain_finding`, `read_repository_file` (route files) | evidence-backed bottlenecks ranked by the audit's confidence; one recommendation; `offer_execution` where a step exists, `offer_operation(plan)` where it does not |
| `onboarding-optimization` | "improve onboarding", "first-run experience" | as conversion, weighted to the signed-in scan | same shape; says plainly when no Deep Scan exists and offers it |
| `pricing-strategy` | "audit my pricing", "what should I charge" | `get_public_product_context` (declared and observed prices), `get_business_health(revenue)`, `get_founder_intent` (monetization) | separate what the site declares from what it shows; contradictions from the audit; never invents a price |
| `growth-opportunities` | "find the biggest opportunity", "how do I grow" | `get_opportunities`, `get_business_health(acquisition, audience)`, `offer_operation(opportunity_generation)` | the ranked Moves as they are; staleness stated; refresh offered at its price |
| `seo` | "SEO", "search", "why can't people find us" | `get_public_product_context(seo)`, `get_repository_context(routes)`, `get_action_plan` | coverage per page; the deterministic SEO capability where the registry admits it |
| `implementation` | "fix this", "implement that", "build it", "do it" | `get_action_plan`, `resolve_execution`, `estimate_execution_cost`, `offer_execution`, `get_execution_status`, `get_change_review` | resolve the referenced Move or step from the conversation's artifacts; plan if no plan; offer the run with ceiling and caveats; after the press, narrate stages from rows; hand the review card |
| `impact-review` | "did it work", "what changed", "show me results" | `get_impact`, `get_execution_status`, `get_recent_activity` | outcome and measurement states as they are; `waiting_for_source` said in the founder's words; no causal claim |
| `product-positioning`, `retention`, `feature-validation`, `performance-audit`, `security-readiness` | as named | subsets of the above plus `read_repository_file` for the last two | v1 ships the index entry and a short procedure; depth follows dogfood |

---

## G. Migration map

### G.1 Pages

Classification per the brief: **A** primary chat surface · **B** secondary detail view opened from chat · **C** persistent control surface · **D** redundant, remove later.

| Route | Today | Class | Reason |
|---|---|---|---|
| `/app/projects/:id` (Home) | Nova: focus thread, one control, what is running | **A** | Becomes the conversation: the deterministic focus stays as the opening system message; the composer is added; messages append |
| `/app/onboarding/:id` | Nova onboarding thread over `deriveOnboardingState` | **A-absorb, later** | Already a thread; keeps its state machine and its rail-less shell; gains the composer last (setup is linear by design) |
| `/health` (+ `#business-audit`) | Business Brain, lens scores, evidence | **B** | `AuditBlock` is the compact form; the full map stays as the drill-down; the anchor must keep resolving (`opportunities/view.ts` depends on it) |
| `/product` | Product dossier, scan, understanding, source coverage | **B** | The dossier and the correction editor remain; the scan already streams into the thread as `ScanBlock` |
| `/product/deep-scan` | Live browser canvas (`maxDuration = 240`) | **B** | Its own route for the duration ceiling; launched from a control in the thread |
| `/plan` | Now/Next/Later stepper, one Move, checklist, handoff | **B** | `MoveBlock` carries one Move; browsing all Moves and the checklist stays here |
| `/agent` | Five-stage workspace, 30 components | **A-absorb + B** | `ReviewBlock`, `AgentWorking`, `NovaAgentStage` already re-render its stages; the route remains the workbench for diffs and file lists |
| `/experiments` | One card per merged change | **B** | Drill-down for `get_impact` |
| `/settings`, `/settings/activity` | Intent, URL, reconnect, delete; audit log | **C** (activity: **C → Activity**) | Configuration never lives in a conversation; the audit log is the backing store for a top-level Activity item |
| `/app/settings/*` (account) | General, Products, Repositories, Billing, Profile | **C** | Unchanged |
| `/app` | Redirect resolver | **C** | Where "the agent is the entry point" lands: it already resolves to a product's Home, which is Nova |
| `home-status.tsx`, `agent-panel.tsx`, `intelligence-summary.tsx`, `live-intelligence-summary.tsx`, `audit-overview.tsx`, `components/layout/app-shell.tsx`, `account-nav.tsx`, `e2e/design-studies/legacy-*.tsx` | Pre-Nova compositions, fixture-only reach | **D** | Remove in a deletion sprint once the thread carries their content; `nova-feed.tsx`, `nova-message.tsx`, `nova-choice.tsx` join them — their only importer is their own contract test |

### G.2 Navigation

Today's rail: **Home (Nova) · Business Health · My Product · Action Plan · Agent · Experiments · Settings**, from `PROJECT_SECTIONS` in `components/layout/project-shell.tsx`; four tabs plus *More* on a phone ([ADR 0108](../../decisions/0108-a-phone-is-not-a-narrow-desktop.md)). The brief's direction — **Agent · Product · Health · Activity · Settings** — is reachable, but not blindly: Action Plan and Agent are B surfaces that would move behind Product/Health drill-downs or behind the thread's own links, `?plan=` carry-over ([ADR 0058](../../decisions/0058-move-focus-url-contract.md), "exactly one navigation item carries the parameter") must be restated, `WORKSPACE_SECTION_HEADINGS` and `workspace-routes.test.ts` pin a route file per section, and Activity must be promoted out of `PROJECT_SUBSECTIONS`. **Recommendation:** no rail change in Phases 1–8; decide the rail with the evidence of one dogfooded conversation (Phase 9), by an ADR amending 0085's rail sentence.

### G.3 Artifact types → renderers

| Brief's artifact type | Existing renderer (takes a domain type) | Status |
|---|---|---|
| `text` | `NovaBubble`, `speechBubbles` | as-is |
| `analysis_summary`, `business_health` | `AuditBlock` over `BusinessBrainView`; `BusinessMap variant="block"` | as-is |
| `finding` | `FindingCard` (`components/system/finding-card.tsx`, domain-agnostic), `ReasoningTrail`, `EvidenceDrawer` | as-is |
| `opportunity` | `MoveBlock` over `BusinessOpportunity` (`MoveCard variant="block"`) | as-is |
| `action_plan` | `PlanCompleteCard`, `HandoffCard`, plan step rows | adapt (`presentation: "feed"`) |
| `recommendation` | new copy over `FindingCard` + a control | new copy |
| `approval_request` | `AskBlock`/`FounderInputCard`, `WorkspaceAskBlock`, `ActionBlock` with `CostDisclosure` | as-is |
| `tool_progress` | `ProgressBlock`, `OperationProgress`, `NovaThinking` | as-is; named stages only |
| `execution`, `validation_result` | `AgentWorking`, `AgentChecks`, `NovaAgentStage` | as-is |
| `prepared_change`, `preview` | `ReviewBlock` over `PreparedChangeWorkspaceItem`, `DiffView`, `PreviewPanel` | adapt (`presentation: "feed"`) |
| `comparison` | none (screenshot comparison was deleted by ADR 0075; the preview is the review) | not built — deliberately |
| `metric` | `ExperimentCard` over `ProjectImpactEntry` | as-is |
| `cost_disclosure` | `CostDisclosure`, `CreditPrice`, `Wallet` | as-is |
| `error` | `OPERATION_FAILURE_MESSAGES`, `AgentStartRefusalNotice` | new copy for tool errors (§I.7) |

The registry: `BlockKind` in `nova/blocks.ts` widens, a third total record `BLOCK_FOR_ARTIFACT: Record<ArtifactKind, BlockKind>` is added beside the two that exist, `components/nova/blocks/index.ts` maps kind to component, and `status-vocabulary.ts` gets an entry per new state. `blocks.test.ts` fails until every kind is decided — the scaling property the brief asks for, already in place.

---

## H. First vertical slice — exact files

**Slice 1 — "What should I work on next?"** No write tool, no paid operation started by the agent, one new operation type, one provider method.

| Layer | File | Change |
|---|---|---|
| Provider | `src/modules/ai/provider.ts` | `generateWithTools`, `ToolCallingRequest`, `ToolCallingResult`, two failure codes; `src/modules/ai/README.md` sentence "No tools, ever" rewritten to name the exception (rule 83) |
| Adapter | `src/modules/ai/anthropic/adapter.ts` | one turn, `tools` from descriptors, `tool_use` blocks parsed, usage with cache fields; `maxRetries: 0` unchanged |
| Config | `src/modules/ai/operations.ts` | `agent_turn` on `AIOperation`; `AGENT_TURN_CONFIG` (model, effort, ceilings); `operations.test.ts` pricing assertion covers it |
| Ledger | `supabase/migrations/<ts>_agent_turn_usage_cardinality.sql`; `src/modules/ai/usage-cardinality.test.ts` | extend the `job_id` unique exemption to `agent_turn` |
| Tables | `supabase/migrations/<ts>_agent_conversations.sql`; `supabase/tests/agent-conversations.migration.ts` | the four tables (§D.1), RLS, grants, indexes; `operation_runs` type and stage CHECKs |
| Types | `src/types/database.ts` | regenerated (`pnpm db:types`) |
| Operation | `src/modules/operations/schema.ts`, `start-limits.ts`, `view.ts` (stage labels), `src/modules/operations/business-agent/{workflow,execution,server-writes,store}.ts` | `agent_turn` workflow and steps; the only `generateWithTools` call site |
| Agent module | `src/modules/business-agent/{README.md, orchestrator/loop.ts, orchestrator/budgets.ts, orchestrator/validate.ts, orchestrator/prompt.ts, tools/registry.ts, tools/context.ts, tools/health.ts, tools/opportunities.ts, tools/plan.ts, tools/focus.ts, tools/skills.ts, skills/registry.ts, skills/next-move/{skill.ts,SKILL.md}, context/brief.ts, conversation/store.ts}` + tests | registry (total), six read tools, one skill, the brief, the loop, the validator, prompt v1 |
| Extractions | `src/modules/projects/business-health-read.ts` (from `health/content.tsx`), `src/modules/action-plans/plan-with-routes.ts` (from `plan/page.tsx`) | screen-shaped assemblies become callable reads; both pages call the new function |
| Thread | `src/app/app/projects/[projectId]/nova/nova-home-data.ts`, `nova-focus-thread.tsx`, `nova-composer.tsx` (new), `nova-turn-actions.ts` (new), `nova-ui.test.ts` | messages render above the focus; the composer; the no-input guard narrowed in the open (exactly one `<textarea>`, bounded by `MAX_MESSAGE_CHARS`) |
| Blocks | `src/modules/nova/blocks.ts`, `src/components/nova/blocks/index.ts`, `src/components/system/status-vocabulary.ts` | `BLOCK_FOR_ARTIFACT` for `opportunity`, `audit`, `finding`, `recommendation`, `progress` |
| Fixtures / browser | `src/app/e2e/nova-scenarios.ts`, `e2e/nova-conversation.spec.ts` | a conversation with a founder message, a working turn, a reply with a Move artifact, a failed turn; 1440 / 375 |
| Docs | `ARCHITECTURE.md` §3.6 and §8, `CLAUDE.md` rules 41/42/43/47 rewritten in place, `PRODUCT.md` §9 sentence on what the agent may do, `UX-CONTRACT.md` flow-ledger row for "Ask Nova", `docs/ROADMAP.md` entry for what the slice did not prove | rule 83 |

**Slice 2 — "Fix this."** Adds `resolve_execution`, `estimate_execution_cost`, `offer_execution`, `offer_operation`, `get_execution_status`, `get_change_review`; the `implementation` skill; a redirect-free `startAgentRunForConversation` in `src/app/app/projects/[projectId]/agent/agent-run-actions.ts` beside the redirecting one; `execution_offer` and `operation_offer` artifacts rendered through `ActionBlock` + `CostDisclosure`; `ReviewBlock` with `presentation: "feed"`; the press recorded as a founder message with origin `control_press`. Proves chat → intent → skill → tools → context → **press** → execution → artifacts → validation, with every rule in §C.6 intact.

---

## I. Risks

1. **Security — the model as an authorization layer.** Mitigated structurally (§C.2, §C.6): no write tool exists; ids are resolved server-side; every workflow step takes `projectId` from the operation row (rule 53). Residual: a `READ_ONLY` tool that returns another project's row because a store function lacks a project predicate — `getProfileById` is one such (§B). The tool layer uses only project-scoped reads and `tools/*.test.ts` asserts each adapter passes `projectId`.
2. **Prompt injection.** Founder text, tool results and file excerpts are fenced (`coding-agent/prompt.ts` `untrusted()`), the system prompt carries integers and Vibe prose only, and the reply validator refuses banned and causal claims and unallowlisted numbers. Residual and honest: an injected instruction can waste a turn's budget on useless tool calls. Bounded by `maxToolCalls` and paid by Vibe, not the founder (§I.3).
3. **Cost.** A turn is unpriced work Vibe pays for. Ceilings: per-call input tokens, per-turn model calls and tool calls, wall clock, `START_LIMITS` (`FREE_WORK`: 20/project/hour, 120/account/day at first), the kill switch, `countInputTokens` before every call, one `ai_usage_events` row per call. `AGENT_TURN_CONFIG` on Sonnet 5 at a rebuilt transcript with prompt caching is Probable at cents per turn; the number is measured by the dogfood, not assumed, and rule 78 forbids a customer price before it is. **Open:** whether a free-with-budgets turn is acceptable in `launch-v1` — `retail.ts` must carry `free` (not `not_priced`, which cannot start) and ADR 0094 makes the composer say `Included`.
4. **Context size.** The brief bounds it (`execution-context` precedent: 6 KiB brief, max facts) and tool results are bounded per tool; the transcript is the last N messages plus this turn's tool results, never the whole conversation. Long conversations get a Vibe-composed summary message (system role, template) rather than a model-written one — deferred until a dogfood shows the need.
5. **Agent loops.** Bounded by counts in code (§C.4); a turn that reaches a ceiling ends in a template reply and a typed failure, never a retry. `maxRetries = 0` on every step.
6. **Latency and the polled UX.** A durable turn costs a Workflow start plus a hop per step; the first reply may take longer than a chat user expects. The thread shows named stages while waiting (never a spinner alone). Measure p50/p95 turn latency in the dogfood; if streaming is needed, it is a new ADR under rule 24 with the gateway's `tee()` accounting as the pattern — not a change made on the way past.
7. **Stale intelligence presented as live.** The context brief carries per-source freshness from the provenance chain; the validator refuses "live"; the prompt instructs the model to name the state. The situation block's freshness buckets are already hashed into Nova's identity for exactly this reason.
8. **Duplicate domain state.** Artifacts are references, never copies (§C.7); the thread renders canonical rows through the block registry. A message that names a Move that was since replanned renders the Move as it is now, with the message's date — the ADR 0058 rule (a stale id degrades, never substitutes) applied to artifacts.
9. **Execution safety.** Unchanged: the model has no execution tool; the press calls the existing action, which re-runs `previewAgentStep`, rebuilds the spec, holds Credits and enqueues (rules 54, 55, 57, 60, 67, 70). §J of the Nova audit holds line by line.
10. **Migration complexity.** Fourteen artifact kinds across four registries, thirty Agent-page components, a rail test suite and fifty-one browser specs. Mitigated by extending Nova's registries rather than replacing them and by leaving every B route standing until a dogfood shows the thread carries its content.
11. **The unproved surface.** Nova's thread "has never been seen with real data" (ROADMAP); the voice tier has run four times in production. Slice 1's acceptance is one real conversation on Vibe's own project with the rows in §J's dogfood table, before Slice 2 starts.
12. **Two operations with one shape.** `nova_presentation` (one string, attempted once, never retried) and `agent_turn` (many calls, a reply a founder waits for) must not share a config, a store or a policy — the never-retry rule that is right for a rephrasing is wrong for a reply. Two operations, two ledger keys, one validator.

---

## J. Implementation plan

Small, reviewable, each phase green on its own and revertible by deleting its files; a migration is additive and nullable. Order follows dependency, not the brief's numbering where the repository argues otherwise (the brief permits this).

| Phase | Deliverable | Files / modules | Tests | Unlocks |
|---|---|---|---|---|
| **0 — this record** | Audit and plan; ADR 0109 Proposed | `docs/audits/2026-09-13-…`, `docs/decisions/0109-…` | docs-currency suite | the decision |
| **1 — the seam, piloted** | `generateWithTools` in the provider and adapter; `AGENT_TURN_CONFIG`; the eval instrument forked to trajectories; a five-case pilot of Seam A vs Seam B, recorded as an ADR 0109 amendment with numbers | `ai/provider.ts`, `ai/anthropic/adapter.ts`, `ai/operations.ts`, `business-agent/eval/` | adapter tests (fake SDK), `operations.test.ts`, `pnpm agent:probe-turn` (probe, never CI) | the model can take a turn; the seam is chosen by measurement |
| **2 — tools, read-only** | Registry (total), the six read tools of Slice 1 plus `read_repository_file`, the two extractions from screens, per-tool renderers with byte caps | `business-agent/tools/`, `projects/business-health-read.ts`, `action-plans/plan-with-routes.ts` | one test per tool: project-scoped, bounded, ids resolved, sensitive paths refused | the pages call the same reads (VB-022 shape) |
| **3 — skills** | Skill registry, `next-move`, `business-audit`, `implementation` procedures; `use_skill` | `business-agent/skills/` | registry totality; procedures cite only registered tools | selection by index |
| **4 — orchestrator** | The loop, budgets, validator, prompt v1, context brief | `business-agent/orchestrator/`, `business-agent/context/` | loop against a fake provider: every ceiling, every stop reason, injection cases, validator refusals | a turn from text to a validated reply, offline |
| **5 — persistence and the durable turn** | Four tables, migration tests, `agent_turn` operation, stages, ledger exemption, audit events | `supabase/migrations/…`, `supabase/tests/…`, `operations/business-agent/`, `operations/schema.ts` | `pnpm db:test`; `table-writers`; `usage-cardinality`; workflow step tests in the `operations/*/execution.test.ts` style | turns run durably and are polled |
| **6 — the thread** | Composer, message list above the focus, guard narrowed in the open, artifact registry widened, fixtures and browser specs at 1440/375 | `nova/*`, `components/nova/blocks/`, `e2e/nova-conversation.spec.ts` | `nova-ui.test.ts` (narrowed), `blocks.test.ts`, `loading-coverage`, `route-titles`, `narrow-widths` | Slice 1 visible |
| **7 — Slice 1 dogfood** | One real conversation on Vibe's own project; latency, cost and validator refusals measured; sprint record with the rows | `docs/sprints/…` | rule 69's four questions | go/no-go for Slice 2; the price question gets its first number |
| **8 — Slice 2, execution** | `PREPARE` tools, offers as controls, redirect-free start, `ReviewBlock` in feed presentation, press recorded as a message | `business-agent/tools/execution.ts`, `agent/agent-run-actions.ts`, `nova/actions.ts` | the §J safety table of the Nova audit re-asserted over the thread; `audit-is-a-choice` extended | "Fix this" end to end |
| **9 — navigation** | Decide the rail on evidence; an ADR amending 0085's rail sentence if it changes; B-route consolidation; D deletions | `project-shell.ts`, `mobile-tab-bar.tsx`, the rail tests | `workspace-routes.test.ts`, `rail-fold.spec.ts`, `mobile-shell.spec.ts` | the agent as the entry point, without a blind redesign |
| **10 — hardening** | Streaming decision (measured), conversation summaries if needed, retention sweep entries, remaining skills, `search_repository` and `inspect_page` with their own budgets, Claude Approvals/security review of the tool layer | as named | full suite, `pnpm consistency:check`, `pnpm db:test` | breadth |

**What each phase must leave true** (rule 83): `ARCHITECTURE.md` §3.6, `src/modules/ai/README.md`, `src/modules/nova/README.md`, `PRODUCT.md` §9 and `UX-CONTRACT.md` are current-state documents and are corrected by the phase that makes them false, not after.

---

## K. What this reverses, and how it is reversed in the open

The Nova audit's founder-accepted §M and §J.4, and three tests, say the opposite of this plan on exactly three points. This record does not edit them; it names them, so the reversal is a decision rather than a drift.

| Standing position | Where | What this plan proposes | How |
|---|---|---|---|
| "Another agent loop — do not build" | Nova audit §M; `business-audit/runner.ts` ("There is no agent loop") | a bounded tool loop in a durable operation, under the triple in §C.2 | ADR 0109; rule 41 rewritten in place with a second named exception |
| "An unrestricted chat input — do not build"; "Nova is not a chat box" | Nova audit §M, §J.4; `src/components/nova/nova-ui.test.ts` ("has no text input of any kind"), `src/app/app/projects/[projectId]/nova/nova-ui.test.ts` ("has no chat input anywhere"); Sprint 0215 (`<textarea>` forbidden with no exemption) | one composer, bounded (`MAX_MESSAGE_CHARS`, one plain block, secret guard as `founder-input/normalize.ts` has), fenced wherever it reaches a model | the guard is narrowed the way Sprint 0215 narrowed it: exactly one file may hold a `<textarea>`, and a second test proves it is the composer |
| "A transcript as source of truth — do not build"; "keeps no transcript" | Nova audit §M; `nova-ui.test.ts` | a persisted conversation that is authoritative for **what was said** and for nothing else — never for project state, which stays derived from rows on every read | ADR 0109 states what the transcript is not authoritative for; the focus ranking remains the source of "what is true now" |
| "One open question is not a chat" | `execution_interrupts` partial unique index comment | unchanged: the coding agent still asks one question and stops; the conversation is the founder's, not the sandbox's | no change to `execution_interrupts` |
| Rule 43 — never persist model output beyond validated conclusions | `CLAUDE.md` | assistant messages are model output, persisted validated and bounded (the `nova_voice_messages.message` precedent); reasoning is still never requested or stored | rule 43 restated to admit a validated assistant message as a "structured conclusion" of the turn |
| Rule 47 — count before every paid call | `CLAUDE.md` | unchanged in meaning; restated so "every paid call" is read as every turn of a loop | rewrite in place |
| Rule 42 — third-party content in a fenced user message | `CLAUDE.md` | unchanged; restated to name tool results and founder turns as third-party content | rewrite in place |

Rule 83 governs the rewrite: rules are rewritten in place and never renumbered; `src/lib/consistency/claude-rule-index.test.ts` holds the index; a retired sentence in a current-state document goes into `RETIRED_CLAIMS` scoped to its file.

---

## L. Findings on the way

Defects and stale statements found by this reading, none fixed here (read-only), each named for the sprint that touches it:

1. `src/modules/nova/README.md` opens with two false sentences (§A.2). Rule 83.
2. `agent_tool_events` has had no writer since [ADR 0070](../../decisions/0070-the-sandbox-is-the-boundary.md) and no rows; it is allowlisted in `table-writers.test.ts`. §D.1 proposes reusing its reviewed shape; the alternative is retiring it.
3. `nova-feed.tsx`, `nova-message.tsx`, `nova-choice.tsx` and `buildNovaFeed` have no production importer; only their own contract test references them. §G.1 lists them under D.
4. `ROADMAP.md`'s "No surface can show an agent run in flight" was already noted stale by the Nova audit; `readAgentWorkspace` and `NovaAgentLive` show one. Still open in the register.
5. `getProfileById` in `product-understanding/store.ts` is not project-scoped, unlike its three siblings; every caller compares `projectId` itself. A tool layer must not call it.

---

## M. Uncertainties and what would settle them

- **Seam A or B** — a five-case pilot on the forked instrument (Phase 1). *Open.*
- **The turn's price** — `free` with budgets until sixteen-run-style measurement exists (rule 78's own bar); then an ADR in the 0061 shape. *Open.*
- **Retention of conversations** — §D.5 recommends retained-until-deletion; needs the founder's yes and a privacy-page sentence. *Open.*
- **Whether `rootProblem` and lens `summary` may cross to the agent** — marked internal today because they are the model's own phrasing of the diagnosis; `explain_finding` v1 returns `headline`, `explanation`, `whyItMatters` and resolved evidence only, and the question is asked when a dogfood shows the reply reads thin. *Open.*
- **Latency** — measured in Phase 7; streaming is an ADR, not a tweak. *Probable acceptable; unmeasured.*
- **The rail** — Phase 9, on evidence. *Open, by design.*
