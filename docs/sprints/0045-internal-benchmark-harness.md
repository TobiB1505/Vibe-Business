# Sprint 0045 — Internal Benchmark Harness

**Internal development capability. Not a customer feature, not a route, not a
prompt box.**

## Why

A controlled agent benchmark needs a specific *execution shape* — a small UI
change, a wide metadata change, a change citing no evidence at all. The Business
Audit and the Planner produce what a real project's evidence justifies, and
bending either to manufacture a benchmark step would corrupt the thing every
downstream measurement is taken against.

So this replaces exactly one span:

```
Audit → Opportunity → Move → Action Plan      ← replaced by a Vibe-authored fixture
──────────────────────────────────────────
Action Step → ExecutionSpec → Context →       ← untouched production code
Surface → Verification → Completion →
Prompt → Sandbox → Billing →
Candidate Verification → Prepared Change →
Independent Validation
```

## The entry point it reuses

```
previewDogfoodStep(projectId, userId, stepKey)          ← the website's Run button
  ├─ isDogfoodEligibleProject      operator allowlist, before anything is read
  ├─ getLatestCompletedActionPlan  the project's real plan (lineage)
  └─ resolveExecutableStep(step, planSteps, lineage)    ← THE SEAM
       ├─ loadOwnedRepositoryConnection    ownership, re-resolved
       ├─ getLatestSuccessfulSnapshot      the pinned commit
       ├─ reader.getHead()                 live HEAD, read now (Rule 55)
       ├─ resolveStepExecution             mode, risk, admission
       ├─ resolveExecutionValidation       the validation profile
       ├─ buildExecutionSpec               the immutable instruction package
       └─ runAgentPreflight                the §43 refusal gate
                                   ↓
persistAgentExecutionSpec  →  startAgentExecution  →  durable workflow
                                                        ├─ loadExecutionBrief
                                                        ├─ loadAgentVerificationPlan
                                                        ├─ completionBudgetFor
                                                        └─ sandbox agent → candidate → prepared change
```

`resolveExecutableStep` was extracted from `previewDogfoodStep` in this sprint.
It is the only new seam, and both callers — the website and the harness — go
through it identically.

## What the harness bypasses, and what it does not

**Bypassed:** the Business Audit, the Opportunity engine, the Move selection and
the Action Planner. A fixture supplies the six business-text fields and the three
structured fields a Planner model would have produced.

**Not bypassed:** everything else, and specifically —

| | derived by |
|---|---|
| `executionSupport`, `capability`, `requiresApproval` | `classifyStep` + the server capability registry |
| `riskClass` | `classifyExecutionRisk` from `changeKind` + evidence ids |
| execution mode, admission, absorbed preparation | `resolveStepExecution` |
| write scope, tool policy, sandbox policy | the compiled `ExecutionPolicy` |
| execution surface, context, candidates | `compileExecutionBrief` |
| verification mode, required/allowed/forbidden checks | `classifyAgentVerification` |
| completion budget | `compileCompletionBudget` |
| provider budget, gateway ceiling, billing | `resolveAgentEconomics` |
| candidate verification, Prepared Change, validation | unchanged |

There is no field on a fixture through which it could name a model, widen a
budget, add a tool, choose a verification mode, or reach a branch. It picks a
task.

## Why no fabricated Action Plan row

`execution_specs.action_plan_id` is a foreign key, so a spec cannot exist
without a plan. Rather than fabricate one — which would also have needed an
audit, an opportunity set and a product profile, and would have surfaced in the
customer's own Action Plan UI — a benchmark anchors to the project's **real**
newest completed plan for lineage, and supplies the work itself from the
fixture.

Durable execution then re-resolves the step from the fixture registry by its
namespaced key (`dogfood-fixture--<id>`), which a Planner step id can never
carry: real ids are `${order}-${changeKind}-${slug(title)}`. So no step row is
needed either, and `loadPlanStep` checks the registry *before* the database so a
benchmark can never pick up a customer's step.

## The step key is a URL path segment

The namespace separator is `--`, not `:`. The first version used a colon and the
internal dogfood page answered *"that step could not be found"* for a fixture
that resolved in every unit test: a browser sends `%3A` for a colon in a path
segment, the page received that string, and the prefix check failed against the
escape sequence.

The fix is a key that never needs escaping, rather than a `decodeURIComponent`
on the read path — one that would have to be repeated at every boundary the key
crosses and forgotten at one of them. `benchmarkStepKey` asserts
`encodeURIComponent(key) === key`, so a fixture id that would need escaping
fails the suite instead of one page render.

## Dry run

```
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS=<uuid> \
VIBE_DOGFOOD_PROJECT_ID=<uuid> \
VIBE_DOGFOOD_FIXTURE=low-ui-primary-cta \
pnpm agent:dogfood
```

Spends nothing and writes nothing — by construction, not by policy: the harness
imports no provider SDK, no execution starter and no service-role writer, and a
test asserts that import graph. A typo in a fixture name is a refusal, not a run.

A dry run resolves against the **analysed** commit rather than reading the live
default branch, because admission requires that read to be real and a developer
machine may hold no GitHub App credentials. Every such preview is stamped
`revisionVerified: false` and the report says so in full. It answers "what would
the pipeline compile?", never "may this run start?".

## Starting a paid run

Through the existing internal dogfood surface, which is already allowlist-gated,
already re-resolves ownership from the session, and already goes through the one
idempotent `startAgentExecution`. The dry run prints the URL. A second start
path would be a second thing to audit, and this needs none.

## Observability

`agent_execution_runs.execution_origin` is `planner` or `dogfood_fixture`, with
`dogfood_fixture_id` beside it, and a check constraint so the pair cannot
disagree. Derived server-side from the immutable spec's own step key — a caller
cannot mislabel a run, and a fixture cannot hide that it is one. Every other
metric is recorded exactly as for a customer execution, which is the point:
benchmark and customer runs are comparable, and filterable.
