# 0033 - Post-Implementation Completion Control: stop paying for exploration after the job has converged

Status: Accepted (extends 0027, 0029, 0031, 0032); partly superseded by [0034](0034-execution-surface-and-lifecycle.md)
Date: 2026-08-19

## Context

Run #5 halved the wall clock and did not reduce cost.

```
                      Run #4 (v2)     Run #5 (v3)
duration              6m 28s          3m 12s     −51%
provider calls        13              15         +15%
provider cost         $0.2272         $0.3199    +41%
agent builds          1               0
agent full suites     1               0
agent typechecks      1               0
```

Sprint 0042 worked: the 4m58s of duplicated QA is gone. What replaced it is
cheaper in seconds and dearer in tokens, because commands are wall-clock
expensive and token-cheap while reading and reasoning are the reverse.

The implementation finished at **59.3 seconds**. The run lasted 191.8. In the
132.5 seconds after the last edit — 69% of the run — eight of fifteen provider
calls and $0.1496 of $0.3199 were spent on nine tool actions:

```
 62.5s  read  src/app/layout.tsx                    the required diff review
 63.0s  read  src/app/app/layout.tsx                the required diff review
 63.3s  grep  src                                   exploration
 68.2s  read  …/generators/nextjs-seo-foundations.ts  outside the brief, unrelated
 84.7s  bash  node -e "…dependencies.next"          re-derived a brief fact
 91.1s  grep  src/app                               exploration
 91.1s  glob  *                                     exploration
 96.8s  grep  landing-contract.test.ts              locating a test
101.6s  bash  vitest run …contract.test.ts          the permitted targeted test
```

Four of nine were the job. No tool failed; nothing in the evidence justified the
widening; and one action re-derived a fact the Execution Brief had already
stated. **v3's prompt already told the agent to stop.** Asking again is not a
mechanism.

## Decision

### 1. `PreToolUse`, not `canUseTool` — a second bypass, found and closed

Sprint 0042 removed `allowedTools` after run #5 proved the plan was inert. That
was necessary and **not sufficient**: `permissionMode: "default"` is documented
as prompting only *"for dangerous operations"*, so a `Read`, `Glob` or `Grep`
can be approved without `canUseTool` ever running.

The policy therefore moves to the `PreToolUse` hook, which fires for every tool
call and — by the SDK's own notes — resolves before `canUseTool`. `canUseTool`
stays as the tool-name backstop: the hook governs *what a permitted tool may
do*, the callback governs *which tools exist*.

### 2. A free canary that runs the real SDK

`pnpm agent:canary` spawns the actual 310 MB SDK binary with
`ANTHROPIC_BASE_URL` pointed at a local stub that replays scripted tool calls.
Zero provider cost, real control path. It proves a forbidden `pnpm build` is
refused *and never executes* — checked by the absence of a marker file the
command would have created.

This exists because the `allowedTools` bug passed every test in the repository.
Those tests asserted the shape of generated code; a boundary is only proved by
running the thing that enforces it.

### 3. Completion phases, observed only

`orienting → implementing → verifying → repairing → completing`, every
transition driven by a tool event the harness saw.

There is deliberately no `done` judgement. The runtime cannot prove a step's
Done When is semantically satisfied — that is a sentence about a business
outcome. What it can prove is that the code stopped changing, the required
checks passed and nothing is failing. Whether the work is *right* is the
validator's question and then a human's.

### 4. A completion budget, bought back by editing

Per verification mode: tool calls since the last edit, a much smaller
outside-brief read allowance, a repair-cycle cap and a wall clock.

The load-bearing rule is that **a new edit resets the window**. An agent still
changing files has not finished, so repair needs no exemption — and an exemption
is exactly what a model would learn to ask for. `maxRepairCycles` is the
backstop that stops edit→explore→edit→explore from being unbounded.

| | LOW | MEDIUM | HIGH |
| --- | --- | --- | --- |
| Tool calls since edit | 6 | 10 | 16 |
| Outside-brief reads | 1 | 3 | 6 |
| Repair cycles | 2 | 3 | 4 |
| Wall clock | 2 min | 4 min | 8 min |

LOW is six because run #5's legitimate post-edit work was four actions — enough
for that plus two, and less than the nine it took. The values are derived from
the measured run, not chosen round.

### 5. Repair is evidence-gated, and the evidence is narrow

`PostToolUseFailure` on a **command or a write** sets `unresolvedFailure`, which
outranks every budget until a mutation answers it.

A failed `Read` deliberately does not count. The canary caught this: reading two
non-existent files marked the run as repairing and unlocked unlimited
exploration — a bypass any model could have found by accident. A missing file
says the agent guessed a path wrong, not that the implementation is.

### 6. Before the first edit, nothing is scarce

The brief is evidence, not truth. An agent that cannot look around cannot
discover the brief is wrong, so every restriction here begins at the first
candidate mutation and tightens after required verification passes. Pre-edit
work stays bounded by the limits that already existed.

### 7. Classification from deterministic evidence

Tool name, path, brief membership, and whether a check has failed. The model's
account of *why* it wants something is not read — there is no parameter it could
arrive in, which is the proof rather than the promise.

### 8. Measurement named for what is observed

`time_to_last_edit_ms`, not `implementation_complete_ms`. From that one boundary
the post-edit provider call count and cost are a timestamp comparison against
the usage ledger — and null whenever the boundary is unknown.
`provider_cost_usd` is untouched.

`policy_decisions` is the new column that matters most: many tool calls beside
zero decisions is a policy that is not running, which otherwise reads exactly
like a policy with nothing to refuse.

## Consequences

**Easier.** The tail that cost $0.1496 and 132 seconds becomes bounded and
visible. Telling the agent the budget's shape also pushes its reading *before*
the edit, which is the cheaper order anyway.

**Harder.** There is now a way to cut a run off too early. The refusal messages
say what to do instead, the budget is generous relative to observed legitimate
work, and every refusal is a durable event — so a budget that is too tight
appears as evidence rather than as an agent that mysteriously did less.

**Explicitly not a security boundary.** This is model-behaviour and resource
control, running inside the customer's own VM. It is not a defence against a
hostile repository and must never be described as one.
`verifyCandidateChange`, the write scope, sandbox isolation, gateway security,
independent validation, human approval and validated-SHA == merged-SHA are
unchanged and remain the things that decide whether a change may progress.

## Related

- [0031](0031-execution-context-intelligence.md) — the brief whose paths this budget keys on
- [0032](0032-agent-verification-and-completion.md) — the verification depth this budget reuses
- [docs/sprints/0043-post-implementation-completion-control.md](../sprints/0043-post-implementation-completion-control.md)
