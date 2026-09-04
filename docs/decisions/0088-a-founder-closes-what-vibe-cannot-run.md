# 0088 - A founder closes the step Vibe has no executor for

Status: Accepted
Date: 2026-09-04

Supersedes nothing. Widens the attestation authority [ADR 0055](0055-founder-action-attestation-evidence.md) established, and changes no execution authority: nothing here lets Vibe run, prepare, approve or merge anything it could not run, prepare, approve or merge before.

## Context

`resolveStepExecution` refuses every step whose actor is `vibe` and whose change kind is not `product_change`. That refusal is correct and stays: `research` gathers information from people or the market, `decision` is a choice, and neither is a change to a repository that Vibe could build and independently validate.

What was wrong is that the refusal had no way out.

The product has exactly three completion authorities, and none of them covers such a step:

| Authority | Admits | Covers a `vibe` step with no executor? |
|---|---|---|
| Founder resolution | `founder_decision`, `founder_input` | no — wrong actor |
| Agent execution evidence | a verified run ending at a passed validation | no — no run can produce it |
| Founder attestation (ADR 0055) | `founder_action` + `founder_acts` | no — wrong actor |

So the step could be completed by nothing at all. `firstActionableStep` returned it on every read, forever, and every step that depended on it was unreachable with it. That is not a refusal a founder can act on; it is a plan that cannot be worked.

Absorption looks like the missing authority and is not. `dependencies.ts` folds an `analysis` prerequisite into a downstream agent run, but `listAgentStepCompletionEvidence` reads the run's *chain*, never its absorbed preparation — so an absorbed step is routed past rather than finished, and it deadlocks the plan screen exactly as the others do.

This was not hypothetical. On 2026-09-04 a plan for this repository's own billing work opened with `vibe` + `research`, and its four remaining steps — including two `product_change` steps the agent was eligible to build — became permanently unreachable behind it. Across every plan ever stored, five steps have this shape.

## Decision

**A founder may confirm a step whose actor is `vibe` and whose change kind is not `product_change`.**

One predicate, `isFounderAttestable`, stated once and enforced at all four layers that had encoded the narrow rule separately: the completion projection, the server action, the render condition, and — the authority — the `security definer` database function.

The discriminator is `changeKind`, never `executionSupport`. `not_yet_supported` is also what a `product_change` step carries whenever the deterministic capability registry misses it, which is nearly all of them, and which is precisely the work the agent exists to do. Keying on the stored support value would have handed a founder a control that closes the change Vibe was about to build. Keying on the change kind mirrors the resolver's own rule, so the admitted set is exactly the set with no executor.

An attestation still claims what it always claimed: that the step's own immutable completion criterion is true. It does **not** claim Vibe did the work, and the copy says so in as many words.

## Consequences

**Easier.** A plan whose next step is Vibe's own reasoning work can be worked. The founder's stuck plan advances: confirming step 01 makes the open founder decision on step 02 reachable, and answering that makes step 03 resolve `agentic` — the first Agent run this project has been able to offer.

**Harder, deliberately.** The set is closed and keyed on a field the Planner cannot use to sneak a product change through: a model that wanted the agent's work confirmed away would have to emit `product_change`, which is refused here and admitted by the resolver instead.

**Unchanged.** Every execution, approval and merge authority. `human_approved` still binds to an immutable artifact identity, a merge still re-reads live state, and a validation still means what `SANDBOX_POLICY_VERSION` says it means. This decision moves one thing: who may say a non-executable step is done.

**Forecloses nothing, and leaves one question open.** Whether a run that *absorbs* an `analysis` prerequisite should also complete it is a separate decision with a separate authority — it would be Vibe's own evidence rather than a founder's word, and it needs the absorbed keys to reach `listAgentStepCompletionEvidence`, which today they do not. Recorded as open rather than answered here.
