# 0027 - Agentic Coding: Provider Abstraction, Tool Gateway, and Independent Validation

Status: Accepted; §2 and §3 amended by [0029](0029-agent-runtime-placement-and-credential-broker.md)
Date: 2026-08-18
Builds on [0005](0005-ai-provider-abstraction.md), [0006](0006-untrusted-repository-execution.md), [0011](0011-ai-inference-and-evidence-trust-boundary.md), [0013](0013-durable-operation-execution.md), [0014](0014-first-execution-safety.md), [0015](0015-untrusted-repository-execution-provider.md), [0026](0026-agentic-execution-contract.md)

## Context

ADR 0026 wrote the contract: an immutable `ExecutionSpec`, a compiled policy with a default-deny predicate, a Credit ceiling, a validation requirement, a closed set of stop reasons and interrupt situations. It deliberately built no agent. Its own module README says so plainly: *"No agent SDK, no model call, no tool runtime, no file editing, no repair loop, no execute button."*

That left the question this ADR answers: **what does it take to connect a real coding agent to that contract without any of the contract's guarantees becoming advisory?**

Three things make the answer non-obvious.

**An agent SDK is a harness with opinions.** The Claude Agent SDK is Claude Code packaged as a library. Its defaults are built for a developer running it on their own machine: a full built-in tool set (`Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`), inherited process environment, filesystem settings discovery, and an on-disk session transcript. Every one of those is wrong here, and three of them are actively dangerous — a `Bash` tool on Vibe's own server is a remote code execution vulnerability, an inherited environment hands the subprocess the Supabase service-role key and the GitHub App private key, and a persisted transcript is a durable record of model reasoning and customer source that rule 43 forbids keeping.

**A prompt is not a control.** ADR 0026 §13 already said this, and Core-4 is where it has to survive contact with a model that can ask for anything. A policy the tool runtime does not enforce is a request.

**Repository content is untrusted, and this model has hands.** Rules 25 and 36 already say repository and website content is data rather than instructions. Every prior AI operation in this codebase had *no tools*, so obedience to an injected instruction achieved nothing. This one has six.

## Decision

### 1. Agentic coding is a provider-neutral `CodingAgentProvider`, with Claude as the first and only adapter

`src/modules/coding-agent/provider.ts` defines the boundary; `src/modules/coding-agent/claude/adapter.ts` is the only file in the codebase that imports `@anthropic-ai/claude-agent-sdk`. This is the same rule ADR 0005 draws for `AIProvider` and ADR 0015 draws for `SandboxProvider`, and it is asserted by a test rather than left to discipline.

The familiar reason applies: the execution domain must not learn a vendor's vocabulary, so the tool gateway — where every security decision lives — is testable against a fake, with no network, no API key and no bill.

There is an additional reason specific to agents. Turn accounting, cancellation semantics, session identity, usage reporting and whether a tool error ends the run all differ between harnesses, and Vibe has policy about all of them. Naming them in the interface forces a second adapter to answer the same questions rather than quietly bringing its own answers.

One adapter is implemented. No speculative second provider.

### 2. The agent runs in Vibe's trusted process; only the workspace is in the sandbox

> **Amended by [ADR 0029](0029-agent-runtime-placement-and-credential-broker.md).** This
> topology could not run: `query()` spawns a native `claude` binary of 307-325 MB and a
> Vercel function's whole deployment budget is 250 MB. The harness now runs inside the
> execution's own sandbox and samples through a Vibe-operated gateway that injects the
> Anthropic key outside the VM. The four overridden defaults below still hold, and 0029
> adds a fifth. The section is kept as written because the reasoning about *why* each
> default is wrong is what carried over.

```
Vibe server process                                    TRUSTED
├── the tool gateway            (holds the policy)
├── Claude Agent SDK  ──spawns──▶ Claude Code CLI       TRUSTED
│                                 (holds the Anthropic key; has NO tools)
└── in-process MCP tool server ──▶ ExecutionToolGateway
                                          │
                                          ▼
                                     Sandbox VM        UNTRUSTED
                                     (customer repository, its dependencies, its build)
```

The built-in tool set is emptied (`tools: []`) and the only tools that exist are in-process MCP tools whose handlers call the gateway. Those handlers run **inside the Vibe process**, so the provider credential and the tool policy stay on the trusted side of the line, and the customer's code never shares an address space with either.

Four SDK defaults are overridden explicitly, and each is load-bearing:

| Default | Why it is wrong here | What Vibe sets |
| --- | --- | --- |
| the Claude Code tool preset | a filesystem and shell agent on Vibe's own server | `tools: []` |
| inherit `process.env` | hands the subprocess every secret this application holds | an explicit allowlist |
| load filesystem settings | a customer's `CLAUDE.md` is untrusted data, never configuration | `settingSources: []` |
| persist the session to disk | a durable record of reasoning and customer source | `persistSession: false` |

### 3. Every effect passes through one gateway, which refuses by lookup

> **Amended by [ADR 0029](0029-agent-runtime-placement-and-credential-broker.md) §4-§5.**
> With the harness inside the sandbox the agent writes with its own tools, so the gateway
> is no longer the only door. What replaces it: the change set is observed off the
> filesystem by Vibe's own commands, and write-scope enforcement moves from prevention to
> `verifyCandidateChange`'s refusal, which always had the last word.

`ExecutionToolGateway` is the only holder of an `AgentWorkspace`, and `AgentWorkspace` is the complete set of effects an agent can have — not the subset exposed today, the whole set. There is no generic `exec`, no `fetch`, no git operation and no way to name a machine.

A tool name that maps to no capability is denied. Not by a branch someone has to remember to write — by the absence of a key in `AGENT_TOOL_CAPABILITIES`, which means forgetting to add a check produces a denial rather than an allow.

Three consequences follow from that shape:

- **Network, git, deploy and database access are absent rather than denied.** There is no method to grant, revoke or get wrong.
- **Commands are named, never supplied.** The agent picks a check from a closed set; `validation/commands.ts` builds the command. No model contributes a character to a command line.
- **Reads and writes have different rules.** `package.json` is readable — knowing the framework and the scripts is ordinary orientation — and unwritable, because editing it is a supply-chain change. The same asymmetry covers lockfiles, CI definitions, the Next.js config, middleware and migrations.

### 4. Vibe computes the change; the agent's account of it is never consulted

After the agent stops, the changed paths come from the gateway's own record of the writes it brokered, and the bytes come from reading the workspace back. The baseline comes from the pinned commit through GitHub, which the agent never touched.

A file written back byte-identical to its base is not a change and is dropped. A path the agent claims to have written that is not on disk is not a change either.

The resulting candidate is then checked against the compiled policy — paths, file count, diff size, credential-shaped content, source identity — and only then does the existing `PreparedChange` machinery write a branch, deriving the ref name, the commit message and every path deterministically.

### 5. The agent's own checks are advisory; Vibe's validation is authoritative

The agent may run the repository's typecheck, tests and build to fix its own work, and those results are useful to the loop. They are not a verdict.

After the agent stops, the existing `change_validation` operation runs from scratch against the prepared commit — the same pipeline, the same profile, the same sandbox policy that Sprint 10A built. `sandbox_validation_passed` continues to mean exactly what rule 66 says it means and nothing more.

This distinction is enforced structurally: `ValidationAuthority` is a single-value type (`"vibe_observed"`), so "the agent reported success" is not representable.

### 6. The agent never receives merge, deploy or default-branch authority

`git_push_branch`, `git_force_push`, `git_write_default_branch`, `git_merge`, `deploy`, `secret_read`, `external_side_effect` and `database_write` are in ADR 0026's globally forbidden set. Core-4 changes nothing about that and adds a second guarantee: none of them is a tool, so none is requestable.

Trusted Vibe infrastructure creates the branch and the commit, after the change has passed policy verification. Merge remains what ADR 0019 made it: a fast-forward to one exact human-approved commit, authorized by both immutable intent and freshly-read external state.

### 7. No production Agent price is activated

Vibe has never run an agent, so there is no measured cost, so there can be no honest price. `EXECUTION_BUDGET_POLICIES` stays empty and `retail.ts` continues to omit Agentic Execution.

What Core-4 adds is a separate, explicitly internal book — `credits/internal.ts` and `EXECUTION_DOGFOOD_BUDGET_POLICIES` — reachable only for a project named on an operator-managed allowlist. A customer project resolves to no economics and is refused before anything is queued.

That is not billing theatre. It exercises the whole path — quote, reservation, real usage, settlement or release — so the machinery is proven before a price exists, and it puts a hard ceiling on a dogfood that would otherwise be the one operation in this product with no spending limit at all.

### 8. Usage is metered from tokens, through Vibe's own cost book

The Claude Agent SDK reports a per-model `costUSD`, and its own type documentation calls it *"an estimate, not a billing statement"*. It is carried alongside the token counts and never used as the ledger figure.

Cost is computed from reported tokens through `ai/pricing.ts` — the same effective-dated, integer-nanodollar book every other paid call uses — extended in this sprint with cache read and cache write rates, because an agent loop re-sends a growing transcript every turn and cache tokens are the majority of its input bill.

Sandbox usage goes to `sandbox_usage_events` with `provider_cost_usd` null, because Vercel exposes no attributable per-sandbox amount. Unknown stays unknown.

## Consequences

**Easier.** One general path now covers individualized customer code changes, so the product no longer needs a capability per customer request. The safety pipeline downstream of the agent is entirely unchanged — `PreparedChange`, `ValidationRun`, `ReviewArtifact`, `ChangeApproval`, safe merge — so agentic output inherits four sprints of guarantees rather than needing its own.

**Harder.** The tool surface is deliberately narrow, and widening it is now a visible change to a compiled policy with a version on it. An agent cannot install a dependency, edit a config, or touch CI, so a change that genuinely needs one of those fails rather than being accommodated. That is the intended trade in V1.

**Foreclosed for now.** Deletions cannot be written: `github-writer.ts` builds a tree additively and its port has no operation that removes an entry, so a candidate containing a deletion is refused rather than written incompletely. Teaching the git writer to remove tree entries is a change to the most consequential write path in the product and belongs in its own sprint.

**A deployment dependency worth naming.** The Claude Agent SDK spawns the bundled Claude Code CLI as a subprocess. That is fine in a long-lived Node process and unproven inside a Vercel durable step. The provider abstraction is what makes this recoverable: if the subprocess topology does not survive the platform, a second adapter implementing `CodingAgentProvider` over the Messages API tool-use loop is a contained change, and nothing above the boundary moves.

**What this ADR does not decide.** Whether an agent may ever be given a wider write scope, a second model, a browser, or the ability to run more than one at a time. All four are deliberately absent, and each is its own decision with its own evidence requirement.
