# Sprint CORE-2b — Action Planner Intelligence

**Status: implemented; real-product dogfood outstanding.** Contract, reasoning, persistence,
durable execution, validation and the dogfood harness are built and green. The one thing not
done is the thing that needs credentials and a billable call — see *What is not done* at the
bottom, which is deliberately not buried.

Branch: `claude/core-2b-action-planner-m5xkwm`, from `352662d` (merge of PR #41 —
CORE-2a.4 Interactive Audit and the audit/onboarding work on top of it).

> The sprint brief asked for `feat/core-2b-action-planner`. This session is pinned to
> `claude/core-2b-action-planner-m5xkwm` by its execution environment and may not push
> elsewhere without explicit permission, so the work is on that branch instead. The base
> commit is the one the brief asked for.

## Problem

The Business Audit answers *what does this business need, and what matters first?* The Next
Move answers *which intervention do I recommend?* Between that and any execution there was
nothing. A founder reading "narrow your first customer" has been told what is wrong and given
an imperative, which is not the same as knowing what happens next.

The gap this sprint closes is one layer wide and it is easy to fill badly. A planner that
re-decides what matters is a second audit with less evidence. A planner that emits tasks is a
checklist. A planner that says what Vibe can build is a product making promises it cannot
keep.

## The base, traced before writing anything

The brief asks not to assume the old architecture, so the current dataflow was read out of the
code first.

```
repository + live site + Deep Scan + Product Profile + Founder Intent
        ↓  buildEvidencePackV3                     deterministic, no model
   evidence pack v3 — flat "id | source | fact" lines
        ↓  ONE Anthropic call                      business_readiness_audit
   BusinessReadinessAudit — 9 lenses, conclusions (each with an internal
   rootProblem), 5 scored dimensions
        ↓  ONE Anthropic call                      opportunity_generation
   OpportunitySet — ≤5 ranked Moves, each with executionType/executionReadiness
        ↓  deterministic                           execution/capabilities.ts
   resolveExecutionCapability → nextjs_seo_foundations_v2, or unsupported
```

Two facts from that trace shaped the whole sprint:

**There is no stored link from a Move to the conclusion it answers.** The Opportunity Engine
reads the audit and returns a ranked list; which conclusion each entry addresses is never
recorded. §37 requires the chain `Root Problem → Move → Plan → Steps` to hold, so the link is
recovered in `source.ts` from **structured fields only** — shared evidence ids weighted above
shared dimensions — and a miss returns `null` rather than a guess. Attaching the first blocker
to a Move that does not address it would be the fidelity claim quietly becoming false.

**Execution capability is already server-owned, and already refuses to read model prose.**
`execution/capabilities.ts` opens by explaining why `title.includes("SEO")` is the worst
available implementation. CORE-2b applies the same rule one layer earlier rather than
inventing a second mechanism: the two now share the evidence-id constants, and a test asserts
they resolve identically from identical facts.

## What was built

### The contract

`business-action-plan.v1` under `action-planner-contract-v1`. One plan, one Move (§6): a goal,
why now, an expected outcome, how that outcome moves the root problem, assumptions, and 2–9
ordered steps. Each step carries a title, description, purpose, actor, change kind, completion
criteria, explicit prerequisites and evidence ids.

Every plan records the audit, the opportunity set, the Move, the root problem, the lenses, the
Product Profile id and the founder intent hash it reasoned from.

### The architectural point of the sprint

**A model may describe a business action. Only the server may say whether Vibe can execute
it.**

```
model  →  actor          vibe | founder_decision | founder_action | external_party
          changeKind     decision | analysis | product_change | external_setup |
                         measurement | research

server →  executionSupport   vibe_executes_now | vibe_prepares | founder_decides |
                             founder_acts | external_dependency | not_yet_supported
          capability         a real registry entry, or null
          requiresApproval   derived from the consequence, not from who acts
```

The guarantee is **structural, not instructional**. There is no wire field for a capability, an
execution flag or a safety level; every object is `additionalProperties: false`; and the
normalizer copies named fields rather than spreading the response. A model emitting
`capability: "stripe_checkout_v9"` emits a field nothing reads — which is asserted at three
levels in `rule-57.test.ts`, including against a deliberately contaminated response.

`vibe_executes_now` is reachable through exactly one code path: a match in
`capability-registry.ts`. That registry has **one** entry, `nextjs_seo_foundations_v2`, which
is the honest state of the product.

`vibe_prepares` is the value that earns its place. §24 asks Vibe to do its own work before
asking the founder for theirs — derive the segments, compare them, prepare the recommendation,
*then* ask. Those steps are genuinely Vibe's responsibility and calling them founder work would
be wrong; they are also not a button, and calling them executable would be the dishonesty §94
exists to catch. Six values rather than a boolean is what lets both of those be said.

### Priority is not execution suitability

The rule §83 calls critical, and the one a product optimising for demos gets wrong. The Move a
plan is built for is **rank 1** — never "whichever Move Vibe could most easily execute". The
test asserts exactly the tempting case: a top Move that needs a founder decision, and a
second-ranked SEO Move with a real capability behind it. The planner plans the first.

### Validation

Repairs where the intent is unambiguous, rejections where it is not, and a closed set of
finding codes so "did validation notice this plan was a consulting checklist?" is answerable
without matching on English.

The two judgment validators are structural rather than lexical:

- **`checklist_shaped_plan`** — a completion criterion is empty when, after removing filler,
  it contains no word its own title did not already contain. "Improve positioning → positioning
  is improved" is caught without the validator knowing the word "improve".
- **`no_changed_state`** — a plan made entirely of analysis decides nothing and changes
  nothing, so the business ends where it started, better described. That is a research memo.

Plus: unverifiable evidence ids dropped (Rule 45), duplicates keyed on the *claimed finished
state* rather than the title (so "define / choose / finalize audience" collapses), dangling and
circular prerequisites repaired, and a strategic decision assigned to Vibe reassigned to the
founder — the single most consequential repair in the file, because getting ownership wrong in
that direction is Vibe taking a decision that is not ours.

### Context and cost

Planning receives the smallest context of the three reasoning operations: one Move, the
conclusion under it, the lenses that conclusion spans, and only the evidence any of them cited
— plus the Product Profile, always, because that is what stops the plan being a template.

Not sent: the five scored dimensions, the other conclusions, the key findings, the limitations,
and every evidence line no part of the source judgment cited. §98 makes that a design target,
and a test asserts the planner pack is strictly smaller than the audit's. If planning ever
approaches the cost of an audit, the selection has regressed and the plan is about to become
an inventory of what the scanner did not find (§36).

### Durable execution and persistence

`action_planning` is the twelfth operation type and the fourth consumer of one execution
foundation — same four-step shape, same store, same executor boundary, same retry convention.
The paid step is `maxRetries = 0`; `inference_started_at` is written before the call so an
ambiguous re-entry fails rather than buying a second plan.

Two tables. Plans are immutable: replanning creates a new plan and marks the previous
`superseded`, keeping its steps, its provenance and its cost record. The in-flight unique index
turns a double submission into a constraint violation rather than a second paid call, and the
fake database models it so the idempotency test proves the guarantee Postgres provides rather
than the application's own pre-check.

One CHECK constraint is worth naming: `action_plan_steps_capability_matches_support` makes
"executable implies a real capability" true at the database as well as in the classifier, so a
bug in `classify.ts` fails loudly instead of persisting a step that claims Vibe can act with
nothing behind it.

### Staleness

Five observed reasons — superseded audit, superseded Moves, changed Product Profile, changed
founder intent, superseded planner contract — as a pure function of five facts. Nothing becomes
stale because time passed. Nothing is deleted, and nothing triggers a paid refresh: a stale
plan stays visible and stays stale until the user decides (Rule 60, §43).

### Onboarding

A read model, not a redesign. `getOnboardingFirstMove` exposes the plan, the first actionable
step and the progress state; the state machine is untouched. `onboarding.test.ts` guards the
direction that matters: `OnboardingFacts` carries no plan field, the completion action mentions
no plan, and a plan that opens with a founder decision, an external dependency, or something
Vibe cannot automate still leaves onboarding completable. Activation is not the First Win, and
this sprint is not what regresses it.

### The first actionable step

Not `steps[0]`. Not done, and nothing unfinished in front of it. A founder decision is allowed
to win — the bar is "nothing blocks it", not "Vibe can do it". The test that matters asserts
the inverse: a downstream product change is never offered while the decision it depends on is
open, even when it is the only step Vibe could technically act on.

## Boundaries this sprint did not cross

- **Rule 57** — intact, and now enforced by a schema walk rather than by wording.
- **ADR 0014** — no AI-authored repository code. The planner may say "update the homepage
  positioning"; it does not generate the patch.
- **ADR 0015** — nothing runs in a sandbox. Sandbox validation remains future execution
  infrastructure.
- **No customer UI**, no `/moves` redesign, no credits, no paywall, no execution, no preview,
  no apply, no merge. The audit's reasoning, the lens framework and the founder-question engine
  are untouched.

## Validation

| | |
|---|---|
| lint | green (4 pre-existing warnings, unrelated) |
| typecheck | green |
| unit tests | green — 3357 before, 3485 after (+128 in this module) |
| build | green |
| E2E | unchanged — this sprint ships no UI, so no browser assertion changed |
| migration | **not deployed** — see below |

## What is not done

Two things, both requiring credentials this session does not have, and both being reported
rather than quietly dropped.

**The migration is not deployed.** `20260817120000_action_plans.sql` is written and its
constraints are pinned by tests against the migration source, but it has not been applied to
the remote database. Per Rule 30 the next step is `pnpm db:status` before `pnpm db:push` —
never assume table absence, never blindly rerun.

**The real dogfood has not been run.** §92–§98 require planning Vibe Business's own current top
Move and reviewing the result by hand, which needs a Supabase service key, an Anthropic key and
a billable inference call against the user's account. The harness is built and is one command:

```
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
ANTHROPIC_API_KEY=sk-ant-… VIBE_DOGFOOD_PROJECT_ID=<uuid> \
pnpm ai:dogfood-action-plan
```

It reads the project's real current audit and Moves, plans **whichever Move actually ranks
first** — nothing is seeded to manufacture an easy executable result (§75) — writes nothing,
and prints the report with measured tokens, latency and provider cost.

Until it runs, these remain open: the five dogfood questions (§92–§96), the measured cost
comparison against the audit (§97–§98), and `ACTION_PLANNING_CONFIG.timeoutMs`, which is the
only budget in `ai/operations.ts` set from a comparable operation rather than from measurement
and is marked as provisional in its own comment.

## Next

1. Deploy the migration and dogfood the real top Move.
2. Re-set the planning timeout from measured duration.
3. CORE-2b UI — the Action Planner experience, once the intelligence has been read and judged.
4. Then bounded Execution / Prepare / Preview, which is where `vibe_executes_now` stops being
   a label and starts being a button.
