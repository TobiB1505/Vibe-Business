# 0029 - Agent Runtime Placement: the Harness in the Sandbox, the Key Behind a Gateway

Status: Accepted
Date: 2026-08-18
Amends [0027](0027-coding-agent-provider-and-tool-gateway.md) §2 and §3
Builds on [0011](0011-ai-inference-and-evidence-trust-boundary.md), [0013](0013-durable-operation-execution.md), [0015](0015-untrusted-repository-execution-provider.md), [0026](0026-agentic-execution-contract.md)

## Context

ADR 0027 §2 decided that the agent harness runs in Vibe's trusted process and only the workspace is in the sandbox. It was a coherent design and it is the one this codebase implemented. It could not run.

The first real agentic execution failed after **44 milliseconds having taken zero turns**, with a customer-facing message that said the AI provider could not be reached. The cause was not policy, credentials or the network. `@anthropic-ai/claude-agent-sdk` does not make HTTP requests itself: `query()` spawns a native `claude` binary, and that binary is **307–325 MB depending on platform** (from the package's own `manifest.json`). A Vercel function's entire deployment budget is 250 MB. The harness was never going to start in a function, on any plan, under any configuration.

That is a hosting fact, not a bug to fix. So the question became where the harness *can* run, and what must not follow it there.

Three constraints shaped the answer.

**A sandbox that executes a customer's repository is the last place Vibe's Anthropic key may be.** ADR 0015 already says untrusted repository code runs only in an isolated provider and carries no credential. Moving the harness into that VM would, done naively, move the provider key into it — where a `postinstall` hook, a test file or an injected instruction could read it. The key is not scoped to a customer, a project or a spend limit; it is the account.

**Anthropic documents the shape this needs.** *Secure deployment* → the proxy pattern and *Hosting the Agent SDK* → auth and secrets both describe running a proxy outside the agent's boundary that injects the credential, with the subprocess pointed at it through `ANTHROPIC_BASE_URL`. This was verified against the current published guidance rather than recalled. (Vercel's own "Using Vercel Sandbox to run Claude's Agent SDK" guide could not be read from this environment — `vercel.com` is blocked by the egress proxy — so the sandbox half is implemented against the `@vercel/sandbox` integration this repository already runs for validation, not against that document.)

**Moving the harness moves the writes.** ADR 0027 §3 made the tool gateway the only door, which is what made its record of brokered writes authoritative for "which paths changed". An agent with real `Write`, `Edit` and `Bash` tools inside a VM has no such door.

## Decision

### 1. The Claude Agent SDK runs in the execution's own ephemeral sandbox

Not in a Vercel function, and not in any Vibe process. One sandbox per execution, with its own workspace and its own `CLAUDE_CONFIG_DIR`, torn down when the run ends.

```
Vibe (trusted)                          Agent sandbox (untrusted)
────────────────────────────────────    ─────────────────────────────────────
ExecutionSpec, policy, Credits          Claude Agent SDK + native binary
GitHub App credential                   the customer's repository at baseSha
Supabase service role, Stripe           Read / Write / Edit / Glob / Grep / Bash
ANTHROPIC_API_KEY  ◀── injected here    ANTHROPIC_BASE_URL ─▶ Vibe Agent Gateway
branch write, validation, approval      a short-lived, execution-scoped token
```

Inside its workspace the agent may read, write and edit files and run local build and test commands. That capability is the reason the runtime moved: a shell is precisely what must not exist on Vibe's own machine, and is unremarkable inside a microVM that holds nothing.

This **amends ADR 0027 §2**. The four SDK defaults that ADR named remain overridden and remain load-bearing — `settingSources: []`, `persistSession: false`, an explicit environment, and an explicit tool set — with one addition the move makes necessary: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, because auto memory loads *regardless* of `settingSources`, and the harness now runs inside the customer's own tree, which is exactly where a `CLAUDE.md` lives (rule 25).

The tool set is named explicitly rather than taken from the Claude Code preset, which would add `WebFetch` and `WebSearch`. Rule 41 stands unchanged: removing the capability is what bounds prompt injection, not asking the model nicely.

### 2. Sampling is brokered by a Vibe-operated Agent Gateway; the sandbox never holds a provider key

`POST /api/agent-gateway/v1/messages` is the one place in this product where a request from an untrusted VM becomes a request carrying Vibe's real Anthropic key. The sandbox is given `ANTHROPIC_BASE_URL` pointing at it and a short-lived, execution-scoped token — never `ANTHROPIC_API_KEY`, and never a GitHub, Supabase, Stripe or deployment credential.

The token is authorized by the two-authority shape ADR 0019 requires before a merge, applied one layer down:

| Authority | Answers | Source |
| --- | --- | --- |
| the signature | did Vibe issue this token, for this route and this model? | HMAC over self-describing claims |
| durable state | is the run still live, and is the budget still unspent? | read fresh on **every** request |

A signature is fixed at minting time and cannot answer the second question, because cancellation and spend both happen afterwards. So the gateway re-reads the run row and the usage ledger on every request, and refuses if either says no. **Cancelling a run is therefore a real revocation**: the next sampling call is refused because of it.

The bindings enforced before the key is touched: execution identity, project, user, spec, model, route, request count, output-token ceiling, expiry. A refused caller is told none of them — it is a VM running somebody's repository under a model that reads it, so a refusal naming the failing binding would be a probing oracle.

There is no development bypass and no debug flag. A verification step that configuration can disable is an open proxy in front of a real credential.

The gateway's ceilings are deliberately looser than the Credit budget. The budget is the authority on what a customer authorized and the harness's own `maxBudgetUsd` and `maxTurns` are what stop a run at it; the gateway's are a *containment* bound on what a token found inside a sandbox can do. A containment bound that cut a legitimate run short would look exactly like a provider outage.

### 3. Bootstrap egress and execution egress are separate windows

```
1. create at baseSha         network: github only
2. verify the commit         Vibe's command, not theirs
3. destroy .git              the clone credential stops existing
4. narrow to the registry    github revoked
5. install dependencies      --ignore-scripts; the only networked step
6. install the harness       same window, pinned version, --ignore-scripts
7. narrow to the gateway     the registry is revoked before the agent exists
```

Step 7 replaces `deny_all` for this operation and only for this operation: exactly one host survives, and the token that reaches it authorizes one route on one execution. Leaving the registry reachable during the run would be a package publish away from an exfiltration channel.

The **validation sandbox is untouched and remains maximally restrictive** — `deny_all` before any repository-controlled command, no exceptions. Validation is what proves a change; a validation that could reach the network would prove less.

### 4. The change set comes from the filesystem, observed by Vibe

There is no broker to ask any more, so the answer comes from the only other source that is not the model: a marker planted after both installs and immediately before the first turn, a pruned file listing taken at the same moment, and a second listing plus `find -newer` after the agent stops.

```
added     in the second listing, not the first
deleted   in the first, not the second
modified  in both, and newer than the marker
```

This is strictly *more* trustworthy than the gateway's record was, not less. The record held what the gateway was asked to do; this holds what is actually on disk — a file written through a shell command, a file a test run regenerated, a file written and then deleted are all visible here and were invisible there.

Rule 77 is unchanged and unweakened: the agent's account of its own work is never read. The runtime protocol has no field for a summary, a final message or a list of changed files, so there is nothing to be tempted by.

An observation that might be incomplete — a walk that failed, a tree that hit the path cap — fails the run rather than preparing a partial change. "We found these files" and "these are the files" are different claims, and only the second may become a diff a person is asked to approve.

### 5. Write-scope enforcement moves from prevention to refusal, and the refusal is authoritative

Under ADR 0027 the gateway denied an out-of-scope write before it happened. It now happens inside the VM and is caught afterwards by `verifyCandidateChange`, which already existed and was already authoritative. A change outside the compiled policy's write scope fails the run and reaches no branch.

This is a real reduction in defence depth and is recorded as such rather than glossed. What makes it acceptable: the write lands in an ephemeral VM holding no credential, with no network but one proxy; the verification that refuses it is the same one that always had the last word; and nothing outside the write scope has ever been able to reach a customer's repository, which is the property that matters.

### 6. The agent SDK is a devDependency

Nothing in production imports it. Keeping 325 MB in the deployed function is what broke the first run, and a build that re-wires the in-process adapter back into production now fails loudly on a missing dependency instead of deploying and dying at run time.

`coding-agent/claude/adapter.ts` is kept rather than deleted: it still documents the `gateway_tools` topology, which the tool gateway's own tests exercise.

## Consequences

**The sandbox can spend its own run's budget, and nothing else.** The gateway token sits on the environment of the `node` command, so repository-supplied build and test commands the agent runs inherit it. This is accepted rather than overlooked: the worst a hostile repository can do with it is spend the budget its own execution already authorized. It is the reason the token is scoped the way it is instead of being an API key.

**Two new required environment variables.** `VIBE_AGENT_GATEWAY_ORIGIN` and `VIBE_AGENT_GATEWAY_SECRET`. Without both, the gateway refuses every request and an agent run fails at provisioning — before it buys a VM. The origin is configured, never derived from `VERCEL_URL`: it becomes the sandbox's entire egress allowlist, so a wrong value is both a wrong destination and a hole in the network policy.

**Rotating the signing secret is an emergency stop.** It invalidates every token in flight.

**A run now pays for one more install.** The harness is fetched per execution. A shared snapshot would amortise it and is deliberately not built yet — a snapshot is a filesystem that outlives a run, and that is its own decision.

**What this ADR does not change.** The ExecutionSpec, the compiled policy, the Credit reservation and settlement, the branch write, Vibe's independent validation, the review artifact, human approval and the merge preflight are all exactly as ADRs 0026, 0027, 0018 and 0019 left them. This is a runtime-placement correction, not a redesign — the agent still authorizes nothing, still writes only to an isolated branch, and still has no path to a default branch.

**Still open.** The first real end-to-end run has not happened. Until one does, "this topology works" is a claim supported by tests and reasoning rather than by a customer's repository, a real turn and a settled reservation.
