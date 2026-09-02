
/**
 * Durable step bodies for agentic execution (EXECUTION CORE-4 §21, §22, §36, §37).
 *
 * ## The step graph, and why the boundaries fall where they do
 *
 * ```
 * prepare ─▶ provision ─▶ run agent ─▶ extract ─▶ write branch ─▶ cleanup ─▶ settle
 *    │           │            │           │            │             │
 *    │           │            │           │            │             └─ always runs
 *    │           │            │           │            └─ the only GitHub write
 *    │           │            │           └─ Vibe computes the diff, never the agent
 *    │           │            └─ the paid loop. maxRetries = 0, always.
 *    │           └─ provisions a billed microVM. maxRetries = 0.
 *    └─ reserves Credits. Nothing is spent before this returns.
 * ```
 *
 * Each phase is its own durable step for the reason the validation refactor
 * records: a pipeline inside one step races one platform ceiling, and the run
 * that hits it leaves a paid VM alive with nothing responsible for it.
 *
 * ## The two ambiguities this file refuses to resolve optimistically (§37)
 *
 * **A re-entered agent step.** `markAgentRunStarted` is scoped to `queued`, so
 * a step that finds the run already `running` knows a provider call may have
 * been made and its outcome lost. It does not run a second agent. It fails the
 * run as `agent_provider_failed` and lets a person decide, because the cheap
 * wrong answer here costs a whole agent execution.
 *
 * **A re-entered branch write.** The prepared change is claimed before the
 * write, so a re-entry finds a row and adopts the branch through
 * `prepareChangeOnBranch`'s own recovery path rather than creating a second one.
 *
 * ## What this file does not do
 *
 * It does not validate. Validation is the existing `change_validation`
 * operation, run afterwards against the PreparedChange this produces — §31 and
 * §32 are explicit that the agent's own checks are advisory and Vibe's are
 * authoritative, and the way to keep that true is for the agent's pipeline to
 * have no verdict in it at all.

/**
 * ## Why this file is now a barrel
 *
 * It was 2,847 lines holding every step body. The steps are the boundaries the
 * graph above already draws, so the split follows them rather than inventing
 * new ones, and `steps/shared.ts` holds what crosses one.
 *
 * The re-exports are not ceremony. Eleven symbols are imported from here — by
 * `workflow.ts`, three suites and one concurrency probe — and no importer ever
 * reached for an internal helper, which is what made this a pure move: nothing
 * outside the module changed, so the diff carries no behaviour.
 *
 * Six types that used to be exported are not re-exported, because nothing
 * outside the file imported those either.
 */

export type { AgentExecutionDeps, AgentRepositoryTarget } from "./steps/shared";
export { provisionAgentWorkspaceStep } from "./steps/provision";
export { startAgentStep } from "./steps/start";
export { collectAgentStep, pollAgentStep } from "./steps/observe";
export { extractAndVerifyStep } from "./steps/verify";
export { writeAgentBranchStep } from "./steps/branch";
export {
  cleanupAgentWorkspaceStep,
  enqueueValidationStep,
  finishAgentExecutionStep,
} from "./steps/finish";
