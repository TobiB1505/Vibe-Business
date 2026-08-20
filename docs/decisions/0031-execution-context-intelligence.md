# 0031 - Execution Context Intelligence: verify relevant facts, do not broadly rediscover

Status: Accepted (extends 0027, 0029, 0030)
Date: 2026-08-19

## Context

Real agent run #3 succeeded. It produced Vibe's first Prepared Change — two
files, sixteen lines — and it took eight minutes forty-four seconds, twenty-one
provider calls and $0.3465. Fourteen file reads and ten commands of that went
on working out where things are.

None of that was necessary. Vibe had already analysed the repository at the
exact commit the run was pinned to, stored the result versioned and
revision-bound, and had it sitting in `repository_intelligence_snapshots` before
the run started — routes with their source paths, business surfaces with their
evidence paths, frameworks with the manifests that prove them. The agent was
sent in knowing a framework list, a package manager and a SHA, and had to
rediscover the rest with tool calls the customer paid for.

The cost shape makes this worse than it looks. Each provider call re-sends a
growing transcript, so run length is super-linear in cost: run #2 took 35 calls
and cost $0.6158, run #3 took 21 and cost $0.3465. Turns spent on orientation
are not a small constant overhead; they are the multiplier.

Two things had to be true of any fix. It could not become "send the agent
everything Vibe knows" — a brief that costs more than the exploration it
replaces is a loss, and the business audit is far larger than fourteen file
reads. And it could not become a second source of truth: `product_profiles`
already *is* the versioned Product Intelligence Snapshot, joining the
repository, live and authenticated scans under one schema, builder and evidence
version with an input hash.

## Decision

### 1. A compiled, task-specific Execution Brief — not a document dump

`src/modules/execution-context/` compiles one bounded brief per execution from
the immutable `ExecutionSpec`, the repository snapshot that spec names, and the
product profile. It selects: the step's own words drive which business surfaces
are relevant, and only those surfaces' evidence reaches the brief.

Bounds are central rather than incidental: twenty facts, twelve file
candidates, three evidence paths per fact, 200 bytes per value, and a 6 KB
rendered ceiling that is the one that actually binds because it is the one the
provider bills for. What is left out is counted and stated, because a bounded
selection presented as the whole of what is known teaches a reader that Vibe
knows less than it does.

### 2. No new intelligence table

This sprint stores no intelligence. The brief is a pure function of the spec
and the snapshot the spec names, so it is recomputable rather than persisted.
What is recorded on `agent_execution_runs` is *what a run was given and what it
then read* — execution history, which nothing else stores.

### 3. A freshness gate, and no "close enough" branch

Repository-derived facts and every file candidate are withheld unless
`snapshot.source.commitSha === spec.repository.baseSha`. There is no ancestor
check, no same-branch rule and no timestamp window: a path that has moved is
worse than no path, because it sends the agent somewhere confidently wrong.

`stale` and `unknown` are stored distinctly from *absent*. "Vibe had a map of
the wrong tree" is a different fact from "Vibe had no map", and only one of them
is a reason to re-analyse. A run whose brief did not survive the gate falls back
to exactly the v1 prompt and the v1 instruction to go and look.

### 4. Live product intelligence relates to the repository as `unknown`

There is no column anywhere in this product that ties a deployed origin to a Git
SHA, and no evidence available to establish one. The relation is a three-value
vocabulary (`verified` / `inferred` / `unknown`) and today every answer is
`unknown`. `verified` would be a claim about a deployment record that does not
exist.

### 5. Facts are typed, evidence-backed and categorically confident

A fact is a closed-vocabulary subject, a bounded single-line value, a source, a
confidence taken from the analyzer's own `high`/`medium`/`low`, and up to three
repository paths at a stated revision. No numeric confidence is invented:
nothing in the pipeline measures one, and a number would put a precision on
these that no part of the system earns.

### 6. Candidates are derived, never tabulated

File candidates come from `routes[].sourcePath` and
`businessSurfaces[].evidence[].path` — paths Vibe's own analyzer produced at the
pinned commit. No path and no task name appears in the compiler.

Where a *new* file should go is answered the same way: not by a surface→path
table ("robots lives at `app/robots.ts`") but by a `router` fact naming the
directory this repository's own route files were observed in. That is right for
`src/app`, for `app`, and for a monorepo, and it needs no entry per task.

### 7. The instruction changes with the context

`agent-prompt-v2`. Briefed runs are told to *verify the specific facts the
change depends on and look wider when they do not hold*; unbriefed runs get v1's
*read before you write* unchanged. The switch is a boolean, so not one character
of either sentence comes from anywhere but Vibe's own prompt file.

The briefed instruction deliberately does not say "trust the briefing". A fact
that turns out to be wrong is a reason to look further; telling a model its map
is authoritative is how a moved file becomes a confidently broken change.

### 8. The brief is data, never instruction

Every value in it derives from a customer's repository, plan or recorded
answers. It reaches the model only inside `<untrusted source="...">`, it cannot
reach the system prompt (Rule 42), and the structure carries its share: a fact
is a typed subject/value pair with a bounded, whitespace-collapsed string, so
there is no field a directive survives intact in.

Over-long paths are dropped rather than truncated, and a path that escapes the
repository is refused — the analyzer should never produce one, which is exactly
why the check is cheap to keep.

### 9. Measurement is raw counts, never a score

`context_bytes`, `context_facts_sent`, `context_candidates_sent`,
`context_candidates_read`, `unique_files_read`, `repeated_file_reads`,
`files_read_outside_context`. No "context hit rate" and no "AI efficiency
score": those are ratios whose denominators are arguable, and worse, they look
measured. Reading a briefed file proves the agent opened it, never that opening
it was what made the change correct.

The reading is observed from the harness's own tool stream (Rule 77), and the
briefing it is counted against is recompiled and checked for identity — a run
whose brief cannot be reproduced is recorded as unmeasured rather than compared
against a briefing it was never given.

## Consequences

**Easier.** A run starts from what Vibe already paid to learn. The orientation
turns that dominated runs #1–#3 are the ones a brief is aimed at, and because
cost is super-linear in run length, removing turns is worth more than the ~1 KB
the brief adds. Adding a business surface to the analyzer adds it to every
future brief with no compiler change.

**Harder.** There is now a second thing that can be wrong about a repository,
and it is one the agent is told to start from. The freshness gate and the
"believe the repository over the briefing" instruction are what keep that a
wasted turn rather than a wrong change, and neither is a guarantee — only
independent validation is.

**Foreclosed.** Vibe can no longer claim a run was briefed without recording
what it was briefed with; `briefed` is derived from the rendered bytes, not from
whether a brief object existed. And the door to "just include the audit" is
closed by a byte ceiling rather than by discipline.

**Unchanged, deliberately.** Write scope, file-count and diff budgets, the
sandbox network policy, gateway budgets, billing and independent validation.
None of them reads a brief, and nothing in a brief widens any of them. A brief
is a starting point; being wrong costs one tool call.

## Related

- [0027](0027-coding-agent-provider-and-tool-gateway.md) — provider boundary and tool gateway
- [0029](0029-agent-runtime-placement-and-credential-broker.md) — harness in the sandbox
- [0030](0030-agent-execution-observability.md) — the event log these two new types join
- [docs/sprints/0041-execution-context-intelligence.md](../sprints/0041-execution-context-intelligence.md) — the inventory this decision rests on
