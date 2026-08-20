# `coding-agent`

The first real agentic execution. Turns one immutable `ExecutionSpec` into a
candidate code change, inside a box Vibe built.

```
ExecutionSpec                     immutable, versioned, secret-free   Core-3
      ↓
Prompt Compiler          §14      deterministic, versioned
      ↓
CodingAgentProvider      §5       provider-neutral; Claude is the one adapter
      ↓
agent sandbox            0029     the harness runs HERE, holding no Vibe secret
      ↓                           pinned commit · file/shell tools · one egress host
Agent Gateway            0029     ANTHROPIC_BASE_URL → Vibe injects the real key
      ↓
candidate change         §27      computed by Vibe, never claimed by the agent
      ↓
post-agent verification  §28      paths · counts · bytes · secrets · base identity
      ↓
PreparedChange → ValidationRun → Review → Approval → Safe Merge     unchanged
```

> **Runtime placement was corrected after the first real run.** The Core-4
> topology ran the harness in Vibe's process and brokered every effect through
> `ExecutionToolGateway`. It could not start: `query()` spawns a native binary of
> 307–325 MB and a Vercel function's budget is 250 MB, so the first dogfood died
> in 44 ms with zero turns. The harness now runs in the execution's own sandbox
> and samples through the Agent Gateway — see
> [ADR 0029](../../../docs/decisions/0029-agent-runtime-placement-and-credential-broker.md).
> `ExecutionToolGateway` and `AgentWorkspace` are unchanged and still describe
> the `gateway_tools` topology; the change set now comes from a filesystem
> comparison Vibe performs rather than from the gateway's write record.

## The principle, one layer on

Core-3's README states it:

> **AI decides how. Vibe decides whether, where, what, how much, when to stop,
> and what must pass.**

Core-3 wrote the second half down. This module is where it has to survive
contact with a model that can ask for anything — so nothing here reads a
prompt, and every refusal is decided from a compiled policy, a normalized path,
a counter or a clock.

## What is here

| File | What it answers |
| --- | --- |
| `schema.ts` | the tool vocabulary, denial reasons, run statuses, failure codes, versions |
| `provider.ts` | *what is a coding agent, expressed without naming a vendor?* |
| `claude/adapter.ts` | the one file that imports the Claude Agent SDK |
| `claude/tools.ts` | Zod shapes for the adapter. Not the enforcement |
| `workspace.ts` | *what can an agent do to the world?* — the complete list |
| `sandbox-workspace.ts` | that list, over a Vercel Sandbox |
| `gateway.ts` | *may this call happen?* — default deny, and the audit trail |
| `prompt.ts` | *what is the agent told?* — deterministic, versioned, fenced |
| `candidate.ts` | *what actually changed?* — read back, never reported |
| `budget.ts` | the spec's ceilings, expanded into runtime counters |
| `authorization.ts` | *whose economics?* — production has none; dogfood is allowlisted |
| `identity.ts` | what makes two runs the same job, and two changes the same change |
| `preflight.ts` | the §43 gate that runs before a Credit is spent |
| `store.ts` / `service.ts` | the persisted concepts, server-only |
| `usage.ts` | tokens and sandbox time, into the two existing ledgers |
| `dogfood.probe.ts` | the §43 harness. Reads real state, spends nothing |

## Four things this module refuses to do

**It does not trust the agent's account of its own work.** The changed paths
come from the gateway's record of the writes it brokered; the bytes come from
reading the workspace back; the baseline comes from the pinned commit. An agent
that says "I only changed two files" has made a claim, and `candidate.ts`
counts them.

**It does not let a tool exist for an effect it must not have.** Network, git,
deploy and database access are not denied capabilities — they are absent
methods on `AgentWorkspace`. The globally-forbidden checks in `gateway.ts` are
belt and braces for a stored policy that somehow names one.

**It does not interpolate third-party text into a system prompt.** The Planner's
prose, the customer's decisions and the repository's own facts all go into the
user turn inside a labelled fence. The system prompt is authored in `prompt.ts`
and interpolates only integers.

**It does not produce a verdict.** The agent may run the repository's checks to
fix its own work; the existing `change_validation` operation decides whether the
result is trustworthy. `ValidationAuthority` is a single-value type so that
"the agent reported success" is not representable.

## The honest state of the product

`EXECUTION_BUDGET_POLICIES` is still empty. No customer can start an agent,
because no Agent price has been approved and none can be until there is a
measured cost. `authorization.ts` is the only door to the internal dogfood
economics, and it requires a project id on an operator-managed allowlist.

Run `pnpm agent:preflight` against a real project to see the whole §43 picture —
route, risk, validation profile, granted capabilities, ceilings, and the exact
instruction the agent would receive — without spending anything.

See [ADR 0027](../../../docs/decisions/0027-coding-agent-provider-and-tool-gateway.md)
and [the sprint record](../../../docs/sprints/0040-execution-core4-first-coding-agent.md).
