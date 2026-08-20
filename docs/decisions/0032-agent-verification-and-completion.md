# 0032 - Agent Verification and Completion: the agent checks enough to converge, the validator checks enough to authorize

Status: Accepted (extends 0027, 0029, 0031)
Date: 2026-08-19

## Context

Run #4 succeeded in 6m28s for $0.2272. Its shape:

```
reading, thinking, editing   ~1m 22s
pnpm typecheck               ~1m 30s
pnpm test  (4,933 tests)     ~1m 31s
pnpm build                   ~1m 58s
                             ─────────
self-checks                  ~4m 58s  = 77% of the run
```

Independent validation then ran `install 14.1s / typecheck 89.7s / test 88.7s /
build 115.0s` against the prepared branch. The same three commands, twice, about
five minutes each time. All three agent checks passed first time, so the 4m58s
found nothing.

Sprint 0041 removed the *rediscovery* problem — the agent now starts from a
compiled brief and reaches its files in fifty seconds. What was left is a
duplicated QA problem, and it is now most of the run.

**Why it happened.** Nobody told the agent not to, and nothing could have
stopped it. `availableChecks` was derived from the repository's own scripts and
interpolated into the system prompt (`At most N check runs (typecheck, test,
build)`), the prompt said *"run the checks and fix what they find. Repeat until
they pass or until you are out of budget"* — an instruction with no completion
condition — and the harness's `canUseTool` allowed `Bash` by name without
looking at the command. The one ceiling that existed, `maxCheckRuns`, is
enforced in `ExecutionToolGateway.runCheck`, which the ADR 0029 sandbox topology
no longer calls: run #4 recorded `check_runs: 0` while running three.

## Decision

### 1. Two named jobs, not one

```
Agent Verification        helps the agent find and repair its own mistakes
                          advisory · bounded · may influence its next turn
                          authorizes nothing

Independent Validation    decides whether a Prepared Change may progress
                          toward human approval and merge
                          authoritative · isolated · unchanged
```

The sentence this makes true: **the agent checks enough to converge; the
validator checks enough to authorize.**

### 2. An `AgentVerificationPlan`, compiled server-side

Three modes with fixed profiles. LOW requires only that the agent reads its own
diff, allows one targeted test, and forbids the full suite, the production build
and the project typecheck. MEDIUM adds typecheck. HIGH allows everything,
because converging on an auth or data change may genuinely need it — and is
still advisory.

Each mode carries a command ceiling, a wall-clock ceiling and a repair-retry
allowance. LOW's ceiling of three commands exists so the
edit → targeted check → fix → recheck loop survives; a plan that killed repair
would trade money for correctness.

### 3. Classification from structured facts, never prose

`classifyAgentVerification` reads exactly what `classifyExecutionRisk` reads:
`changeKind` and the step's `evidenceIds`. Those ids are minted by Vibe's own
deterministic detectors and the planner is validated to cite only ids that exist
in the evidence pack — a model chooses among our ids, it cannot invent one.

A named family of presentational evidence prefixes (`live.seo.*`, `live.site.*`,
and the presentational `repo.surface.*` ids) sits beside the existing
`FINANCIAL_SURFACES` and `SECURITY_SURFACES` constants. **The word "robots"
appears nowhere in the classifier.** The benchmark step qualifies because it
cites `live.seo.robots_meta_missing`, exactly as its canonical-URL and Open
Graph siblings qualify by citing `live.seo.canonical_missing` and
`live.seo.open_graph_missing`.

`riskClass` is a floor that can only raise the mode. A step citing nothing gets
MEDIUM: an absent signal is not a weak signal.

### 4. An explicit completion contract

`agent-prompt-v3` replaces *"repeat until they pass or until you are out of
budget"* with a finish line: **Done When is satisfied, and the plan's required
checks have passed — then stop.** It also says what a failure means (read the
error, fix the cause, run the *same* check again) so a failing targeted test
does not become a reason to widen the search.

### 5. Enforced in the harness, and honest about what that is

The only place a shell command exists before it runs is inside
`AGENT_RUNTIME_PROGRAM`. `CanUseTool` is `(toolName, input, options)` — verified
against the installed `sdk.d.ts`, not recalled — so `input.command` is
inspectable, and a deny carries a message the model reads.

**This is a convergence control, not a security boundary.** It bounds what the
model chooses to spend. It is not a defence against a hostile repository, and
nothing about it makes a change safe. `verifyCandidateChange`, the write scope,
sandbox isolation, gateway budgets, independent validation and human approval
are unchanged and remain the things that decide whether a change may progress.

Refusals are never silent: the agent is told, and a `verification_command_refused`
event is written so a plan that is too tight shows up as evidence rather than as
an agent that mysteriously did less.

### 6. One source of truth for what a command is

`COMMAND_CATEGORY_RULES` and `TARGETED_TEST_PATTERN` travel into the VM as JSON
in `request.json` and are rebuilt with `new RegExp`. The runtime program keeps
its no-interpolation property, and the sandbox classifies a command by exactly
the table Vibe's timeline classifies it by. A second copy inside the harness
would be a second answer that drifts.

### 7. Bounded, observable escalation

`low → medium → high`, one step, granted against a counted condition —
repeated failure of a *permitted* check — never because a model asked. There is
no tool through which it could ask. A task class that keeps escalating is a
reason to change the classifier, not a thing that silently costs more.

### 8. Measurement named for what is observed

Vibe cannot see the moment an agent believes it is finished. It can see the last
time the agent wrote a file, so the column is `time_to_last_edit_ms` rather than
`implementation_complete_ms`. That single boundary makes PART L answerable
without inventing a split: "how many provider calls happened after the code was
already written" is a timestamp comparison against the usage ledger, computed at
read time, and null whenever either half is missing.

### 9. Absence permits, it does not forbid

A request with no policy leaves every command permitted — exactly v2's
behaviour. A missing field that meant "refuse everything" would turn a version
skew into an agent that cannot check its own work at all.

## Consequences

**Easier.** A LOW task should finish in roughly the 1m22s it spent implementing
plus a diff review, instead of that plus five minutes of rehearsal. Because
provider cost is super-linear in run length, removing turns is worth more than
the seconds they occupy.

**Harder.** There is now a way for Vibe to under-check an agent's work. The
cost of being wrong is bounded and visible: independent validation fails on a
change the agent thought was finished, which is precisely the signal that would
justify moving a task class up a mode.

**The judgement call worth naming.** Forbidding `typecheck` at LOW is the one
choice with a real downside. A type error in a metadata change would now be
caught only by independent validation, costing a full validation cycle instead
of ninety seconds. It is forbidden anyway, because leaving it allowed would make
run #5 spend the ninety seconds and teach us nothing about whether it was
needed. Moving `typecheck` from `forbiddenChecks` to `allowedChecks` in the LOW
profile is a one-line change if the experiment says otherwise.

**Unchanged, deliberately.** Independent validation runs the same four steps in
the same isolated VM under the same policy version. Candidate verification,
write scope, sandbox isolation, gateway budgets, billing and human approval are
untouched. One controlled variable: agent self-verification.

## Related

- [0027](0027-coding-agent-provider-and-tool-gateway.md) — provider boundary, tool gateway, independent validation
- [0029](0029-agent-runtime-placement-and-credential-broker.md) — why the harness is the only enforcement point
- [0031](0031-execution-context-intelligence.md) — the brief this plan is compiled beside
- [docs/sprints/0042-agent-verification-and-completion.md](../sprints/0042-agent-verification-and-completion.md)
