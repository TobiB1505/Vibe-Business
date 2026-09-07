# 0096 - The refusal becomes a handoff

Status: Accepted
Date: 2026-09-05

Extends [ADR 0090](0090-a-founder-closes-what-vibe-cannot-run.md), which opened founder attestation to steps no run can finish and deliberately kept `vibe` + `product_change` out of it. Does not touch [ADR 0026](0026-agentic-execution-contract.md)'s risk policy: nothing here lets Vibe build anything it refused before.

## Context

Vibe refuses payment architecture outright, and authentication rewrites are outside the V1 agentic boundary. Both refusals are right, and the reason is not caution — it is that **Vibe's validation cannot see the failure it would need to catch.** A run's verdict is the project's own typecheck, tests and build. All three pass while a charge is off by a factor of a hundred. A green tick on a wrong amount is worse than no automation at all.

The problem is what the refusal leaves behind. A refused step is `vibe` + `product_change`, and ADR 0090 keeps exactly that shape out of founder attestation — deliberately, so nobody can confirm away work the agent would build. So the step could be executed by nobody and closed by nobody, and the plan stopped there permanently, with the same shape of dead end [ADR 0090](0090-a-founder-closes-what-vibe-cannot-run.md) was written to end one class over.

This is not a rare corner. [ADR 0028](0028-founder-selectable-action-plan-move.md) already recorded that for **two real projects in a row**, the top-ranked Move landed on exactly the categories the risk policy refuses — payments for one, authentication for the other. The refusal is the normal case, not the exception.

And the founder is a vibe coder. They already have a coding agent, running with their credentials, on their own machine, allowed to do what Vibe is not. What they do not have is Vibe's answer to *what* to build and *why*.

## Decision

**Work Vibe refuses by policy becomes a prompt the founder runs in their own tool.**

Three parts, and the middle one is what makes it safe.

**1 · The prompt is assembled, never generated.** No inference. Not to save money, though it is free and instant: a model writing this would put fresh, unreviewed output into a prompt the founder pastes into an agent holding their credentials. The plan step is already written, already on their screen, and already the thing they approved. A second model restating it would add a failure mode and no information.

**2 · A handoff is a durable row, and it is what admits the step.** `isFounderAttestable` still excludes `vibe` + `product_change` in general. The exception cannot be a *shape* — a resolver's opinion at render time would do, and opinions move — so it is a fact: a row in `action_plan_handoffs`, bound to one immutable plan/step pair, written only where the live resolution says Vibe refuses by **policy**. A repairable refusal has a fix and a sequencing one has an order; handing either out would send a founder to build something Vibe was about to be able to do.

The gate is enforced in the `security definer` function, not only in TypeScript, because that is the only writer that always sees it.

**3 · The founder's report is the finding.** Closing a handed-off step uses the same attestation as any other Vibe step, so it carries a finding ([ADR 0093](0093-the-step-records-what-it-found.md)) — *what their tool actually did*. That reaches the next planning run as fenced, untrusted context, which is the difference between a delegated step and a lost one.

## The injection path, named

A step's text comes from the Planner, which reasons over evidence derived from the founder's own repository and website — both untrusted (rules 25 and 36). That text now travels into an agent running with their credentials on their machine. **That path did not exist before this decision**, and it is the real cost of it.

Three things bound it, and all three are asserted rather than intended:

- The step is **quoted inside a fence**, never woven into Vibe's sentences, so the receiving agent can see where Vibe stops speaking.
- Vibe's own words tell it what the block is and what to do if it contains an instruction rather than a description.
- **The quote cannot be closed from inside.** Any run of dashes in the quoted text is neutralised before it becomes a fence — otherwise the quoted text could end the quote and continue in Vibe's voice, which would defeat the other two.

Nothing else is included. No repository file contents, no evidence ids, no website text. The step alone carries the intent, and every additional source is another path from somebody else's writing into the founder's agent.

## Consequences

**Easier.** The plan can move through work Vibe will not do. For the plan this was found on, that is the difference between a five-step plan that could never finish and one that can.

**Honest.** Vibe validated nothing here, and neither the screen nor the completion record claims otherwise. A handoff means the prompt was issued; the attestation means a person says what happened.

**Unchanged.** Every risk class, every execution authority, and what Vibe itself will build. This decision moves no boundary — it gives the founder something at the boundary.

**Not decided here.** Whether Vibe should verify the result by re-reading the repository. It could — the scan is free — but a founder who says they did the work is the same authority ADR 0090 already accepts for real-world work, and requiring proof from them and not from a plumber would be a strange asymmetry. Offered later, if the evidence says founders want it.

**And explicitly not a step toward building payments.** The tempting next move is to loosen the risk class instead. That would need a deterministic way to tell a pricing *display* from a *charge*, which the classifier cannot do today by construction — it reads evidence ids and never prose, precisely so a reworded step cannot downgrade itself. That is a separate decision with its own detector work behind it.
