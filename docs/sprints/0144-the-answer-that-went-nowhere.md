# 0144 — The answer that went nowhere

**Date:** 2026-09-04
**Decision:** [ADR 0092](../decisions/0092-the-step-records-what-it-found.md)

## The founder's objection

The confirmation from Sprint 0141 worked. The founder used it, answered the decision behind it, and the plan advanced — all four facts read back from production. Then they said what was still wrong:

> „Man kann zwar bestätigen, dass es drin ist, aber wenn du das durchliest, siehst du ja, dass wir eigentlich wissen wollen, ob es eingebaut ist oder nicht."

The step asks whether billing is *fully working, partially wired, or effectively absent*. Its successor is literally **"Build or complete the checkout and subscription flow"** — which of those two it becomes depends entirely on the answer. And the answer had nowhere to go.

## What was wrong, precisely

ADR 0090 closes a step with a boolean. For real-world work that is right: the sitemap is submitted or it is not, and there is nothing to write down. For Vibe's own research the boolean records that the work happened and discards what it produced — so the plan went on being planned against the guess it started with.

## The design decision inside it

The obvious feature is three radio buttons, parsed out of the step's own criterion. **It is refused.** That sentence is model output, and turning model wording into a machine API is the mistake this codebase names in `profile.ts`, `resolver.ts`, `classify.ts` and `completion.ts`. My own first description of this work said "three options from the completion criterion", and that was wrong for the same reason — corrected before any code was written.

So the criterion is *displayed*, in its own element, and the founder answers it in their own words.

## What was built

**The finding is stored**, and the `security definer` function enforces the pairing both ways: a `vibe` step must carry one, a `founder_action` step must not. The second half is not tidiness — accepting a finding on real-world work would invent a second, weaker meaning for the same column.

**The finding is read.** This is the half that makes it worth anything, and its absence is exactly the "writes data into nothing" this project criticised in its own agent in Sprint 0139. So:

- `renderActionPlanInput` gains a `<founder_findings>` block: fenced, labelled UNTRUSTED DATA, explicitly not instructions. It is a person's prose, treated as prose from a person rather than as a measurement.
- `computeActionPlanInputHash` takes the finding **ids**. Ids rather than the words: a reuse key built from someone's wording would move on a typo and say nothing about what the plan was given. A new finding is a genuinely different planning problem, so it cannot reuse the plan written without it.
- `ACTION_PLANNER_PROMPT_VERSION` → v3, because what the model was given changed.

Bounded at forty findings per project, twelve in the prompt, 1200 characters each — all three cap something that grows with use and ends in a paid call.

## Verification

Each rule proved by removing it:

- deleting the pairing checks from the function fails *"refuses to close a Vibe step without one"* and *"refuses a finding on real-world work"*;
- dropping the findings from the plan identity fails two identity tests, including the one that says a second finding is a second planning problem;
- dropping the block from the rendered request fails *"carries the founder's findings, fenced as untrusted"*.

The renderer test also asserts the absence of the block when there are no findings — a first plan must read byte-for-byte as it did, or every existing plan's identity would move for an empty section.

Browser: the field is present and required on a Vibe step, absent on real-world work, and there are **no radios and no select** — the assertion that Vibe invented no choices.

Domain 8,589 · SQL 401 · browser 518 · lint 0/0 · build green.

## What this does not do

**It does not regenerate the plan.** The founder's other proposal — plan one step, replan, plan the next — stays open. This is what makes it answerable: a replan today would run on the same guesses as the first plan, and now it will not.

**It does not backfill.** One attestation was recorded under the boolean rule and carries no finding. It is not rewritten: an attestation is historical evidence, and a stored row is never reinterpreted under rules it was not written against (rule 65). The finding it should have carried is genuinely lost, and the plan it belongs to has already moved past that step.
