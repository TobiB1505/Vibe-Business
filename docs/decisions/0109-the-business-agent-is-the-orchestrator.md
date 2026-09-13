# 0109 - The Business Agent is the orchestrator

Status: Proposed
Date: 2026-09-13
Extends [0011](0011-ai-inference-and-evidence-trust-boundary.md) (the evidence trust boundary), [0013](0013-durable-operation-execution.md) (durable operations), [0027](0027-coding-agent-provider-and-tool-gateway.md) (the first bounded exception to rule 41), [0030](0030-agent-execution-observability.md) (the trace shape), [0085](0085-nova-is-the-project-home.md) (Nova is Home) and [0086](0086-nova-presentation-is-claimed-stored-and-attempted-once.md) (Nova's one-string voice, which this leaves standing). Would, if accepted, revise CLAUDE.md rules 41, 42, 43 and 47 in place, and would reverse three of the Nova audit's "do not build" positions in the open.

The evidence, the capability inventory, the tool and skill catalogues, the data model and the phased plan are in [the architecture audit of 2026-09-13](../audits/2026-09-13-business-agent-architecture/README.md). This page records only the decision and what it costs. **Nothing here is decided until the status line says so.**

## Context

Vibe Business is a dashboard-driven product with AI features: a founder chooses a feature, opens a page, reads its data, decides, presses, and reviews the result. The capabilities are real and tested — repository and product intelligence, the Business Audit, the Opportunity Engine, the Action Planner, sandboxed agent execution, validation, preview, evidence-bound approval, fast-forward merge, outcome verification, a Credit ledger — and every one is reached through its own screen.

The founder's brief asks for a different product on the same capabilities: one Business Agent a founder talks to, which understands the product, investigates with the systems that exist, explains what matters, recommends the next move, executes with permission, validates, and remembers. The audit found the capabilities reusable behind adapters at roughly four parts in five, and found three things standing in the way that no adapter can route around:

1. **The provider boundary cannot take a turn.** `AIProvider` in `src/modules/ai/provider.ts` has one hard-coded user message, no tools, no streaming and no retries, and each of those is written down as a security property rather than an omission.
2. **Rule 41 forbids giving any inference call a tool**, and admits agentic execution only because it is bounded by three named mechanisms — an isolated VM with no credential, an explicitly named tool set with no network tool, and Vibe's own verification of the result. Its last sentence is aimed at this design: *"It is not a licence to give any other model a tool."*
3. **Nova refuses to be a chat by test and by decision.** `nova-ui.test.ts` asserts no text input and no transcript; the Nova audit's §M lists an agent loop, a chat input and a transcript under **do not build**, and the founder accepted §M as written on 2026-09-03.

Sprint 0215 is the precedent for how such a guard is crossed: not edited green, but narrowed in the open with an argument that what is admitted is bounded.

## Decision

**One orchestrator, under Nova's name, bounded by a triple as strong as the sandbox's.** The decision has seven parts, and the audit's §C is the argument for each.

1. **A founder message is a durable operation.** `agent_turn` runs as a Vercel Workflow (ADR 0013, rule 49). Each model call is one step with `maxRetries = 0` (rule 50). Only identifiers cross a step boundary; the transcript, the tool results and the reply are persisted inside the step that produced them and read back by the next (rule 52). Progress is polled through the existing hook; no second liveness mechanism is introduced (rule 24).

2. **`AIProvider` gains one method, `generateWithTools`, that performs exactly one turn.** `StructuredRequest` stays structurally tool-free, so the five shipped operations keep the property ADR 0011 gave them. The loop lives in `src/modules/business-agent/`, as every operation's pipeline lives in its own module today. Only `src/modules/ai/anthropic/` touches the SDK (rule 40); only `src/modules/operations/business-agent/` calls the new method. Whether native tool use or a structured-output loop is the better seam is measured on the Nova eval instrument, forked to grade trajectories, before this status line changes.

3. **The bounding triple, which is what makes this a second exception to rule 41 rather than a breach of it:**
   - *Absent capability.* The tool set is a closed `as const` union of read-only and preparation tools. No tool writes to a repository, moves money, starts a paid operation, opens a connection to a customer URL, runs a command, composes a query, or names a model. There is nothing to grant, revoke or get wrong (rule 76).
   - *Arguments are requests; the runtime's check is the fact.* Every identifier the model supplies is sanitized and resolved against the project's own rows — the `?plan=` rule of ADR 0058 — and the project id comes from the persisted operation row, never from the model (rule 53).
   - *Vibe verifies what the founder reads.* A reply is validated deterministically before it is persisted: no banned or causal claim, no number absent from this turn's tool results, no artifact reference a tool did not return (rule 45). A refused reply is replaced by a template and recorded as such.

4. **The model proposes; the founder presses.** Every consequential action — an audit, a plan, a scan, a Deep Scan, an agent run, validation, preview, approval, merge — remains a control that states its price and calls the Server Action that owns its admission (ADR 0094, rule 60, rule 67, rule 70). The agent renders offers; it holds no tool that could take one. A press is recorded in the conversation as the founder's own message.

5. **Conversations are persisted, and are authoritative for what was said and for nothing else.** Four tables — conversations, messages, artifact references, turn runs with their tool calls — shaped on the agent-execution trace of ADR 0030, select-only under RLS through project ownership, written only from the operations module. Artifacts are references to canonical rows, never copies. What is true about the project stays derived from rows on every read; the focus ranking (`deriveNovaFocus`) is still the source of "what needs attention now" and opens every conversation as a deterministic, free system message.

6. **Skills are Vibe-authored procedures the model loads by name**, indexed in the system prompt and returned by a `use_skill` tool. They are instructions we wrote (rule 42) and are versioned as one registry. Nothing repository- or website-derived is ever a skill.

7. **The turn is `free` in `launch-v1`, with hard budgets in code, until its cost is measured.** Per-call token ceilings, per-turn model-call and tool-call ceilings, a wall clock, start limits, the kill switch, a token count before every call and one usage row per call (rule 47). A customer price waits for the measurement rule 78 demands.

## Consequences

**What becomes possible.** "What should I work on next?", "Why aren't people signing up?", "Fix this", "Did it work?" — answered from the systems that exist, with their evidence, their prices and their approvals, in one thread, with the answer's provenance stated. The dashboard's pages become drill-downs from what the agent says rather than the places a founder must already know to go.

**What it costs, named rather than absorbed.**

- *Four rules are rewritten in place* (rule 83 forbids renumbering): 41 gains its second exception with the triple above; 42 names tool results and founder turns as third-party content; 43 admits a validated, bounded assistant message as the structured conclusion of a turn while still forbidding reasoning; 47 reads "every paid call" as every call of a loop. `src/modules/ai/README.md`'s "No tools, ever" and `provider.ts`'s "No tools" become false and are corrected by the same change.
- *Two Nova tests are narrowed in the open.* Exactly one file may hold a `<textarea>`, and a second test proves it is the composer, bounded by a shared constant — the Sprint 0215 shape. "Keeps no transcript" becomes "the transcript decides no state".
- *`ai_usage_events_job_idx`* must exempt `agent_turn` as it exempts `agentic_execution`, or the second call of every turn fails; `usage-cardinality.test.ts` asserts both halves.
- *Latency.* A durable turn costs a Workflow start plus a hop per step, and the founder waits on named stages rather than streamed tokens. That is measured in the first dogfood; streaming would be its own ADR under rule 24.
- *Vibe pays for turns.* A free turn with budgets is a cost centre until it is priced; the budgets are the ceiling on that, and the measurement is what turns it into a price.

**What this does not change.** The coding agent still runs in its sandbox with its own tool set and its own gateway (ADRs 0027, 0029, 0070); `execution_interrupts` still admits one open question per run and is still not a chat; approvals still bind to one commit; merges still fast-forward or refuse; no model output selects a path, a branch, a commit message or a model; the audit, the Moves, the plan and the profile are still the only sources of their own conclusions, and the agent carries them rather than rewriting them.

**What would falsify it.** A dogfood turn that a founder cannot read because it waited too long; a validator refusal rate that makes template replies the common case; a measured turn cost that no price could carry at the margin floor; or a trajectory eval in which the model does not reliably choose the tools its skill names. Each is a number the plan's first three phases produce before anything customer-facing ships.

## Status of the code

Nothing is implemented. `src/modules/business-agent/` does not exist. `AIProvider` has two methods. Nova has no composer. The audit's §H names the exact files of the first slice, and §J the order.
