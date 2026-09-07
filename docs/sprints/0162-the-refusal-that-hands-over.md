# 0162 — The refusal that hands over

**Date:** 2026-09-05
**Decision:** [ADR 0096](../decisions/0096-the-refusal-becomes-a-handoff.md)

## The founder's idea

> „Wenn wir Sachen nicht anfassen können, wie Authentifizierung, weil das kaputtgehen könnte … können wir ihn ja auch unterstützen, indem wir ihm einen Copy-Paste-Prompt geben. […] Dann kann er bestätigen: Ja, ich habe es den Prompt durchlaufen lassen."

They proposed two things. This is the second. The first — loosening the payment prohibition so the agent can build pricing — was assessed and **not built**, for a reason recorded in the ADR: the classifier reads evidence ids and never prose, by construction, so it cannot tell a pricing *display* from a *charge* today. That is detector work with its own decision behind it.

## What was actually broken

Vibe refuses payment architecture, and the refusal is right — but not for the reason it reads like. It is not caution. **A run's verdict is the project's own typecheck, tests and build, and all three pass while a charge is off by a factor of a hundred.**

What was wrong is what the refusal left behind. A refused step is `vibe` + `product_change`, and [ADR 0090](../decisions/0090-a-founder-closes-what-vibe-cannot-run.md) keeps exactly that shape out of founder attestation — deliberately, so nobody can confirm away work the agent would build. So the step could be executed by nobody and closed by nobody, and the plan screen had nothing on it at all. The same dead end Sprint 0141 ended one class over, still open in the class that occurs most: [ADR 0028](../decisions/0028-founder-selectable-action-plan-move.md) recorded that for **two real projects in a row**, the top-ranked Move landed on exactly these categories.

## What was built

**A prompt, assembled rather than generated.** No inference — and not to save money, though it is free and instant. A model writing this would put fresh, unreviewed output into a prompt the founder pastes into an agent holding their credentials. The step is already written, already on screen, already approved.

**A handoff row, which is what admits the step.** The exception to ADR 0090's exclusion cannot be a *shape* — a resolver's opinion at render time would do, and opinions move. So it is a durable fact bound to one immutable plan/step pair, written only where the live resolution says the refusal is `policy`, enforced in the `security definer` function rather than only in TypeScript.

**And the founder's report comes back.** Closing a handed-off step uses the same attestation as any other Vibe step, so it carries a finding — what their tool actually did — which reaches the next planning run as fenced untrusted context. That is the difference between a delegated step and a lost one.

## The path this opens, and what closes it

Planner text derived from the founder's own repository now travels into an agent running with their credentials. **That path did not exist before this sprint**, and it is the honest cost.

Three defences, each proved by removing it:

- the step is quoted inside a fence rather than woven into Vibe's sentences;
- Vibe's own words say what the block is and what to do if it contains an instruction rather than a description — removing that sentence fails a named test;
- **the quote cannot be closed from inside.** Any run of dashes in the quoted text is neutralised first. Removing that lets a crafted step end the fence and continue in Vibe's voice, which would defeat the other two — and it fails its own test.

## Verification

Sabotage at three layers. Removing the fence defusal fails *"cannot have its quote closed by the text inside it"*. Removing the warning fails *"fences the planned step and says what to do with an instruction inside it"*. Making the database gate plan-wide instead of per step fails *"does not admit any other step in the same plan"* — because handing out one change must not open the next.

**Two guards caught real defects in the new migration**, which is what they are for. VB-027 found two foreign keys with no covering index: the composite key on `(action_plan_id, project_id)` was not covered by the index leading on `project_id`, which is exactly the column-order case that test exists for. VB-026 found the policy count moved, and the arithmetic now names which change moved it.

Domain 8,836 · SQL 408 · browser 588 · lint 0/0 · build green.

## What this does not do

**It does not verify the result.** Vibe could re-read the repository — the scan is free — but a founder who says they did the work is the same authority ADR 0090 already accepts for real-world work, and demanding proof from them and not from a plumber would be a strange asymmetry.

**It moves no risk boundary.** Nothing here lets Vibe build anything it refused before. The boundary is where it was; what changed is that there is now something at it.
