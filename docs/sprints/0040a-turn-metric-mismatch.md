# Known defect — `turns` and `maxAgentTurns` do not count the same thing

**Status:** recorded, not fixed. Deliberately out of scope for the change-evidence patch.
**Found:** 2026-08-19, during the first complete agent execution (run `42b4cc54`).

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

## Proposed correction (a later patch)

1. **Name the metric for what it measures.** Rename the persisted column and the
   protocol field from `turns` to `assistantMessages` / `assistant_messages`, or
   record the harness's own `num_turns` as a second, separately named field.
   Persisting both is cheap and answers different questions: assistant messages
   track model responses, harness turns track the budget.
2. **Compare like with like in the UI.** Whatever is displayed beside
   `maxAgentTurns` must be the harness's turn count, not the message count.
3. **Keep the terminal value authoritative.** `program.ts` already overwrites its
   running tally with the harness's `num_turns` from the `result` message, so the
   final stored value is *already* in harness units while every intermediate
   progress write is in message units. That silent unit switch mid-run is part of
   the same defect and should be resolved by the split above, not by dropping one
   of the two.

## The same defect, in another column — now fixed

Run #3 stored `changed_file_count: 14` for a change of two files, for exactly
this reason: the collect step wrote the number it had (the observation) into a
column named for the number it did not (the candidate). That one is repaired —
`observed_path_count` now holds the observation and `changed_file_count` holds
the verified candidate, written by the step that knows it. See migration
`20260819140000`.

The turns pair below is the remaining instance.

## What must not change as part of this

The turn budget itself. `maxAgentTurns = 40` was not reached under either
reading, so there is no evidence yet about whether it is the right number.
