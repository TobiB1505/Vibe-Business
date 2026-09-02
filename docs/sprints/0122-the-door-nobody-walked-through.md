# The door nobody walked through

**Recorded 2026-09-02, after the work.** Etappe 2 of the plan built from the
codebase-fitness audit. About 2,700 lines deleted, and one finding worth more
than the deletion: the test suite's picture of an agent run was the topology ADR
0029 retired two weeks ago.

## What was deleted, and why it was safe

ADR 0029 moved the harness into the execution's own microVM. Inside it the agent
edits files with its own tools and never calls back. The **tool gateway** — ADR
0027's single door, default-deny, with an audit trail — was not removed with the
topology it belonged to.

It was still constructed on every run, handed to the provider as `invokeTool`
that `sandbox-runtime/provider.ts` never references. Every run since wrote six
zeros and two empty lists, with a comment at the call site saying the trail is
"empty by construction" while writing it anyway.

Gone: `coding-agent/claude/` (the SDK adapter, whose docblock named
`gateway_tools` — a runtime with no value anywhere in the system — as its reason
to exist), `gateway.ts`, five of the six methods of `sandbox-workspace.ts`, the
`AgentWorkspace` interface, `recordAgentToolEvents`, `recordAgentActivity`, and
the brokered-write fallback in the extract step.

Two known argv defects left with the code they sat on, unfixed because they were
never reachable: the `find -printf "%y\t%P\n"` listing split on newlines — the
defect VB-029 removed from `changes.ts` — and a `grep -e` query with no NUL
check, which `search()` would have read as "no matches".

The reasoning that made it safe is rule 76's own: **an effect that must never
happen is an absent capability, not a denied one.** The two authorities that
remain were already there and already tested — `program.test.ts` asserts the
harness's tool set contains no `WebFetch`, no `WebSearch` and no MCP server, and
`candidate.test.ts` asserts `verifyCandidateChange` refuses a forbidden path
*"even if the gateway somehow allowed it"*. That sentence was written before
this sprint and describes exactly the authority that survives it.

## The finding: the suite modelled the wrong topology

`fakeDetachedAgentProvider` called `request.invokeTool(...)`. The real detached
provider does not, and cannot — the harness is on the other side of a VM
boundary.

So **nine test sites across three files asserted a brokered tool trail, a change
set that arrived through Vibe, and an interrupt raised through the broker** —
all passing for a reason production has not had since ADR 0029. Two of them
asserted rows (`agent_tool_events`, `agent_activity_events`) that no real run
has ever written.

This is the same class as the NUL bug four days ago and as the fake sandbox's
unfailable commands two stages ago, one level up: **a fake that models a
topology the product no longer has does not test the product.**

The repair is that a test which wants a run to have changed something now
*writes into the sandbox filesystem* — `fakeSandboxProvider.writeFile`, from the
fake harness's `onStart`, which is where the harness conceptually runs — and the
observation has to find it by walking. Which is the property those tests exist
for.

### A dead fallback that could have turned a real change into no change

`extractAndVerifyStep` fell back to reading brokered write paths out of
`agent_tool_events` when `observedPaths` was null. That table is empty, so the
fallback's only possible answer was `agent_produced_no_change`.

`observedPaths` is now required, and `null` — an observation that did not
complete — is refused as `sandbox_lost` rather than read as "nothing changed".
Rule 77: an observation that might be incomplete fails the run; it never becomes
a partial diff.

### Two tests removed rather than re-pointed

Recorded where they stood, so the removal is readable:

- An in-process interrupt test that **duplicates a live one** already asserting
  the same three outcomes — the interrupt row, the founder input request, the
  paused outcome — through `runtimeFounderInput`, which is the path production
  takes.
- A tool-trail test asserting two allowed-then-denied rows and a non-empty
  activity list.

Three cases of `injection.test.ts` went with the gateway. The seven that test
prompt fencing and credential absence — the half that never depended on it —
stay, and one was re-pointed from `gateway.invoke("read_file")` to the workspace
reader, which is what reads a file now.

## What is given up, stated plainly

**There is no pre-execution policy check on what the agent does inside its VM.**
That was already true; this sprint stops the codebase from implying otherwise.
ADR 0029 §5 recorded the reduction in defence depth honestly when it moved the
runtime — what is lost here is a *denial*, not a *prevention*: the gateway
denied calls the harness had already stopped making.

## Not done, deliberately

The four counter columns keep their historical values. Dropping a column the
deployed code still selects is the skew
[`docs/deployment/migrations-and-rollback.md`](../deployment/migrations-and-rollback.md)
forbids; a later migration drops them.

## Verification

7,285 unit tests, typecheck, lint (0 problems) and build clean — 47 fewer tests
than before, every one of them an assertion about the retired topology.

**Not dogfooded.** The deletion is on the paid agent path, and although every
removed call site was proved unreachable by grep and by type, the first real
"Run with Vibe" after deploy is what confirms it. `workspace_failed` from
Sprint 0115 is what will say why if it does not.
