# 0070 - The sandbox is the boundary; the tool gateway is retired

Status: Accepted; amended by [0074](0074-removing-a-file.md) — a verified candidate may remove a file
Date: 2026-09-02

Supersedes [ADR 0027](0027-coding-agent-provider-and-tool-gateway.md) in its
second half. The `CodingAgentProvider` boundary that ADR names stands unchanged
and is not in question here.

## Context

ADR 0027 gave the agent two things: a provider boundary, so no module above it
learns a vendor's vocabulary, and a **tool gateway** — the single door every
effect passed through, default-deny, with an audit trail. That was the right
design for the topology it was written for, where the harness ran inside a Vibe
process and could not touch anything except through code Vibe controlled.

[ADR 0029](0029-agent-runtime-placement-and-credential-broker.md) moved the
harness into the execution's own microVM, because `@anthropic-ai/claude-agent-sdk`
spawns a 307–325 MB native binary and a Vercel function's whole deployment
budget is 250 MB. Inside that VM the agent edits files with its own tools. It
does not call back.

**The gateway was not removed, and nothing recorded that it had stopped
working.** It was constructed on every run and handed to the provider as
`invokeTool`; `sandbox-runtime/provider.ts` never referenced it. Every run since
therefore wrote six zeros to `tool_calls_allowed`, `tool_calls_denied`,
`files_read`, `check_runs`, `repair_attempts` and `changed_bytes`, and two empty
lists to `agent_tool_events` and `agent_activity_events` — with a comment at the
call site saying the trail is "empty by construction" while writing it anyway.

Three further consequences had accumulated:

- **The suite's picture of a run was the retired topology.** `fakeDetachedAgentProvider`
  called `request.invokeTool(...)`; the real detached provider does not. Nine
  test sites across three files asserted a brokered tool trail, a change set
  produced through Vibe, and an interrupt raised through the broker — all
  passing for a reason production has not had since ADR 0029.
- **A dead fallback could turn a real change into no change.** `extractAndVerifyStep`
  fell back to reading brokered write paths out of `agent_tool_events` when its
  `observedPaths` argument was null. That table is empty, so the fallback's only
  possible answer was `agent_produced_no_change`.
- **Two argv defects sat on the unreachable path** — a `find -printf "%y\t%P\n"`
  listing split on newlines, the exact defect VB-029 removed from `changes.ts`,
  and a `grep -e` query with no NUL check — neither live, neither fixed, because
  the code was neither used nor deleted.

## Decision

**The isolated VM and Vibe's own verification are the boundary. The tool gateway
is deleted.**

What bounds the agent is now stated in two places and nowhere else:

1. **An absent capability, before the run.** The harness's tool set is named
   explicitly in `sandbox-runtime/protocol.ts` — never taken from a preset — so
   there is no `WebFetch`, no `WebSearch` and no MCP server. `program.test.ts`
   asserts the absence.
2. **Vibe's own refusal, after it.** `verifyCandidateChange` reads the changed
   paths off the filesystem, compares the bytes to the pinned commit, and checks
   the result against the compiled policy before any branch exists.
   `candidate.test.ts` asserts it refuses a forbidden path *"even if the gateway
   somehow allowed it"* — a sentence written before this ADR that describes
   exactly the authority that remains.

This is rule 76 applied to its own subject: **an effect that must never happen
is an absent capability, not a denied one.** Five gateway methods nothing
invoked were five denials that refused nothing.

Deleted: `coding-agent/claude/` (the SDK adapter, which had no production
constructor and named `gateway_tools` — a runtime with no value anywhere in the
system — as its reason to exist), `gateway.ts`, the five unreachable methods of
`sandbox-workspace.ts`, the `AgentWorkspace` interface, `recordAgentToolEvents`,
`recordAgentActivity`, and the brokered-write fallback. About 2,700 lines.

`observedPaths` becomes required, and `null` — an observation that did not
complete — is refused as `sandbox_lost` rather than read as "nothing changed".

## Consequences

**There is no pre-execution policy check on what the agent does inside its VM.**
This was already true and is now the design rather than a side effect. ADR 0029
§5 recorded the reduction in defence depth honestly when it moved the runtime;
this ADR stops the codebase from implying otherwise by keeping a door nobody
walks through. What is lost is a *denial*, not a *prevention*: the gateway
denied calls the harness had already stopped making.

**The test suite now models the topology that exists.** `fakeDetachedAgentProvider`
no longer invokes anything through Vibe; a test that wants a run to have changed
something writes into the sandbox from `onStart`, and the observation has to
find it by walking the filesystem — which is the property those tests are for.
`fakeSandboxProvider.writeFile` exists for that and says why.

**Two tests were removed rather than re-pointed**, and the reasoning is recorded
where they stood: an in-process interrupt test that duplicates a live one
already asserting the same three outcomes through the runtime protocol, and a
tool-trail test asserting rows production has never written. Three cases of
`injection.test.ts` went with the gateway; the seven that test prompt fencing
and credential absence — the half that never depended on it — stay.

**The four counter columns are kept, holding their historical values.** Dropping
a column the deployed code still selects is the skew
[`docs/deployment/migrations-and-rollback.md`](../deployment/migrations-and-rollback.md)
forbids. They stop being written here; a later migration drops them.

**`RaisedInterrupt` and the observed-change type moved to `schema.ts`**, renamed
from `GatewayChange` to `ObservedChange`. Where a change comes from is the whole
of rule 77, and the old name said the wrong thing.

## Related

- [ADR 0027](0027-coding-agent-provider-and-tool-gateway.md) — the provider
  boundary, which stands; the gateway half, which this replaces.
- [ADR 0029](0029-agent-runtime-placement-and-credential-broker.md) — the move
  that made the gateway unreachable, and §5's honest note about defence depth.
- [ADR 0015](0015-untrusted-repository-execution-provider.md) — the sandbox that
  is now the boundary.
