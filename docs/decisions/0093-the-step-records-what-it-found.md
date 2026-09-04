# 0093 - The step records what it found

Status: Accepted
Date: 2026-09-04

Extends [ADR 0090](0090-a-founder-closes-what-vibe-cannot-run.md), which opened the founder attestation to steps no run can finish and closed them with a boolean. Changes no execution, approval or merge authority.

## Context

ADR 0090 let a founder close a Vibe step Vibe has no executor for. It closes it with a tick, and for the case that authority was built from — real-world work — that is right: the sitemap is submitted or it is not, and there is nothing to write down.

For Vibe's own research it is not. The founder's own plan opened with:

> Determine whether billing is fully built, partially wired, or effectively absent.
>
> **Done when:** the functional state of the `/app/billing` route and its Stripe wiring is documented as one of: fully working, partially wired, or not implemented.

Three answers. The step's successors are written to depend on which — step 03 is literally *"Build **or complete** the checkout and subscription flow"* — and a boolean carries none of them. So the founder answered the question, the plan recorded that the work happened, and the answer went nowhere. Every later step went on being planned against the guess the plan started with.

The founder named it precisely: *"Man kann zwar bestätigen, dass es drin ist, aber wenn du das durchliest, siehst du ja, dass wir eigentlich wissen wollen, ob es eingebaut ist oder nicht."*

## Decision

**A step whose output is a finding is closed with the finding.**

`action_plan_founder_attestations` gains a `finding` column, and the `security definer` function enforces the pairing both ways: a `vibe` step **must** carry one, a `founder_action` step **must not**. That is not a nicety — accepting a finding on real-world work would invent a second, weaker meaning for the same column, and accepting a tick on a Vibe step is the defect this repairs.

**Vibe does not derive choices from the criterion.** The obvious feature is three radio buttons parsed out of *"fully working, partially wired, or not implemented"*. It is refused: that sentence is model output, and turning model wording into a machine API is the mistake this codebase names in `profile.ts`, `resolver.ts`, `classify.ts` and `completion.ts`. The criterion is displayed, in its own element, and the founder answers it in their own words.

**And the answer is read.** A finding that nothing consumes would be exactly the "writes data into nothing" this project criticised in its own agent three sprints ago. So:

- `renderActionPlanInput` gains a `<founder_findings>` block — fenced, labelled UNTRUSTED DATA, explicitly not instructions, like every other third-party input (rule 42). It is the founder's prose, so it is treated as prose from a person, not as fact from a measurement.
- `computeActionPlanInputHash` takes the **ids** of the findings a plan was written against. Ids rather than the prose: a reuse key built from someone's wording would move on a typo and say nothing about what the plan was given. A new finding is a genuinely different planning problem and must not reuse the plan written without it.
- `ACTION_PLANNER_PROMPT_VERSION` → v3, because what the model was given changed.

## Consequences

**Easier.** The next plan is written knowing what the last one had to guess. That is the whole of it, and it is the difference between a plan that adapts and five steps fixed before anything was known.

**Bounded.** Forty findings per project at the store, twelve in the prompt, 1200 characters each. All three are caps on something that grows with how long somebody has used the product and ends up in a paid call.

**Unchanged.** What an attestation claims. It still says the step's own completion criterion is true and still does not claim Vibe did the work — it now also says *what* was found.

**Not decided here.** Whether the plan should be **regenerated** after each step rather than written five deep at the start. The founder proposed it and it remains the open question; this makes it answerable with data rather than with the same guesses, which is why it comes first.

**A row exists that predates this.** One attestation was recorded under ADR 0090's boolean rule and carries no finding. It is not backfilled and not rewritten: an attestation is historical evidence, and a stored row is never reinterpreted under rules it was not written against (rule 65).
