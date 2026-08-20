# ADR 0030 — Agent execution observability

**Status:** Accepted
**Date:** 2026-08-19
**Supersedes nothing. Extends** [ADR 0027](0027-coding-agent-provider-and-tool-gateway.md)
and [ADR 0029](0029-agent-runtime-placement-and-credential-broker.md).

## Context

Two real agent executions have run. Both worked mechanically and neither could
be explained while it was happening.

Run #1 spent $0.31 over nine minutes and reported `turns: 0` until the run was
over. Run #2 spent $0.62 over ten and a half minutes for the same business task,
and answering *why it cost twice as much* took a session of SQL across four
tables plus platform logs — see
[0040b](../sprints/0040b-run-economics-comparison.md). Run #2 also touched
eighteen paths and changed six, and nothing on any screen distinguished the two
numbers until after the run was refused.

The runtime is not the problem any more. The absence of a record is.

## Decision

### 1. A dedicated execution event model

`agent_execution_events`, a new table. Not an extension of
`agent_activity_events`, which is deliberately a closed customer vocabulary of
counts with — as its own comment says — "no message column, deliberately: a
schema that cannot express a sentence cannot leak a reasoning trace". Widening
it to carry commands, durations, exit codes and costs would erase that property.

The new table subsumes it rather than duplicating it: every event carries an
`audience`, and the customer timeline is the `audience = 'customer'` projection.
One log, two readings, no second write.

Nothing already durable is copied into it. Token counts stay in
`ai_usage_events`, CPU and egress in `sandbox_usage_events`, terminal facts on
the run row. What this table holds is the **sequence**, which nothing else does,
because a state column can only say where a run is now.

### 2. Two producers, one sequence space

The harness numbers its own progress feed from 1, inside the VM, in a file that
survives a Vibe function dying. That numbering is the idempotency key: every
poll re-offers the whole file and the write is an upsert on `(run, sequence)`,
so a lost poll costs nothing and a retry rewrites identical rows.

Vibe's own milestones come from a different process that cannot see that
counter, so they take a reserved band at 90 000. Two producers, no coordination,
no cursor to lose across a step boundary — which is the thing that was already
tried and lost when a 300-second ceiling killed the step that was watching.

`sequence` orders the feed exactly; `occurred_at` is what a reader means by "then
what happened", and the UI sorts by that.

### 3. Actions, never reasoning

The tool stream carries what the harness *executed*: a tool name, a repository
path, a command line. The translation reads those three fields and no others —
there is no branch in it that touches a text block. Combined with a closed `type`
vocabulary and a `summary` composed by Vibe, there is no field in this system a
sentence from the model can arrive in (Rule 43).

### 4. Redaction at the boundary, bounds in code

The agent runs with a gateway bearer token on its environment, so a command it
composes really can carry a credential. `redactSecrets` runs over every string of
every event at the write boundary rather than at each call site, so a new event
type cannot forget it. Paths, metadata keys, metadata size and events-per-run are
all bounded in code — a repository supplies the file names, and an agent can be
induced to touch files in a loop.

Bounding happens in code rather than only in SQL because a check constraint
rejects the whole write and loses the event; a code bound keeps the event and
loses only the excess. The database enforces the outer limits as a second line.

### 5. Observed is not candidate, in the data and on the screen

The live view labels touched paths `observed` and never as a change until
`change_verified` exists. Run #2 is the reason: a panel that had promised
eighteen changes would have been wrong for ten minutes and then wrong in the
other direction. The two counts are separate fields the whole way through.

### 6. Reusable modules, a dogfood host

`observability/`, `economics/` and `ui/` under `src/modules/coding-agent/`. The
Dogfood route owns the URL, the poll and the interrupt form; it owns no
derivation and no presentation. Moving this into the production dashboard is a
new host and a data call.

### 7. Polling, not realtime

Three-second polling through the existing server action, stopping on
`shouldPoll = false`, which is false for every terminal status. The app already
does this for action plans and it needs no new infrastructure (rule 24). A
websocket platform for one page would be a decision, not a detail.

### 8. Cost is derived; missing cost is reported as missing

No `total_cost_usd` column. Provider cost sums `ai_usage_events`, sandbox
metering comes from `sandbox_usage_events`, and the total is **null** whenever
the sandbox half is unreported — which is always, today, because the provider
prices no sandbox per run. A total that silently omits a component is the kind of
number a margin later gets built on.

`cost_per_successful_change` divides all agent spend by **prepared changes**,
not by completed runs. Runs #1 and #2 both completed and both delivered nothing;
counting them in the denominator would have reported a healthy unit cost for a
product that had shipped no change. It is `null` at zero changes — undefined,
not zero.

## Consequences

- One new table, no new infrastructure, no new dependency.
- Every event write is inside a `try` and can never fail a paid execution.
- The customer view and the inspector cannot disagree: both project the same log.
- `agent_activity_events` is left in place and unwritten under the sandbox
  topology. Removing it is a separate change once the gateway topology is
  retired for good.
- The turns naming defect ([0040a](../sprints/0040a-turn-metric-mismatch.md))
  is *displayed* correctly — two separately named metrics, never a ratio — but
  not yet fixed at the schema. That remains open.
