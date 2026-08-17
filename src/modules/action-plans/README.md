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

## Cost

Planning receives less context than any other reasoning operation in the
product: one Move, the conclusion under it, the lenses that conclusion spans,
and only the evidence any of them cited — plus the product profile, which is
what stops the plan being a template. That is a design target, not an accident
(§98): if planning ever approaches the cost of an audit, the selection in
`evidence.ts` has regressed and the plan is about to become an inventory of what
the scanner did not find.

## What this module does not do

No code generation, no repository authoring, no execution, no sandbox run, no
preview, no apply, no merge, no deployment, no billing, no credits, no UI. ADR
0014 and ADR 0015 are untouched.
