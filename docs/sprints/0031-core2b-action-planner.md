# Sprint CORE-2b — Action Planner Intelligence

**Status: implemented and hardened; real-product dogfood outstanding.** Contract, reasoning,
persistence, durable execution, validation and the dogfood harness are built and green, and
the CORE-2b FIX pass below closed four architectural gaps before any real planner quality is
evaluated. The one thing not done is the thing that needs credentials and a billable call —
see *What is not done* at the bottom, which is deliberately not buried.

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
recorded. §37 requires the chain `Root Problem → Move → Plan → Steps` to hold, so the first
implementation recovered the link in `source.ts` from structured fields only.

That was the right recovery mechanism and the wrong canonical relationship, and the FIX pass
below replaces it: the engine now states the conclusion at creation time, and reconstruction
survives only for Moves written before it.

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


## CORE-2b FIX — canonical lineage and boundary hardening

A narrow architecture pass before any real planner quality is judged. Four issues, all of
them things that would have been much harder to change after a dogfood had been read.

### 1. The Move → Conclusion relationship is now stated, not reconstructed

The Opportunity Engine has always known which audit conclusion each Move addresses — it
reads the conclusions and decides what to do about them — and it discarded the answer. The
planner then rebuilt it from evidence overlap.

That is a reasonable way to *recover* a fact and a poor way to *hold* one. So the engine
records it: `business-opportunity.v2` carries `sourceConclusionKey`, the model cites it
from ids rendered beside each conclusion, and validation verifies the citation against the
audit's own key set exactly as it verifies an evidence id. A fabricated key is dropped
rather than stored — an unverified lineage is worse than a missing one, because the planner
trusts a stored key completely.

**Why a key rather than a foreign key.** A conclusion is not a row: it lives inside
`business_readiness_audits.result`, a JSONB document written once and never updated. Its
canonical address is therefore the pair `(business_audit_id, conclusion_key)`, and the audit
id is already a real FK on both tables. Normalizing conclusions into their own table would
buy a single-column FK at the cost of rewriting how the audit persists its judgment, for a
relationship that is already unambiguous — so it was not done, and
`business-audit/conclusions.ts` is the single place that would have to learn about it if
that changes. The headline is explicitly not identity: it is prose written for a customer to
read.

**One source of truth.** `business_opportunities.source_conclusion_key` is authoritative.
The planner reads it first and, when it is present, runs no reconstruction at all — pinned
by a test where the stated conclusion is the one overlap would score *lowest*, so a
regression to the old path fails loudly instead of silently disagreeing.

**No backfill.** Deliberately. Backfilling would mean re-deriving each historical Move's
source by the same reconstruction this change exists to demote — writing a guess into the
column that is supposed to hold a fact, with nothing downstream able to tell the two apart.
Legacy Moves resolve at runtime instead.

### 2. Reconstruction became conservative, and unresolved became a real answer

The legacy path used to return the highest-scoring candidate whenever any overlap existed.
That is a best guess dressed as a fact: a Move plausibly answering two conclusions would
silently get one of them, and every downstream claim about "the business problem this plan
solves" would inherit a coin flip.

Now a match must rest on **shared evidence** rather than a shared dimension — two unrelated
conclusions routinely touch the same dimension; that is what a dimension is for — and a tie
resolves to unresolved. Four distinct reasons are reported:
`audit_has_no_conclusions`, `conclusion_not_in_audit`, `no_legacy_match`,
`ambiguous_legacy_match`.

**And unresolved means no inference.** `planner_source_unresolved` is refused in
*readiness*, before an operation row exists, before token counting, and long before any
provider call.

The enforcement is a **type, not an ordering**. `PlannerSource.conclusion` is non-nullable
and `resolvePlannerSource` returns a discriminated result, so a planner source cannot be
constructed without a conclusion, `runActionPlanning` cannot be called without one, and no
code path to the provider skips it. The render's "plan from the Move alone" branch — a
generic task generator with extra steps — is gone because it is no longer expressible.

`no-spend-without-source.test.ts` runs all four unresolvable shapes through the production
sequence and asserts the fake provider records **zero** calls, including the free token
count: reaching even that would mean the gate sits in the wrong place.

### 3. Prepare is not execute, and now says so in code

The two axes were already clean, so they were not renamed — renaming would churn a
migration, a CHECK constraint and every label for no change in meaning. What was missing was
a way to *ask*:

```
actor             RESPONSIBILITY — who owns the work          model
executionSupport  PLATFORM       — what Vibe can perform      server
```

`isExecutableByVibe(step)` is now the one predicate, and it requires both the support value
and a real capability — the same pairing the database enforces. `isVibesResponsibility(step)`
answers the other question separately.

The regression test is §14's own example: *"prepare homepage positioning around the selected
segment"* and *"apply that positioning to the live homepage"* are both `actor: vibe`, and
resolve to `vibe_prepares` / `not_yet_supported` with no capability on either. The SEO
contrast stays green beside it. A copy test also asserts no non-executable label contains
"apply", "publish", "deploy" or "ship" — the label is the last place the distinction can be
lost and the first place a user would act on losing it.

### 4. The context-size test stopped being a permanent constraint

There was one assertion: the planner pack is strictly smaller than the audit's. The intent
was right and the shape was wrong. "Smaller than an audit, forever, for every Move" is not a
property of a correct planner — a Move spanning four lenses with heavy evidence could
legitimately need more context than a thin audit of a small product, and the test would have
made that a failure. A test that fires on correct behaviour eventually gets satisfied by
making the behaviour worse.

It is replaced by the architectural property: uncited evidence is excluded, unrelated lenses'
evidence is excluded, the audit's broad reasoning is not resent, and the request stays inside
the configured input budget. The smaller-than-audit comparison survives as a clearly labelled
**fixture** expectation. Cost observability is untouched — context size, tokens, latency and
provider cost are all still recorded and printed by the dogfood report, which is where the
economic answer actually comes from.

### Staleness

Unchanged, and checked rather than expanded. Conclusions live inside the audit document, so
"the source conclusion is no longer current" cannot happen independently of
`audit_superseded`; a Move re-linked to a different conclusion is `move_superseded`. What
changed is that the conclusion key is now part of the plan's input identity, so re-linking
correctly produces a different plan rather than reusing the old one.

### Version bumps this forced

`business-opportunity.v2`, `business-opportunity-set.v2`, `opportunity-engine-v2`,
`opportunity-prompt-v2`. The set schema version feeds the reuse identity, so **existing
opportunity sets are no longer reusable** — correctly, since a v1 set cannot answer the
question a v2 set can. Nothing regenerates automatically; the next Moves run is the user's
action, and until then the planner reads existing Moves through the legacy path.

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
| unit tests | green — 3357 before CORE-2b, 3530 after the FIX pass (+173) |
| build | green |
| E2E | unchanged — this sprint ships no UI, so no browser assertion changed |
| migrations | **deployed and read back** — see below |

## Migration deployment

Both migrations are applied to the live project (`Vibe-Business`,
`dcbwlctscooefwnivxzv` — the only project on the account, and not `Planner-Agent`).
History was inspected before writing, per Rule 30: the remote was at
`20260817090000_project_onboarding` with exactly the 33 migrations that existed locally,
so neither of the new ones had been partially applied.

| Migration | Status |
|---|---|
| `20260817120000_action_plans.sql` | applied |
| `20260817140000_move_conclusion_lineage.sql` | applied |

**One thing had to be reconciled, and it is worth recording.** The CLI workflow was not
usable — this session has no Supabase credentials in its shell — so the migrations were
applied through the Supabase management API, which stamps each one with a *wall-clock*
version rather than the filename's. They landed as `20260817112506` and `20260817112531`.
That is precisely the drift Rule 30 warns about and Rule 34 forbids: the migration files
are the source of truth and the remote converges to them, not the other way round. The two
ledger rows were updated to the filename versions, which preserves ordering
(`090000 < 120000 < 140000`) and leaves local and remote history identical — 35 files, 35
entries, matching versions.

Verified by reading the database back rather than by trusting the apply:

- `action_plans` and `action_plan_steps` exist, RLS enabled, 4 and 3 policies respectively
  — three on steps because there is deliberately no update policy.
- `action_plan_steps_capability_matches_support`, `action_plans_completed_has_conclusion`
  and `action_plans_completed_has_lineage` are all present and read as written.
- `operation_runs_operation_type_check` permits `action_planning`.
- `business_opportunities` has its `source_conclusion_key` column: **29 existing Moves,
  0 with lineage.** Exactly as designed — nothing was backfilled, and those 29 are the
  population the conservative legacy path exists for.
- Security advisors report four warnings, all pre-existing and none from these migrations
  (`set_updated_at` search_path, `rls_auto_enable` being callable, leaked-password
  protection off).

## What is not done

**The real dogfood has not been run.** §92–§98 require planning Vibe Business's own current
top Move and reviewing the result by hand, which needs an Anthropic key and a billable
inference call against the user's account. The harness is built and is one command:

```
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
ANTHROPIC_API_KEY=sk-ant-… VIBE_DOGFOOD_PROJECT_ID=<uuid> \
pnpm ai:dogfood-action-plan
```

It reads the project's real current audit and Moves, plans **whichever Move actually ranks
first** — nothing is seeded to manufacture an easy executable result (§75) — writes
nothing, and prints the report with measured tokens, latency and provider cost.

One thing to expect from it: every existing Move predates `business-opportunity.v2`, so the
first dogfood will resolve its source conclusion through the **legacy** path, and the
report will say `via legacy_reconciled`. If the top Move is one the conservative rule
cannot resolve unambiguously, the harness refuses before spending — which is the gate
working, not a failure. Regenerating Moves (a paid run, and the user's action) is what
produces direct lineage.

Until the dogfood runs, these remain open: the five dogfood questions (§92–§96), the
measured cost comparison against the audit (§97–§98), and
`ACTION_PLANNING_CONFIG.timeoutMs`, which is the only budget in `ai/operations.ts` set from
a comparable operation rather than from measurement and is marked provisional in its own
comment.

## Next

1. Dogfood the real top Move.
2. Re-set the planning timeout from measured duration.
3. CORE-2b UI — the Action Planner experience, once the intelligence has been read and judged.
4. Then bounded Execution / Prepare / Preview, which is where `vibe_executes_now` stops being
   a label and starts being a button.
