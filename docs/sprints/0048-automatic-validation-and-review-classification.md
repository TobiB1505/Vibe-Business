# Sprint 0048 — Automatic Validation & Review Classification Foundation

Extends existing agent-execution flows. No new preview UX, no new review
experience, no new customer UI. The goal is the technical foundation a later
review flow can stand on.

## PART A — the existing flow, read before anything was changed

### 1. Where a successful agent run ends

`agentExecutionWorkflow` (`operations/agent-execution/workflow.ts`) is a step
graph:

```
provision ─▶ start agent ─▶ (sleep ─▶ poll)* ─▶ collect ─▶ extract ─▶ write branch
                                                                          │
                                                      cleanup ─▶ finish ──┘
```

`finish` calls `finishAgentExecutionStep`, which on success:

- `completeAgentRun` — sets the run's `prepared_change_id`
- `settleOperationCredits` — settles the reservation the run held
- `completeOperationRun` — `resultId = preparedChangeId`
- records `agent_execution.completed`
- records the lifecycle event **`execution_completed` / "Ready for review"**

That last line is where the pipeline currently stops. Nothing downstream is
triggered.

### 2. Where the Prepared Change is created

`writeAgentBranchStep` (`writeBranch` in the graph), which calls
`prepareChangeOnBranch`. It writes an isolated branch and inserts the
`prepared_changes` row. `extractAndVerifyStep` has already run
`verifyCandidateChange` before this point, so the row only exists for a change
that passed policy verification.

### 3. How validation is started today

Exactly one way: a user clicks. `validateChangeAction`
(`app/app/projects/[projectId]/validate-change-action.ts`) →
`startChangeValidation(supabase, new VercelWorkflowExecutor(), {...})`.

`startChangeValidation` is the single entry point and carries every guard:

| Guard | Behaviour |
|---|---|
| project ownership | `projects` scoped by `user_id`; otherwise `project_not_found` |
| prepared change state | must be `prepared` with a `commitSha` |
| repository snapshot | must exist, else `validation_not_supported` |
| validation profile | `resolveValidationProfile`; unsupported profiles refuse |
| depth | `resolveDepthForPreparedChange` (Sprint 0047) |
| identity reuse | `findReusableValidationRun` → `reused` |
| in-flight | `findActiveOperationByIdentity` → `running` |
| double submit | unique index; loser returns the winner's operation |

**Every one of these is preserved by this sprint, because the automatic trigger
calls this same function rather than reproducing any part of it.**

### 4. What data already exists after a run

Persisted and Vibe-owned, all of it usable for classification without a new
column:

- `prepared_changes.files` — the path list **Vibe itself verified** as changed
- `agent_execution_runs.context_surface_scopes`, `context_surface_pages`
- `execution_specs.spec` — `riskClass`, and the trusted step's `evidenceIds`
- `ExecutionSurfaceRequirement` (`execution-context/surface.ts`, Sprint 0044) —
  evidence-derived scopes: `public_pages`, `authenticated_pages`, `named_surface`
- `resolveExecutionSurface` — the analyzer's own route table, each route
  carrying the **repository file that serves it** (`sourcePath`)

### 5. The review system that already exists

This was the most important thing to find before writing anything called
"review".

`src/modules/review/` is a complete visual-review domain: Browserbase captures,
`review_artifacts`, a stabilization stylesheet, a signed-URL store, a policy
version. It has exactly **one** profile:

```
REVIEW_PROFILES = ["public_visual_review_v1"]
```

A screenshot comparison, before against after. There is no code-review concept
anywhere in the codebase.

So a `ReviewClassification` is not a second review system. It answers a question
the existing one cannot ask about itself: *is a visual comparison the right
review for this change at all?* A backend-only change photographed before and
after produces two identical pictures of a page that did not change — a
confident, useless result.

Its service file also carries an explicit house rule:

> Nothing here is automatic. A browser session costs money by the second. There
> is no code path that captures on preview-ready, on page load, on panel open,
> or on validation passing — only an explicit `startChangeReview`.

That rule is about **browser sessions**, and this sprint does not touch it. No
review is auto-started. See the cost note under PART B.

### 6. Reusable seams identified

| Need | Existing seam | New code? |
|---|---|---|
| start validation | `startChangeValidation` | none — called as-is |
| enqueue durable work | `VercelWorkflowExecutor` | none |
| changed paths | `prepared_changes.files` | none |
| route → source file | `resolveExecutionSurface` | none |
| evidence → scope | `deriveExecutionSurfaceRequirement` | none |
| dogfood display | `status-view.tsx` completion Notice | extended, not replaced |

## PART B — the automatic validation trigger

One new step at the end of the existing graph:

```
… write branch ─▶ cleanup ─▶ finish ─▶ enqueue validation
```

`enqueueValidationStep` calls `startChangeValidation` with the service client and
the `projectId`/`userId` **read from the persisted agent run row**, never from
input (Rule 53).

### Why this is safe to retry, structurally

It is not made idempotent by new code. `startChangeValidation` already returns
`reused` for an identity that passed and `running` for one in flight, so a second
call cannot produce a second sandbox. The existing guards are the idempotency.

### The three failure questions PART B asks

**Validation failure.** Irrelevant to the agent run, which has already been
recorded as succeeded and its credits settled. The validation run records its own
`failed` status exactly as a manual one does. The prepared change stays
`prepared`, and the user can still click "Validate again".

**A refused change.** There is no path to reach the trigger: `enqueueValidation`
runs only on `{ kind: "succeeded" }`, which requires `writeBranch` to have
returned a `preparedChangeId`, which requires `verifyCandidateChange` to have
passed. A refused candidate never produces a prepared change to validate.

**Missing credits.** Validation consumes **no credits**. It has no reservation
and no settlement; it writes `sandbox_usage_events`, which is Vibe's own
infrastructure metering. The agent run's credits were reserved and settled before
this step is reached.

### The cost note, stated plainly

Auto-validation does not spend the customer's credits, but it does spend Vibe's
sandbox money — roughly five minutes of microVM per agent run, now without a
click. That is a deliberate trade: validating the result of an execution the user
already started and paid for is part of delivering it, not a new spending
decision. It is recorded here because it is the one thing about this sprint that
is a judgement rather than a mechanism, and because
`sandbox_usage_events` is where it will show up.

## PART C — deterministic review classification

`src/modules/review/classification.ts`. No AI, no agent output, no commit
message. Three inputs, all Vibe-owned:

- the changed paths Vibe verified
- the analyzer's resolved execution surface (route → source file)
- the evidence-derived `ExecutionSurfaceRequirement`

A path is **visual** when the analyzer's own route table says a route is served
from it, or when it is a file whose contents can only reach rendered output. It
is **code** otherwise. The classification is the combination:

| visual paths | code paths | result |
|---|---|---|
| yes | no | `visual` |
| no | yes | `code` |
| yes | yes | `visual_and_code` |
| none at all | none at all | `code` |

`code` is the fallback, deliberately. A code diff can be reviewed for any change;
a visual comparison of a page that did not change cannot.

### Not persisted, and why

Every input is already stored, the output authorizes nothing, and it has no reuse
semantics — unlike `validation_depth`, which gates what actually ran and must
never be reinterpreted later. Recomputing on read keeps one source of truth. **No
migration.**

## PART D — dogfood display

The existing completion `Notice` in `status-view.tsx` gains a recommended-review
line. No new component, no new card, no customer-facing surface.

## Not in this sprint

Vercel preview deployments · screenshot engine · a new preview card · AI
summaries · the review UX · customer UI · auto-starting a review.
