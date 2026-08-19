# Fixed — `turns` and `maxAgentTurns` did not count the same thing

**Status:** fixed, 2026-08-19. Migration `20260819160000`.
**Found:** 2026-08-19, during the first complete agent execution (run `42b4cc54`).

The record below is kept because the reasoning is the useful part: the defect
was never a wrong number, it was two right numbers sharing one name.

## What was observed

The run finished with `agent_execution_runs.turns = 48` against a budget of
`maxAgentTurns = 40`. Nothing overran: every bound that actually stops a run was
comfortably unspent — 9 min of a 20 min wall clock, $0.31 of $3.00 authorized
provider spend, 21 of 180 permitted gateway requests.

The two numbers simply measure different things and are displayed as if they
measured the same one.

## What each number counts

| Name | Where | Counts |
| --- | --- | --- |
| `budget.maxAgentTurns` | `ExecutionBudget`, → `AgentRuntimeLimits.maxTurns` → the harness's `maxTurns` option | Agent-loop **iterations** as the harness defines them. An iteration spans a model response *and* the tool results fed back in, so the harness's own `num_turns` advances by more than one per model response. |
| `agent_execution_runs.turns` | `sandbox-runtime/program.ts`, incremented on every `assistant` message in the SDK stream | **Assistant messages**. One per model response, including responses that only emit tool calls, and including any the harness produces during compaction. |

So `48` and `40` are in different units, and the smaller ceiling can legitimately
sit below the larger observation. Neither number is wrong; the pairing is.

## Why this matters even though nothing overran

The product intends to show a founder what their run consumed against what they
authorized. `48 / 40` reads as a breached limit that nobody enforced — which is
worse than showing nothing, because it teaches a reader that Vibe's stated
ceilings are decorative. It also makes the number useless for the one thing it
is good for: noticing a run that is looping.

## The correction, as applied

1. **Both metrics named for what they measure.** `turns` renamed to
   `assistant_messages`; `sdk_loop_iterations` added beside it, nullable. The
   old name is gone rather than aliased — the whole defect is that somebody read
   an ambiguous name and believed it, and a rename fails loudly at every call
   site instead.
2. **The UI compares like with like.** The inspector shows *Assistant messages*,
   *SDK loop iterations* and *Max SDK iterations* as three separately named
   values and forms no ratio between them. It also stopped reading the loop
   count out of the `agent_finished` event's message-count field, which is how
   it had been labelling one number as the other.
3. **The silent unit switch is gone.** Both `program.ts` (sandbox harness) and
   `claude/adapter.ts` (in-process) had one variable that counted messages and
   was then overwritten by the SDK's `num_turns`. They now keep two, and the
   loop count is `null` until the harness reports one — a run that died before
   its terminal message has no honest value there, and the message count is not
   a substitute.

Historical rows keep their message counts, which is what they mostly held.
`sdk_loop_iterations` is null for all of them rather than back-filled from a
column whose unit is not knowable per row: an unknown recorded as unknown beats
a plausible number nobody can check.

## The same defect, in another column — now fixed

Run #3 stored `changed_file_count: 14` for a change of two files, for exactly
this reason: the collect step wrote the number it had (the observation) into a
column named for the number it did not (the candidate). That one is repaired —
`observed_path_count` now holds the observation and `changed_file_count` holds
the verified candidate, written by the step that knows it. See migration
`20260819140000`.

The turns pair below is the remaining instance.

## What deliberately did not change

**The turn budget.** `maxAgentTurns = 40` was not reached under either reading,
so there is still no evidence about whether it is the right number.

**The `ExecutionSpec` field name.** `budget.maxAgentTurns` is badly named — it
is in SDK-loop units, not turns — but a spec is an immutable stored artifact
whose identity is hashed, and renaming a field in it would invalidate every spec
already written. The runtime limit derived from it is documented as being in the
harness's unit instead.
