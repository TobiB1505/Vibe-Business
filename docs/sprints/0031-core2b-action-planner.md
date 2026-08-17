# Sprint CORE-2b — Action Planner Intelligence

**Status: complete.** Built, hardened by the CORE-2b FIX pass, migrations deployed and read
back, and dogfooded on a real product — one plan, $0.0471, clean validation, and the canonical
lineage working on its first real use. What is left is not CORE-2b: the planner still has no
trigger in the product, which belongs to the UI sprint.

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
| dogfood | **done** — one real plan, $0.0471, clean validation |

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

## Dogfood — the first real Action Plan

Run 2026-08-17 against **Jandia-Arena**, a resort's internal staff vacation planner. Not
Vibe Business itself: its own chain is frozen (see *Residuals*), and CORE-2a.4 set the
precedent that a real unrelated project is a legitimate dogfood — that run found two
defects no test could have.

Nothing was seeded (§75). The Move planned is whichever ranked first, and it happened to
be `needs_user_input` rather than the executable SEO one — so §83 was tested rather than
demonstrated.

```
Audit 51fb3840 → blocker-1 → Move rank 1 → Action Plan
                              via lineage: direct
```

**The lineage worked on its first real use.** The Move carried
`source_conclusion_key = blocker-1`, written by `opportunity-engine-v2` an hour earlier,
so the planner read it and the legacy reconstruction never ran.

### The five questions

| | |
|---|---|
| §92 — written for *this* business? | Yes. "resort staff and managers", "the calendar, the requests", "FastAPI backend", "manager-provisioned shared login". No sentence transfers to another product. |
| §93 — could Vibe have prepared more? | No. Step 1 derives two-to-three access models with trade-offs; step 2 asks the founder to choose between them. |
| §94 — execution honesty | No step claimed `vibe_executes_now`. Both `product_change` steps: `not_yet_supported`, capability `none`, **and** `approval: required` — the pair a boolean could not express (§50). |
| §95 — first actionable step | Step 1, `vibe_prepares`. Unblocked, and Vibe's own work. |
| §96 — coherence | Root problem was "nobody can find a way in". After all five steps: login exists, dashboard behind it, homepage links to it, path verified. Materially resolved. |

`Findings: none`, `Notes: none` — no repair was needed on the first run.

### Cost

| | Planner | Audit |
|---|---|---|
| Input tokens | 8,190 (of 20,000 allowed) | far larger |
| Output / reasoning | 3,069 / 1,401 (of 10,000) | ~5,800 / 8–11k |
| Latency | **39.5s** | ~100–120s |
| Provider cost | **$0.0471** | ~$0.1950 |

**About a quarter of an audit**, which settles §98: the focused context selection in
`evidence.ts` is doing what it was built for. `ACTION_PLANNING_CONFIG.timeoutMs` is no
longer provisional — it is now held up by a measurement of this operation, and stays at
120s for the headroom reason recorded in its comment.

## Residuals

**Vibe Business itself cannot be dogfooded.** Its audit is stale, its free entitlement is
spent, its stored contract is already current so no `system_contract_refresh` is owed, and
credits do not exist — so the audit cannot re-run, and the Moves are gated on audit
currency. This is CORE-2a.1's recorded residual reaching its conclusion: the entitlement
covers *Vibe* changing, never the *customer's evidence* changing. The first project to hit
it is our own. Not fixed here — it needs a financing path (credits, or an admin grant),
which is its own scope and its own decision.

The other two residuals from the dogfood were verified and closed below.

## CORE-2b MINI VERIFICATION — the two residuals, traced to ground

A narrow pass, run before freezing CORE-2b, to answer one question per residual: is this
presentation, or is it a persisted-contract problem? Nothing else in CORE-2b was touched —
no UI, no audit logic, no re-run of the paid dogfood.

### 1. `whyNow` — **PERSISTED CONTRACT ISSUE**, fixed

Traced the field through every step between the provider response and a future UI read:

```
provider response → wire-schema (unbounded) → validate.ts: text(v, MAX_CRITERIA=400)
  → ValidatedPlan.whyNow (already cut) → runner.ts: ActionPlan.whyNow (unchanged)
  → store.ts: why_now column (plain text, no further bound) → read back unchanged
  → dogfood report: prints plan.whyNow verbatim
```

The cut happens exactly once, in `validate.ts`, at the moment the billed response becomes
domain data — before persistence, not on display. `whyNow`, `expectedOutcome` and
`addressesRootProblem` shared `MAX_CRITERIA` (400) with per-step `purpose` and
`completionCriteria` only because all five calls happened to pass the same second argument
to the same helper — never a deliberate choice that these plan-level narrative fields
should be as compact as a one-line completion criterion. `store.ts`'s `why_now` column is
plain `text`, so there is no second, database-level truncation to find.

**Fix:** a new `MAX_NARRATIVE = 600` for the three plan-level fields, matching the
Opportunity Engine's own `whyNow` field (`opportunities/validate.ts`'s `MAX_TEXT_LENGTH`) —
consistency with an existing sibling contract for the same kind of content, not a number
picked to fit one observed string. Step-level `purpose`/`completionCriteria` are untouched
at 400; they are deliberately compact per §20 and nothing evidenced a problem there. The
safety-net truncation still exists (Rule 27 — no field is unbounded) but now only for
genuinely pathological output, and when it fires it is no longer silent: a new
`narrative_field_truncated` finding and a note name the field and its length, the same way
every other repair in this file already announces itself.

`ACTION_PLANNER_VERSION` moved `v1 → v2`. This is a genuine behaviour change — the same
billed response can now produce a materially different stored `whyNow` than it would have
under v1 — so it belongs in the "planning behaviour changed materially" version, which
feeds the reuse key: replanning a Move today no longer reuses a v1 plan that may have lost
text. Not a `contractVersion` bump: a v1 plan with a truncated `whyNow` is degraded, not an
unacceptable answer to "how would Vibe approach this Move?" — the bar that version guards.

Regression coverage: a realistic two-sentence `whyNow` (480 chars — over the old ceiling,
under the new one) survives `validate.ts` byte-for-byte and survives a full
create-run → complete → read-back cycle through the store unmodified; a deliberately
pathological string still gets capped and now also produces the note and finding; the
per-step ceiling is pinned unchanged by a test that shows the same length still gets cut
there, on purpose.

### 2. `changeKind: measurement` — **SEMANTICS BROADENED**, documented; no new enum value

Mapped every place `changeKind` drives behaviour: `capability-registry.ts` (only
`product_change` capabilities exist, so `measurement` can never spuriously match one),
`classify.ts`'s `requiresApproval` (only `product_change`/`external_setup` need it —
`measurement` doesn't, correctly, whichever reading applies), `classify.ts`'s
`vibe`-actor branch (`analysis`/`measurement` → `vibe_prepares`, reached only when
`actor: vibe`), and `validate.ts`'s `no_changed_state` check (`measurement` counts as
"changes something," alongside `decision`/`product_change`/`external_setup`).

The real step — *"sign in as staff and confirm the path from homepage to dashboard works
end to end"* — has `actor: founder_action`, and `classifyStep` never reads `changeKind` at
all for `founder_action`/`founder_decision`/`external_party` steps beyond the approval
check. So the classification produced exactly the right routing (`founder_acts`, no
capability, no approval) regardless of whether "measurement" meant "define a signal" or
"confirm one." **Nothing routed incorrectly** — the only thing wrong was the sentence
describing the type, which said "a signal is *defined*" while a model had already, and
correctly, reached for the same value to mean "confirmed."

A distinct `verification` kind was considered and rejected against the checklist's own
bar: adding one needs a *system* reason — a materially different actor, capability match,
routing, approval, or executor consequence — and none exists. `actor` already carries who
confirms it; a fourth-ish `changeKind` for the same fact would be linguistic neatness, not
new behaviour.

**Fix:** broadened the documented meaning in `schema.ts`'s `STEP_CHANGE_KINDS` comment and
in `wire-schema.ts`'s model-facing description — "the outcome becomes observable: a signal
is defined, an existing one is read, or someone confirms a just-built thing behaves as
intended" — while keeping the one boundary that is load-bearing exactly where it was:
wiring analytics into the product, or writing an automated check, is `product_change`,
never `measurement`, under any reading. No version bump: the model's actual behaviour is
unchanged (it already made this choice correctly under the old, narrower text), so no
stored plan's meaning changed and nothing needs to stop being reused.

Regression coverage: a `founder_action` + `measurement` step (the real shape) routes to
`founder_acts` with no capability and no approval; a `vibe` + `measurement` step citing the
SEO capability's own evidence ids still never resolves to `vibe_executes_now` — pinning
that the broadened wording cannot be read as license for a capability to match on it.

## What is not done

Nothing in CORE-2b remains unvalidated. What remains is scope that was never in it: the
Action Planner has **no trigger in the product**. The durable path, the store, the
readiness gate and the workflow all exist and are exercised, but the only way to start a
plan today is `pnpm ai:dogfood-action-plan` from a shell. A Server Action and a button are
the whole gap, and they belong to the UI sprint.

## Next

1. Give the planner a trigger in the product — a Server Action and a button.
3. CORE-2b UI — the Action Planner experience, once the intelligence has been read and judged.
4. Then bounded Execution / Prepare / Preview, which is where `vibe_executes_now` stops being
   a label and starts being a button.
