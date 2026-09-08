# 0098 - The founder is the outside witness

Status: Accepted
Date: 2026-09-08

Defines the authority [ADR 0055](0055-founder-action-attestation-evidence.md) deferred: *"`external_party` completion remains deferred until its evidence authority is explicitly defined."* Moves no risk boundary and grants the founder nothing over Agent work — see [ADR 0090](0090-a-founder-closes-what-vibe-cannot-run.md) for the exclusion that stays exactly as it was.

## Context

`external_party` is a real actor the planner assigns, and the rubric describes it plainly: waiting on someone or something outside the business. "Wait for Google to index the new pages." "Wait for the domain transfer to complete." Nothing inside Vibe produces such a step, and ADR 0055 left its completion open on purpose, because no authority had been named.

What that produced on screen was observed, not reasoned about. Rendering the state showed a plan that said:

```
05  Wait for Google to index the new pages     Start here
...
NEEDS FROM YOU
Nothing right now
```

**Start here**, over a step that rendered no control at all — no button, no field, no sentence — and two lines below, in the same panel, the claim that nothing was needed. A founder told to start something, given nothing to start it with, and told in the same breath that there was nothing to do.

Worse than the contradiction: the step is unblocked, so it becomes the plan's entry point, and any step that depends on it waits behind it permanently. A plan containing one could never reach `finished`, so the completed-plan summary and its handover to the next Move — the thing that closes the loop — were unreachable for that plan forever.

This was the last step shape in the plan with no way to close it. Every other one has an authority: a founder decision resolves, an agent run completes, a `vibe` step with no executor is attested with a finding, a refused product change becomes a handoff ([ADR 0097](0097-the-refusal-becomes-a-handoff.md)), a founder action is confirmed.

## Decision

**The founder's own observation is the external-party authority.**

An `external_party` step paired with `external_dependency` support is admitted to founder attestation, on the same terms and through the same `security definer` function as a `founder_action` step.

The reasoning is short, and it is about who can see. Vibe has no integration that watches Google's index, a registrar's transfer queue, or an app store's review. Building one would be a different product, and inferring it would be a guess presented as a fact. The person waiting is the only witness there is, and the plan already asks them to wait.

Three things this deliberately does **not** change:

**It grants nothing the Agent wanted.** No execution path has ever produced an `external_party` step — it is a distinct actor precisely because nothing inside Vibe acts on it. So admitting it cannot confirm away work Vibe would build, which is the property [ADR 0090](0090-a-founder-closes-what-vibe-cannot-run.md) exists to hold and which `vibe` + `product_change` still holds unchanged.

**It is not "your action".** The copy says *"Waiting on someone else"* and *"Nobody inside your business does this one, and Vibe cannot watch for it"*. Telling a founder this is their task would be asking them for work they cannot perform; what they can do is say when it has happened.

**It does not claim Vibe verified anything.** The attestation records what a person observed, against one immutable plan step, exactly as every other founder attestation does.

## A second, smaller decision in the same place

Whether closing a step records a written result now keys on the **change kind**, not on the actor.

The old rule said `vibe` steps write a finding and everybody else must not. That was right for setup work — "the sitemap is submitted" is true or it is not, and there is nothing to write down — and wrong for a measurement, whose result *is* its output. A measurement closed with a bare tick threw away the one thing the next planning run most needed, whoever was waiting for it.

So: a finding is required for every `vibe` step and for every `measurement`, and refused otherwise. One key, enforced in the database and read by the screen from the same rule, so the two cannot disagree — the failure this codebase has paid for repeatedly is a button the server then refuses.

## Consequences

- A plan containing an outside dependency can reach `finished`, which makes the completed-plan summary and its handover to the next Move reachable for it.
- The contradiction is gone: **Start here** now leads to a control, and the panel's "nothing right now" is consistent with it, because nothing is *demanded* — only observed.
- An `external_party` measurement is asked for its result like any other measurement, rather than offering a button the database refuses.
- Still absent, and still honest: nothing verifies the observation. A founder who confirms an indexing that has not happened has told Vibe something untrue, and the plan proceeds on their word — the same standing every founder attestation has had since ADR 0055, and the same one a revocation policy would have to address for all of them at once.
