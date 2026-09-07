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

## Two defects the founder found within the hour

**The screen offered what the server refused.** The plan drew the handoff, they clicked, and the action answered *"this step is no longer the one waiting on you"*. Not a crash — the Vercel logs for that deployment show only 200s and 204s — but my own error copy, from a gate I had copied out of the attestation action: the plan was stale, because its product profile had moved since it was written.

The gate was wrong in both places. `planStaleness` says the diagnosis moved, not that the step is wrong, and `PlanDetailPanel` keeps showing a stale plan on purpose. Removing it loosens nothing: `getLatestActionPlan` returns the latest *completed* plan, so a replan already fails the identity check beside it. It stays in `founder-input-action`, where answering a question from a superseded diagnosis writes a durable business statement later plans read.

**And the feature was invisible where it mattered.** The founder was standing on the Agent workspace — the screen a founder actually lands on at the moment of refusal — and it said *"Choose a different Move"*. The control still belongs on the Action Plan beside the step's completion criterion; the pointer belongs here, and now exists.

**Both were mine, and both were missed by tests that looked right.** The browser suite asserted the tool buttons were *visible* and never clicked one; the Agent notice had a scene for the refusal and none for the refusal-with-a-way-out.

## Three more the founder found by using it

**The step rendered twice.** The confirmation passed into the handoff card was the whole `FounderActionCard` — its own bordered panel, its own status pill, its own copy of the title and description. So one step drew two cards under each other, one saying *"Vibe won't build this one"* and the other *"Vibe can't run this one"*, and the second one's sentence — *"this isn't a change to your product"* — was **false**: it is a change; Vibe declined it. The card now owns the framing and `AttestationForm` owns the question and the answer, and a third prompt reading exists for a handed-off step.

**Recording the finding was impossible.** `isFounderAttestable` was widened and the database function was widened, and `founder-action-attestation.ts` was not — it still called the predicate with no handoff set, so a `product_change` came back false and the founder who had just been handed a prompt and done the work could not record it. The screen offered it and the server refused it, for the second time in an hour, with the same error copy and a different cause.

**And the copy control was the wrong weight.** A full-width secondary button beside the heading, the same visual weight as "Record this finding" — competing with the action that advances the plan for something that only moves text onto a clipboard. It is now the classic control: an icon-and-label button on the block it copies.

## Closing the loop, and the seam that was still open

The founder's ask was the end of the flow: run the prompt, come back, tick it off, carry on. The tick already existed — the attestation *is* it — but the loop was open one layer down.

**`routingCompletedSteps` did not know handoffs existed.** So the plan screen would advance the moment the finding landed, and the routing set — which decides whether the *next* step may start — would still count the handed-off step as unfinished. Step 4 blocked on step 3 forever, while the plan showed step 3 as done. One product, two answers. `getOnboardingFirstMove` had the same omission.

**Merged is deliberately not the bar for a handed-off step.** It is the bar for a step *Vibe* built, because a successor is prepared against the default branch and Vibe's own change must have reached it. Vibe made no change here — the founder's tool did, in their repository — so there is no prepared change to merge and no evidence to wait for. Their word is the authority, exactly as it is for the real-world work a `founder_action` attestation already carries into the same set. The safety net is unchanged and downstream: every run re-reads HEAD and refuses if it moved.

**And the sabotage did not fail the first time.** Removing the wiring left every unit test green, because the tests covered the pure function and the bug was in the *call*. That is the third time in one afternoon: the plan offered a confirmation the server refused, the founder recorded a finding the plan would not count, and the plan advanced while the Agent stayed blocked. Each time the function was right and the call was not.

So `completion-call-sites.test.ts` now asserts the calls rather than the functions — crude on purpose, because what has to hold is one argument in each of three places, and the alternative is a seeded plan and a session per call site.

## The summary the founder should never have had to write

The loop worked and the founder named what was wrong with it: after watching their own tool do the work, the product asked them to summarise it. That is homework for something a machine had already written down.

**So the prompt asks for it.** It is Vibe's prompt, so Vibe can ask for the shape it wants back — a short `VIBE SUMMARY` block, printed last, with one line the founder would never have thought to write themselves: **Left undone.** What a tool skipped, guessed at or could not do is exactly what the next plan needs and exactly what a satisfied founder forgets to mention. The field then asks for a paste rather than an essay, and the button says what the click does: *Done — next step*.

Free text either way. A founder who would rather type two sentences is not blocked, and a tool that ignored the request has not trapped them.

**And the prompt now carries what they already worked out.** Step 1 established that the billing route exists but is only partially wired; the handoff for step 3 was sending their tool to rediscover it. That finding is already in the plan view — it comes off the attestation evidence the screen reads anyway — so it costs no query. It travels in its own delimited block, labelled as notes rather than instructions, defused the same way the step is, and outside the block that says what to build: a note that answers a step is context for it, not the work.

## Verification

Sabotage at three layers. Removing the fence defusal fails *"cannot have its quote closed by the text inside it"*. Removing the warning fails *"fences the planned step and says what to do with an instruction inside it"*. Making the database gate plan-wide instead of per step fails *"does not admit any other step in the same plan"* — because handing out one change must not open the next.

**Two guards caught real defects in the new migration**, which is what they are for. VB-027 found two foreign keys with no covering index: the composite key on `(action_plan_id, project_id)` was not covered by the index leading on `project_id`, which is exactly the column-order case that test exists for. VB-026 found the policy count moved, and the arithmetic now names which change moved it.

Domain 8,836 · SQL 408 · browser 588 · lint 0/0 · build green.

## What this does not do

**It does not verify the result.** Vibe could re-read the repository — the scan is free — but a founder who says they did the work is the same authority ADR 0090 already accepts for real-world work, and demanding proof from them and not from a plumber would be a strange asymmetry.

**It moves no risk boundary.** Nothing here lets Vibe build anything it refused before. The boundary is where it was; what changed is that there is now something at it.
