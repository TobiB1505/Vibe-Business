# 0143 — The promise a refusal could not keep

**Date:** 2026-09-04
**Decision:** none. Two defects in shipped code, one of them mine from Sprint 0141.

## What the founder saw

The chain from Sprint 0141 worked in production — step 01 attested, step 02's decision answered, both confirmed in the database. The plan advanced to step 03, and the Agent workspace then said:

> **EARLIER STEP COMES FIRST**
> Step 03 · Build or complete the checkout and subscription flow — Vibe never changes anything to do with taking payments.
> *Vibe's part of this Move becomes available once that step is done.*

Every part of that is wrong. Step 03 is not earlier — it is the next step. It is not somebody else's prerequisite — it **is** Vibe's part of the Move. And it will never become available: it is refused by policy because it touches payments.

The founder's screenshot also showed the notice rendered as a **blurred ellipse** with its own footnote cut in half.

## The two defects

**A refusal with no end was rendered as one that had one.** `AgentPlanNextNotice` shipped with a single pair of sentences for every refusal it could show. That was fine for the case it was built from — a prerequisite somebody clears — and false for the case a founder actually reached. Promising an end to a refusal that has none is worse than saying nothing, because the founder waits for it.

**A notice was passed through the control treatment.** `AgentStartCta` wraps its child in `rounded-full` under `overflow-hidden` and runs a highlight sweep across it, then captions it with a lock line about what Vibe checks *"before starting"*. A rectangular notice inside that is clipped to an ellipse. Its own docblock had already forbidden this:

> the sweep and the lock line never wrap something that cannot actually start

Three notices had been passed through it anyway — the stale-read notice since Stufe 6, the workspace question since Stufe 4, and this one since yesterday. **Nobody saw it because none of those states had occurred in production**; this was the first.

## What was built

`REFUSAL_SHAPES` in `execution-contract/view.ts` — an exhaustive `Record` over every resolution reason, answering the only question a screen needs: does this refusal end, and how. `policy` is the one with no end, and it gets copy that says so and a link that offers a different Move rather than a way through. An exhaustive record rather than a list, so a new reason is a compiler error instead of a sentence quietly inheriting the wrong promise.

`AgentReadyStage` gains a `notice` slot beside `startAction`. All three notices move to it, which also removes the "before starting" lock line from screens where nothing starts.

## Verification

Both defects proved by re-introducing them:

- restoring the single-outlook copy for a policy refusal fails *"promises no end to a refusal that has none"*, which asserts the absence of all three phrases the old version shipped;
- passing the notice back through `startAction` fails *"brings no start treatment with it onto the stage"*, which asserts no `agent-start` block, no "before starting", and no clipping ancestor.

The second needed a scene rendering the **real** `AgentReadyStage`, because the three notice scenes render the component alone and cannot see what wraps it — which is exactly why the defect shipped.

Domain 8,584 · browser 517 · lint 0/0 · build green. No migration, no version bump.

## What this does not do

**It does not address the deeper thing the founder named.** Step 01 asked whether billing is *fully working, partially wired, or not implemented*, and the only affordance is a binary confirmation — so the answer that steps 02 to 05 were written to depend on is never captured. The founder proposed replanning after each step instead of a five-step plan fixed at the start. That is an architecture question about planning cadence, plan identity and cost, not a defect, and it is recorded here rather than answered.
