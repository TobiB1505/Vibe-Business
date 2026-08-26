# 0054 - Agent Action Plan completion comes from verified execution evidence

Status: Accepted
Date: 2026-08-26

## Context

ADR 0053 introduced the first authoritative Action Plan completion evidence:
an active founder resolution completes its matching founder-owned step. Agent
steps deliberately remained incomplete. The execution pipeline already stores
all facts needed to resolve that gap, but no Action Plan read projects them.

Using only `agent_execution_runs.status = 'succeeded'` would be too weak. It is
a terminal lifecycle fact, not proof that the observed candidate passed Vibe's
write policy or that the prepared bytes passed independent validation. Adding a
manual `completed` flag would be weaker still and would create a competing
source of truth beside the execution records.

## Decision

Agent-step completion is a read-time projection over four existing records:

1. an immutable `execution_specs` row binds the exact plan and step;
2. a planner-origin `agent_execution_runs` row succeeded and names a Prepared
   Change;
3. that run has a durable `change_verified` event, proving Vibe accepted the
   observed candidate rather than the agent's account of its work;
4. a `validation_runs` row for that Prepared Change passed, and its recorded
   source integrity says the changed files were verified.

All four must exist. Missing, partial, failed, cancelled, runtime-blocked and
legacy evidence remains incomplete. Dogfood-fixture runs never complete a
customer plan. Matching uses both the stored step key and order.

The projection lives in the Action Plan read model. No table, completion flag,
trigger or new lifecycle state is introduced. `founder_action` and
`external_party` keep their separate unresolved authorities, and no manual
control may complete an Agent step.

This completion means the agent-owned implementation step produced an
independently validated Prepared Change. It does not mean approved, merged,
deployed, live, safe or business-effective; those remain their existing,
separate authorities.

## Consequences

- A downstream plan step can become ready only after the executable step has a
  successful and independently validated artifact.
- An agent status, Prepared Change, verification event or validation pass is
  insufficient by itself, which makes partial writes fail closed.
- Existing canonical execution records remain the only source of truth; the
  Action Plan owns only the projection.
- No migration is required.
- A later policy may choose a stronger delivery boundary for a particular step
  type, but it must not reinterpret this evidence as merge, deployment or
  production outcome authority.
