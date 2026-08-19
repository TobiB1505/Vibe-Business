import type { ExecutionToolCapability } from "@/modules/execution-contract/policy";

/**
 * The coding-agent runtime vocabulary (EXECUTION CORE-4 §5, §10, §17, §34).
 *
 * ## Where this sits
 *
 * ```
 * ExecutionSpec          immutable instruction package        Core-3
 * ─────────────────────── this module ───────────────────────
 * Prompt Compiler        spec → provider-specific instruction  §14
 * CodingAgentProvider    one bounded agent loop                §5
 * Tool Gateway           deterministic default-deny            §10, §11
 * AgentWorkspace         bounded ops inside the sandbox        §8
 * Candidate change       computed by Vibe, never claimed       §27
 * ───────────────────────────────────────────────────────────
 * PreparedChange → ValidationRun → Review → Approval → Merge   existing
 * ```
 *
 * ## The one rule this module exists to enforce
 *
 * Core-3 wrote the policy down. Core-4 is where a policy that lives in a
 * compiled structure has to survive contact with a model that can ask for
 * anything. Every name below is chosen so that the *runtime* refuses, rather
 * than the prompt asking nicely — §11 is blunt that a rule the tool runtime
 * does not enforce is not a rule.
 */

/* ---------------------------------------------------------------------------
 * Versions (§15, §17, §65 of Core-3's validation-identity discipline)
 * ------------------------------------------------------------------------ */

/**
 * What the tool gateway permits and how it enforces it.
 *
 * Separate from `EXECUTION_POLICY_VERSION`, which versions the *spec's*
 * compiled grants. This versions the runtime that brokers them: the tool
 * vocabulary, the command allowlist, the read/write bounds and the denial
 * semantics. A change to either must be visible on a stored run, because
 * together they define what "the agent was bounded" meant.
 */
export const CODING_AGENT_POLICY_VERSION = "coding-agent-policy-v1" as const;

/**
 * The deterministic ExecutionSpec → agent instruction compiler (§14, §15).
 *
 * Recorded on every run. If the compiler changes what an agent is told, two
 * runs of the same spec are no longer the same experiment, and the dogfood
 * economics recorded under v1 must not be read as though they described v2.
 */
export const AGENT_PROMPT_COMPILER_VERSION = "agent-prompt-v3" as const;

/** The CORE-4 dogfood limit set. Explicitly not final customer pricing (§17). */
export const AGENT_BUDGET_POLICY_VERSION = "core4-dogfood-budget-v1" as const;

/* ---------------------------------------------------------------------------
 * Tools (§10)
 * ------------------------------------------------------------------------ */

/**
 * Every tool the gateway will broker, and the effect each one is (§10, §11).
 *
 * ## Why the map exists rather than a bare list
 *
 * Core-3 named capabilities for their *effect* precisely so a Core-4 adapter
 * could not introduce a second name for an already-forbidden effect. This map
 * is where that promise is kept: a tool is not a thing the agent may call, it
 * is a request for one of Core-3's capabilities, and the gateway asks
 * `isToolAllowed` about the capability rather than about the tool.
 *
 * A tool absent from this map has no capability, and a request with no
 * capability is denied — which is what makes "unknown tool → DENY" (§11) a
 * property of the lookup rather than a branch someone has to remember to write.
 */
export const AGENT_TOOL_CAPABILITIES = {
  list_files: "repository_list_files",
  search_repository: "repository_search",
  read_file: "repository_read_file",
  write_file: "workspace_write_file",
  delete_file: "workspace_delete_file",
  run_check: "run_validation_command",
} as const satisfies Record<string, ExecutionToolCapability>;

export type AgentToolName = keyof typeof AGENT_TOOL_CAPABILITIES;

export const AGENT_TOOL_NAMES = Object.keys(AGENT_TOOL_CAPABILITIES) as readonly AgentToolName[];

/**
 * The one tool that is not a capability request.
 *
 * `request_decision` asks Vibe to stop and put a structured question to the
 * customer (§25). It grants nothing, touches nothing and cannot mutate
 * anything — it is the agent's only way to *not* proceed, which is exactly why
 * it must exist: an agent whose only options are "guess" and "fail" will guess.
 *
 * Kept outside `AGENT_TOOL_CAPABILITIES` deliberately. Giving it a capability
 * would mean a policy could grant or revoke the ability to ask for help, and
 * there is no coherent execution in which stopping to ask is forbidden.
 */
export const AGENT_DECISION_TOOL = "request_decision" as const;

export type AgentToolRequestName = AgentToolName | typeof AGENT_DECISION_TOOL;

export function isAgentToolName(name: string): name is AgentToolName {
  return Object.prototype.hasOwnProperty.call(AGENT_TOOL_CAPABILITIES, name);
}

/** The Core-3 capability a tool is asking for, or null when it names no tool. */
export function capabilityForTool(name: string): ExecutionToolCapability | null {
  return isAgentToolName(name) ? AGENT_TOOL_CAPABILITIES[name] : null;
}

/* ---------------------------------------------------------------------------
 * Development commands (§10, §12)
 * ------------------------------------------------------------------------ */

/**
 * The checks an agent may ask Vibe to run, by name (§10).
 *
 * **The agent names a check; Vibe constructs the command.** There is no string
 * anywhere in this system that a model contributes to a command line — the same
 * rule `validation/commands.ts` already states, applied one layer earlier and
 * with less room for exceptions, because the requester here is a model rather
 * than our own generator.
 *
 * `install` is absent, and its absence is a security property rather than an
 * omission. Install is the one step that needs network (Sprint 10A §10), so
 * letting an agent trigger it would hand a model the ability to reopen the
 * registry allowlist at a time of its choosing. Dependencies are installed once
 * by Vibe, before the agent starts, and the network is closed before the agent
 * receives its first turn (§12).
 */
export const AGENT_CHECK_NAMES = ["typecheck", "test", "build"] as const;
export type AgentCheckName = (typeof AGENT_CHECK_NAMES)[number];

export function isAgentCheckName(name: string): name is AgentCheckName {
  return (AGENT_CHECK_NAMES as readonly string[]).includes(name);
}

/* ---------------------------------------------------------------------------
 * Why the gateway said no (§11)
 * ------------------------------------------------------------------------ */

/**
 * Every reason a tool call is refused.
 *
 * A closed set, because these are the sentences a security review reads. Each
 * one is decided from structured state — the compiled policy, a path, a
 * counter, a clock — and none of them is a judgement about what the agent
 * seemed to be trying to do.
 */
export const AGENT_DENIAL_REASONS = [
  /** The name maps to no capability at all. Default deny (§11). */
  "unknown_tool",
  /** A real capability, not granted by this spec's compiled policy. */
  "capability_not_granted",
  /** A capability no policy may ever grant (§11's forbidden list). */
  "globally_forbidden_capability",
  /** The arguments did not match the tool's schema. */
  "malformed_arguments",
  /** The path is outside every execution's read and write scope (§13). */
  "forbidden_path",
  /** Inside scope, but the changed-file ceiling is already reached. */
  "changed_file_budget_exhausted",
  /** Inside scope, but the diff-size ceiling is already reached. */
  "changed_bytes_budget_exhausted",
  /** The read budget for this run is spent. */
  "read_budget_exhausted",
  /** The command budget for this run is spent (§17's repair loops). */
  "command_budget_exhausted",
  /** The run has exceeded its wall-clock ceiling. */
  "wall_clock_exhausted",
  /** The check name is not one Vibe constructs a command for. */
  "unsupported_check",
  /** A question was raised; nothing further may run until it is answered (§25). */
  "run_is_paused",
  /** The run was cancelled (§36). */
  "run_cancelled",
] as const;
export type AgentDenialReason = (typeof AGENT_DENIAL_REASONS)[number];

/* ---------------------------------------------------------------------------
 * How a run ended (§33, §34)
 * ------------------------------------------------------------------------ */

/**
 * The durable status of one agent execution.
 *
 * `succeeded` means one narrow thing and it is worth saying out loud: the agent
 * produced a candidate that passed Vibe's own post-agent verification and
 * entered the existing pipeline. It does **not** mean validated, reviewable,
 * correct or mergeable — those are later, independent verdicts (§33, Rule 66).
 */
export const AGENT_RUN_STATUSES = [
  "queued",
  "running",
  /** Stopped on a structured question, holding its claims (§25). */
  "needs_user_input",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/**
 * Why an agent execution ended without a reviewable candidate (§34).
 *
 * Every one is observable by Vibe without asking the model what happened —
 * the same property Core-3 required of its stop reasons. There is deliberately
 * no `agent_gave_up` and no free-text field.
 */
export const AGENT_FAILURE_CODES = [
  /** The authorized ceiling — Credits, turns, time or provider cost — was reached. */
  "agent_budget_exhausted",
  /** The agent asked for something the compiled policy forbids and could not proceed. */
  "agent_policy_violation",
  /** The produced change failed Vibe's post-agent verification (§28). */
  "agent_change_rejected",
  /** The repository moved away from the pinned base before work started (§54). */
  "agent_source_drift",
  /** The provider failed, or returned an outcome Vibe cannot interpret (§57). */
  "agent_provider_failed",
  /** No isolated workspace could be established, so nothing could run (§8). */
  "agent_workspace_unavailable",
  /** The agent finished having changed nothing. An empty change is not a change. */
  "agent_produced_no_change",
  /** No approved budget policy authorizes agentic execution for this project (§18). */
  "agent_execution_not_authorized",
  /** The repository has no validation profile, so nothing could prove the result (§31). */
  "agent_validation_unsupported",
] as const;
export type AgentFailureCode = (typeof AGENT_FAILURE_CODES)[number];

/**
 * The subset a *durable operation* can fail with (§34).
 *
 * A deliberate subset rather than the whole union. Most agent failure codes are
 * findings about the execution and are recorded on the run; only these four
 * describe something the product has to say to a user in its own vocabulary,
 * because none of the existing operation codes says it. Everything else maps
 * onto a code that already exists — `sandbox_lost` is `sandbox_lost` whether a
 * validation or an agent lost it.
 */
export const AGENT_OPERATION_FAILURES = [
  /** The verified change fell outside policy, so no reviewable change exists (§28). */
  "agent_change_rejected",
  /** The agent finished having changed nothing. An empty change is not a change. */
  "agent_produced_no_change",
  /** No approved budget policy authorizes agentic execution for this project (§18). */
  "agentic_pricing_not_configured",
  /** The bound Credit reservation no longer authorizes this work (§55). */
  "agent_reservation_invalid",
  /**
   * The run outlived the wall clock its budget authorized (ADR 0029, A1).
   *
   * Its own code rather than a generic provider failure, because the two lead
   * somewhere different: a provider failure is Vibe's or Anthropic's problem,
   * and this is the run doing more work than was paid for. It is also the
   * outcome that must exist for a detached harness — nothing else stops an
   * agent that ignores its own ceiling, and a run with no terminal state is the
   * defect the first real run left behind.
   */
  "agent_wall_clock_exceeded",
] as const;
export type AgentOperationFailure = (typeof AGENT_OPERATION_FAILURES)[number];

/* ---------------------------------------------------------------------------
 * What the provider reported (§19, §57)
 * ------------------------------------------------------------------------ */

/**
 * How the agent provider itself ended, before Vibe judged anything.
 *
 * Separate from `AgentFailureCode` because they answer different questions.
 * This says what the provider did; the failure code says what Vibe concluded.
 * Collapsing them would make "the agent finished cleanly and produced an
 * illegal diff" indistinguishable from "the provider fell over", and those have
 * opposite retry semantics (§37).
 */
export const AGENT_PROVIDER_OUTCOMES = [
  "completed",
  /** The provider's own turn ceiling was reached. */
  "max_turns",
  /** The provider's own cost ceiling was reached. */
  "max_cost",
  /** Vibe aborted it — cancellation, wall clock, or a raised interrupt. */
  "aborted",
  /** The provider errored. Usage observed before the error is still recorded. */
  "provider_error",
] as const;
export type AgentProviderOutcome = (typeof AGENT_PROVIDER_OUTCOMES)[number];
