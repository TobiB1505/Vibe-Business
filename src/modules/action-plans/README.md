# Action Plans

> The Audit says *"this is the business problem."*
> The Next Move says *"this is the intervention I recommend."*
> The Action Plan says *"this is exactly how we get from here to there."*
> Execution will later say *"this is what Vibe can safely do for you."*

This module is the third layer. It does not do the other three's jobs.

## The boundary

| Layer | Question | Owns |
|---|---|---|
| Business Audit | What matters, and when? | `business-audit/` |
| Next Move / Opportunity | Which intervention? | `opportunities/` |
| **Action Plan** | **How do we carry it through?** | **this module** |
| Execution | What can Vibe safely do? | `execution/`, `validation/`, `merge/` |

The planner **consumes** the audit's judgment. It never re-decides which lens is
weakest, which problem ranks first, or whether Legal should outrank Revenue —
that work already happened, on more evidence, and re-doing it here would make
the ranked list decorative. It plans **one** Move at a time (§6), which is what
keeps a plan bounded, measurable and later executable.

## Canonical planner lineage

```
Business Audit → Business Conclusion → Next Move → Action Plan → Plan Steps
```

Every link is **stated**, not inferred.

- **New Moves** (`business-opportunity.v2` and later) persist
  `sourceConclusionKey` at creation time — the Opportunity Engine already reasoned from a
  conclusion, so it records which one. A conclusion is addressed by the pair
  `(business_audit_id, conclusion_key)`, because a conclusion lives inside the audit's
  immutable JSONB document rather than in its own table; see
  `business-audit/conclusions.ts`. **This field is the authoritative relationship.**
- **Legacy Moves** (pre-v2, no key) fall back to bounded reconciliation in `source.ts`,
  which is a compatibility path and nothing more. It runs *only* when no key is present,
  and it is willing to fail: a match must rest on shared evidence rather than a shared
  lens, and a tie resolves to unresolved. "Highest score wins" is explicitly not the
  rule — a ranking is a decision only when the gap means something.
- **Unresolved** is a real outcome. Planning is refused with
  `planner_source_unresolved`, and refused in *readiness* — before an operation row
  exists, before token counting, and a long way before any provider call.

That refusal is enforced by a type, not by ordering: `PlannerSource.conclusion` is
non-nullable and `resolvePlannerSource` returns a discriminated result, so a planner
source cannot be constructed without a conclusion, and `runActionPlanning` cannot be
called without one. There is no code path to the provider that skips it.

A successful plan stores the exact `source_conclusion_key` it used and whether that came
from `direct` or `legacy_reconciled` lineage, which makes the whole chain queryable.

## Vibe prepares vs Vibe executes

Two axes, and neither collapses into the other:

| | Means | Decided by |
|---|---|---|
| `actor` | **Responsibility** — who conceptually owns this work | model |
| `executionSupport` | **Platform** — what Vibe can actually perform today | server |

`vibe_prepares` says *this is Vibe's work, not yours*. It says **nothing** about an
executor existing, and it must never be rendered as a button. "Prepare a positioning
direction for the chosen segment" is truthful with no repository executor anywhere;
"apply that positioning to the production website" is the same responsibility and needs
one that does not exist, which is `not_yet_supported`.

Only server capability reconciliation establishes `vibe_executes_now`. Ask
`isExecutableByVibe(step)` — it requires both the support value *and* a real capability,
and the database enforces the same pairing.

## Founder-owned information and completion

`founder_decision` and `founder_input` steps carry a validated dynamic
`FounderInputRequirement`. The planner may propose the question, recommendation
and alternatives from its bounded evidence; the application owns response
validation and every state transition. The content is deliberately not backed
by a pricing or business-question catalogue.

The durable project truth lives in `src/modules/founder-input/`, not in the plan
JSON. One active resolution for `(project, kind, subjectKey)` is authoritative
completion evidence for every matching founder-owned step. A downstream step is
unblocked only when that evidence exists. Agent work, founder actions and
external dependencies do not inherit this authority and remain incomplete
until their own evidence integrations exist.

## The one architectural rule

**A model may describe a business action. Only the server may say whether Vibe
can execute it.**

```
model  →  actor          who has to act
          changeKind     what kind of changed state this produces

server →  executionSupport   whether Vibe can act on it today
          capability         which real executor, if any
          requiresApproval   whether a human would have to say yes first
```

Everything on the server side is computed in `classify.ts` from
`capability-registry.ts`. None of it is representable as model output: there is
no wire field for a capability, an execution flag or a safety level, and
`wire-schema.ts` copies named fields rather than spreading a response. So a
model emitting `capability: "stripe_checkout_v9"` is emitting a field nothing
reads — which is a structural guarantee, not a prompt instruction.

The registry has **one** entry today (`nextjs_seo_foundations_v2`), and that is
the honest state of the product. A step proposing a landing-page rewrite,
pricing implementation, Stripe, authentication or a database change resolves to
`not_yet_supported`: it stays in the plan, and it is not called executable.

## Rule 57

There is no field, at any depth, for a repository path, a git ref, a branch, a
commit message, or code. `rule-57.test.ts` walks the JSON Schema and fails on
any property name that looks like one, and asserts that a contaminated response
loses those values in normalization. Adding such a field is meant to be hard.

## Files

| File | What it owns |
|---|---|
| `schema.ts` | The versioned contract: plan, step, actor, change kind, execution support, lifecycle |
| `source.ts` | Binding a Move to the audit conclusion under it, from structured fields only |
| `evidence.ts` | The focused evidence selection — profile always, plus what the source judgment cited |
| `prompt.ts` / `rubric.ts` | What we ask for, and what "a good plan" means. Authored entirely by us |
| `render.ts` | The fenced, untrusted-labelled user message |
| `wire-schema.ts` | The transport shape and the normalizer. Where Rule 57 is structural |
| `validate.ts` | Whether a *billed* response is usable. Repairs, rejections, findings |
| `capability-registry.ts` | The server-owned registry. The only source of an `ExecutionCapability` |
| `classify.ts` | Execution support, derived. Never model output |
| `sequence.ts` | Dependencies, cycles, and the first step that could genuinely happen |
| `runner.ts` | Count → one paid call → normalize → validate → classify |
| `store.ts` | Persistence, input identity, supersession |
| `service.ts` | Readiness, staleness, read models, the onboarding First Move view |
| `report.ts` | The developer-readable dogfood report |
| `dogfood.probe.ts` | The real-product harness. Dev-only, writes nothing |

Durable execution lives in `src/modules/operations/action-plans/`.
Founder request/resolution state lives in `src/modules/founder-input/`; its
service-role response transition lives in `src/modules/operations/founder-input/`.

## Context policy

The planner receives one Move, the conclusion under it, the lenses that conclusion
spans, and only the evidence any of them cited — plus the product profile, always,
because that is what stops the plan being a template. Everything else the audit read is
excluded: the other lens assessments, the other conclusions, the limitations, and every
evidence line no part of the source judgment pointed at.

The property is **focused and source-relevant**, not *universally smaller than every
audit payload forever*. A Move spanning four lenses with heavy evidence behind each could
legitimately need more context than a thin audit of a small product, and a test asserting
otherwise would turn correct behaviour into a failure — and eventually get satisfied by
making the behaviour worse. So the suite asserts exclusion (uncited evidence, unrelated
lenses, the audit's broad reasoning) and the configured input budget, and keeps the
smaller-than-audit comparison as a clearly-labelled fixture expectation.

The economic answer comes from measurement, not from an invariant. Context size, token
usage, latency and provider cost are all recorded, and the dogfood report prints them.

## What this module does not do

No code generation, no repository authoring, no sandbox run, no preview, no
apply, no merge, no deployment, no billing, and no credits. The Action Plan UI
may collect a founder response, but execution still crosses the existing
resolver, preflight, approval and operation boundaries. ADR 0014 and ADR 0015
are untouched.
