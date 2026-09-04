# modules/execution-context

What an agent is told before it starts, and what it may do once it has finished — see [ARCHITECTURE.md §3 "Layers with no section above"](../../../ARCHITECTURE.md#layers-with-no-section-above), [ADR 0031](../../../docs/decisions/0031-execution-context-intelligence.md) and [ADR 0034](../../../docs/decisions/0034-execution-surface-and-lifecycle.md).

[`modules/execution-contract`](../execution-contract/README.md) holds the immutable spec and compiled policy a run executes _under_. This module holds the two things around it: the **brief** it starts from, and the **budgets** that decide when it should stop.

Every rule here was derived from a measured run, not from a principle someone liked. The measurements are named throughout because they are what makes the numbers arguable.

## The principle

> Verify relevant facts. Do not broadly rediscover.

Run #3 succeeded, and spent 8m44s, twenty-one provider calls and $0.3465 to change two files by sixteen lines. Almost all of it went on rediscovery: fourteen file reads and ten commands establishing a repository layout Vibe had already analysed, stored and versioned before the run began. The agent was sent into a repository it had been told nothing about, because the only repository facts in its prompt were a framework list, a package manager and a commit SHA.

A brief is not a substitute for the repository. The agent still reads, and it still works against the pinned commit. It is a starting point **with provenance**: every fact carries where it came from, which file proves it, at which revision, and how strongly it is grounded. A fact that turns out to be wrong is a reason to look further; a fact that is right saves a turn.

## The brief is data, never instruction

Every value in a brief is derived from a customer's repository, their action plan, or their own recorded answers. **None of it was authored by Vibe.** So it is rendered inside labelled untrusted fences at the agent boundary and can never reach the system prompt (rules 25 and 42).

The structure enforces that as much as the rendering does: a fact is a typed subject/value pair with a bounded string, not a paragraph. There is no field a directive could arrive in intact.

## Surfaces, because prose could not tell two steps apart

Run #6 ("add robots meta directives") and run #7 ("add canonical URLs to public pages") compiled to **byte-identical** briefs: 2,871 bytes, 16 facts, 6 candidates. Not a coincidence — the selector read the step's prose, and both steps belong to one plan whose goal names every signal the plan touches. The more coherent a plan is, the less its own words distinguish its steps.

`surface.ts` replaces keyword matching with a resolved execution surface: which part of the product the work actually lands on, with each route naming the repository file that serves it.

## Two kinds of checking, which had collapsed into one

```
Agent Verification      helps the agent find and repair its own mistakes
                        advisory · bounded · authorizes nothing

Independent Validation  decides whether a prepared change may progress
                        authoritative · isolated · unchanged by this module
```

Run #4 spent 4m58s of a 6m28s run on typecheck, test and build — and then the independent validator ran the same four commands against the prepared branch, taking about the same five minutes. All three agent checks passed first time, so the whole 4m58s found nothing. **Seventy-seven per cent of a paid agent run went on rehearsing a verdict the agent does not get to give** (rule 78).

The sentence `verification.ts` exists to make true: _the agent checks enough to converge; the validator checks enough to authorize._

## Completion, and the mistake worth reading

`completion.ts` makes exploration scarce once the code has stopped changing, with one rule to keep repair alive: a new edit buys back the budget. Run #7 showed what the first version of that rule cost. The task legitimately required editing eight files; the counter incremented on every mutation after the first, so eight edits produced seven completion windows against a ceiling of four, and every subsequent action was refused. All eight refusals were the agent trying to read the files it had just changed — the plan's own _required_ diff review.

Two separate mistakes, both fixed rather than tuned around: the number of edits was being used as a proxy for the number of convergence cycles (raising the ceiling would only have moved the threshold, so the counter's meaning changed instead — implementation breadth is free, and only a mutation arriving _after_ convergence consumes a window), and an optional resource control was refusing a required verification.

## Measured, never scored

`usage.ts` records raw counts of whether a brief's facts were used, and deliberately computes no "context hit rate" or "AI efficiency score". One number that goes up is a number that gets optimized, and the thing it would be optimizing is not the thing anyone wants.

## What lives here

| File              | Purpose                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| `brief.ts`        | The domain: facts, candidates, confidence, provenance, freshness.                      |
| `compiler.ts`     | Building one brief for one step, from what Vibe already knows.                         |
| `render.ts`       | Rendering it inside untrusted fences at the agent boundary.                            |
| `surface.ts`      | Which part of the product a step lands on, and the requirement derived from evidence.  |
| `verification.ts` | How much checking the agent does before it stops. Advisory, bounded.                   |
| `completion.ts`   | What a run may do after the code is written, and when "after" begins.                  |
| `policy.ts`       | Asserting that the compiled policies do not contradict each other.                     |
| `usage.ts`        | Raw counts of whether a brief was used. No score.                                      |
| `service.ts`      | The entry points: load a brief, a plan step, a verification plan, a completion budget. |
| `test-support.ts` | Fixtures for surfaces, routes and snapshots.                                           |
