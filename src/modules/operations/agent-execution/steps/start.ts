import "server-only";
import {
  AgentExecutionDeps,
  StepOutcome,
  recordLifecycle,
  recordWorkspaceFailure,
  loadAgentRunContext,
} from "./shared";
import { checkBudgetMatchesScope } from "@/modules/coding-agent/budget";
import {
  captureWorkspaceBaseline,
  plantChangeMarker,
} from "@/modules/coding-agent/sandbox-runtime/changes";
import { agentToolDescriptors, compileAgentInstruction } from "@/modules/coding-agent/prompt";
import type { ExecutionBrief } from "@/modules/execution-context/brief";
import {
  completionBudgetFor,
  loadAgentVerificationPlan,
  loadExecutionBrief,
} from "@/modules/execution-context/service";
import {
  toSandboxPolicy,
  type AgentVerificationPlan,
} from "@/modules/execution-context/verification";
import { toSandboxCompletionPolicy } from "@/modules/execution-context/completion";
import { assertPolicyConsistency } from "@/modules/execution-context/policy";
import type { AgentCheckName } from "@/modules/coding-agent/schema";
import { markAgentRunStarted, recordAgentRunObservations } from "@/modules/coding-agent/store";
import { setOperationStage } from "../../store";
/* ---------------------------------------------------------------------------
 * Step 2a — start the harness, and return (§37, ADR 0029 A1)
 * ------------------------------------------------------------------------ */

/**
 * Launches the agent and finishes in seconds.
 *
 * ## Why this is not "run the agent"
 *
 * Because the first real run was killed doing exactly that. It reached
 * Anthropic 27 times over five minutes and the platform ended the step at 300
 * seconds — with the harness still working, the run row still reading
 * `turns: 0`, the reservation still held and the sandbox still alive.
 *
 * The budget promises twenty minutes of agent work. No Vercel step can hold a
 * connection open that long, and lowering the budget to fit would be answering
 * a platform constraint by giving the customer less. So the harness is
 * detached: this step starts it and returns, and short polling steps watch it.
 *
 * ## The marker, and why it is planted here
 *
 * Immediately before the first turn, after both installs, so an install
 * artifact is never mistaken for the agent's work. The baseline listing is
 * taken at the same instant and left *in the sandbox*, because the step that
 * will compare against it does not exist yet.
 */
export async function startAgentStep(
  deps: AgentExecutionDeps,
  operationId: string,
  availableChecks: readonly AgentCheckName[],
): Promise<StepOutcome<{ paused?: boolean }>> {
  const loaded = await loadAgentRunContext(deps, operationId);
  if (!loaded.ok) return loaded;
  const { context } = loaded;

  const mismatches = checkBudgetMatchesScope({
    budget: context.spec.spec.budget!,
    policy: context.spec.spec.policy,
  });
  if (mismatches.length > 0) {
    console.error("[agent-execution] budget and write scope disagree", { mismatches });
    return { ok: false, failureCode: "change_preparation_failed" };
  }

  /*
   * The paid-call guard, and the reason a retry cannot buy a second agent.
   *
   * Scoped to `queued`, so the second entrant reports false. Taken *before* the
   * harness is launched rather than after, because the ambiguity §37 forbids
   * resolving optimistically is "did a provider call already happen", and the
   * only safe order is to claim first.
   */
  const claimed = await markAgentRunStarted(deps.supabase, context.run.id);
  if (!claimed) return { ok: false, failureCode: "inference_interrupted" };

  await setOperationStage(deps.supabase, { operationId, stage: "running_agent" });

  await recordLifecycle(deps, context.run, "agent_started", "Started working on the change", {
    model: context.run.model,
    maxWallClockMs: context.limits.maxWallClockMs,
    maxSdkIterations: context.limits.maxTurns,
  });

  const baseline = await captureWorkspaceBaseline({
    sandbox: context.sandbox,
    cwd: context.paths.workspaceCwd,
    baselinePath: context.paths.baselinePath,
  });
  if (!baseline.ok) {
    await recordWorkspaceFailure(deps, context.run, baseline);
    return { ok: false, failureCode: "sandbox_lost" };
  }

  const marker = await plantChangeMarker({
    sandbox: context.sandbox,
    markerPath: context.paths.markerPath,
  });
  if (!marker.ok) {
    await recordWorkspaceFailure(deps, context.run, marker);
    return { ok: false, failureCode: "sandbox_lost" };
  }

  /*
   * What Vibe already knows that bears on this step (EXECUTION CONTEXT
   * INTELLIGENCE, PART D).
   *
   * Wrapped, and null on any failure. A brief is an optimisation over an
   * execution that already worked without one: an unreadable snapshot must cost
   * this run its briefing, never its run. `loadExecutionBrief` is scoped by the
   * project id on the persisted run row, because this is the service-role
   * client and RLS is not doing the scoping (Rule 53).
   */
  const contextInput = {
    supabase: deps.supabase,
    projectId: context.run.projectId,
    spec: context.spec.spec,
  };

  let brief: ExecutionBrief | null = null;
  let verification: AgentVerificationPlan | null = null;
  try {
    [brief, verification] = await Promise.all([
      loadExecutionBrief(contextInput),
      loadAgentVerificationPlan(contextInput),
    ]);
  } catch (error) {
    console.error("[execution-context] the brief could not be compiled", {
      operationId,
      agentExecutionRunId: context.run.id,
      detail: error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown",
    });
  }

  const completionBudget = completionBudgetFor(verification);

  /*
   * Do Vibe's two policies contradict each other? (PART M)
   *
   * Run #7's LOW plan required a diff review and its completion budget refused
   * every attempt at one. Both were internally consistent; nothing compared
   * them, so whichever check ran first won. This compares them before the
   * harness starts, and a contradiction is a bug in Vibe's own configuration
   * rather than a customer's situation — so it is logged loudly and the run
   * continues under the safer of the two, exactly as it would have without a
   * plan at all.
   */
  if (verification && completionBudget) {
    try {
      assertPolicyConsistency(verification, completionBudget);
    } catch (error) {
      console.error("[execution-context] trusted policies contradict each other", {
        operationId,
        agentExecutionRunId: context.run.id,
        detail: error instanceof Error ? error.message.slice(0, 300) : "unknown",
      });
    }
  }

  const instruction = compileAgentInstruction({
    spec: context.spec.spec,
    limits: context.limits,
    availableChecks,
    brief,
    verification,
    completion: completionBudget,
  });

  /*
   * The plan, recorded before the harness can act on it (Sprint 0042).
   *
   * Written from the compiled plan rather than re-derived later, for the same
   * reason the context counts are: a stored run has to say what it was actually
   * told, and observability that recomputes its own inputs eventually disagrees
   * with the run it is describing.
   */
  if (verification) {
    await recordAgentRunObservations(deps.supabase, context.run.id, {
      verificationMode: verification.mode,
      verificationPlanVersion: verification.planVersion,
    });

    if (completionBudget) {
      await recordAgentRunObservations(deps.supabase, context.run.id, {
        completionBudgetVersion: completionBudget.budgetVersion,
      });

      await recordLifecycle(
        deps,
        context.run,
        "completion_budget_compiled",
        `Completion budget: ${completionBudget.mode}`,
        {
          budgetVersion: completionBudget.budgetVersion,
          mode: completionBudget.mode,
          implementationStabilisationCalls: completionBudget.implementationStabilisationCalls,
          maxCompletionActions: completionBudget.maxCompletionActions,
          maxOutsideBriefReads: completionBudget.maxOutsideBriefReads,
          maxConvergenceWindows: completionBudget.maxConvergenceWindows,
          maxRepairCycles: completionBudget.maxRepairCycles,
          maxCompletionWallClockMs: completionBudget.maxCompletionWallClockMs,
        },
      );
    }

    await recordLifecycle(
      deps,
      context.run,
      "verification_plan_compiled",
      `Checking plan: ${verification.mode}`,
      {
        mode: verification.mode,
        planVersion: verification.planVersion,
        required: verification.requiredChecks.join(", "),
        allowed: verification.allowedChecks.join(", ") || "none",
        forbidden: verification.forbiddenChecks.join(", ") || "none",
        maxCommands: verification.maxVerificationCommands,
        maxWallClockMs: verification.maxVerificationWallClockMs,
      },
    );
  }

  /*
   * Recorded before the harness starts, from what was actually compiled.
   *
   * `instruction.context` describes the bytes that went into the prompt rather
   * than what a brief would render to if asked again later — observability that
   * re-derives what a run was given eventually disagrees with what the run was
   * given. A run that was briefed but read none of it is a finding; a run that
   * lost the record of being briefed is a hole.
   */
  if (brief && instruction.context) {
    await recordAgentRunObservations(deps.supabase, context.run.id, {
      contextBriefVersion: brief.briefVersion,
      contextFreshness: brief.freshness.state,
      contextBytes: instruction.briefed ? instruction.context.bytes : 0,
      contextFactsSent: instruction.briefed ? instruction.context.factsRendered : 0,
      contextCandidatesSent: instruction.briefed ? instruction.context.candidatesRendered : 0,
      /*
       * How large the repository being compressed was (Sprint 0053).
       *
       * Recorded unconditionally on `instruction.briefed`, unlike the three
       * lines above it. Those measure what reached the prompt, so a withheld
       * brief genuinely sent zero bytes. This measures the *tree*, which was
       * that size whether or not Vibe chose to describe it — and the compiler
       * has already nulled every field when the snapshot was not fresh, which
       * is the case where the size is genuinely unknown for this commit.
       */
      contextCandidatesAvailable: brief.repositoryScale.candidatesAvailable,
      repoTreeEntries: brief.repositoryScale.treeEntries,
      repoFilesAnalyzed: brief.repositoryScale.filesAnalyzed,
      repoBytesAnalyzed: brief.repositoryScale.bytesAnalyzed,
      repoRoutesDetected: brief.repositoryScale.routesDetected,
      repoSurfacesDetected: brief.repositoryScale.surfacesDetected,
      /*
       * What the step's own cited evidence said its surface was (Sprint 0044).
       *
       * Recorded even when nothing resolved, because an empty scope list is the
       * finding: it means the planner cited nothing this compiler recognises,
       * and the run fell back to the prose hints that made run #6 and run #7
       * compile to byte-identical briefs.
       */
      contextSurfaceScopes: [...brief.surface.requirement.scopes],
      contextSurfacePages:
        brief.surface.publicPagesResolved + brief.surface.authenticatedPagesResolved,
    });

    await recordLifecycle(
      deps,
      context.run,
      "context_compiled",
      instruction.briefed
        ? "Started from what Vibe already knows about this project"
        : "Nothing Vibe knows applied to this commit",
      {
        briefVersion: brief.briefVersion,
        freshness: brief.freshness.state,
        briefed: instruction.briefed,
        bytes: instruction.context.bytes,
        facts: instruction.context.factsRendered,
        candidates: instruction.context.candidatesRendered,
        factsOmitted: instruction.context.factsOmitted,
        candidatesOmitted: instruction.context.candidatesOmitted,
        // What the compiler was selecting from, beside what it selected. The
        // pair is the point: 12 of 12 and 12 of 40 cost very different money.
        candidatesAvailable: brief.repositoryScale.candidatesAvailable,
        repositoryRoutes: brief.repositoryScale.routesDetected,
        repositoryTreeEntries: brief.repositoryScale.treeEntries,
      },
    );

    /*
     * The surface, separately from the size of the brief.
     *
     * Run #6 and run #7 produced identical `context_compiled` payloads — same
     * bytes, same facts, same candidates — for two tasks whose execution
     * surfaces have nothing in common. This is the line that would have shown
     * the difference before a paid run had to.
     */
    await recordLifecycle(
      deps,
      context.run,
      "execution_surface_resolved",
      brief.surface.requirement.scopes.length > 0
        ? `This step's surface: ${brief.surface.requirement.scopes.join(", ")}`
        : "The step cites no evidence this compiler recognises",
      {
        requirementVersion: brief.surface.requirement.requirementVersion,
        scopes: brief.surface.requirement.scopes.join(", ") || "none",
        surfaces: brief.surface.requirement.surfaces.join(", ") || "none",
        derivedFrom: brief.surface.requirement.derivedFrom.join(", ") || "none",
        unrecognised: brief.surface.requirement.unrecognised.join(", ") || "none",
        publicPagesResolved: brief.surface.publicPagesResolved,
        publicPagesIncluded: brief.surface.publicPagesIncluded,
        authenticatedPagesResolved: brief.surface.authenticatedPagesResolved,
        authenticatedPagesIncluded: brief.surface.authenticatedPagesIncluded,
      },
    );
  }

  const started = await context.provider.start({
    runId: context.run.id,
    instruction,
    model: context.run.model,
    effort: "high",
    tools: agentToolDescriptors(availableChecks),
    limits: {
      maxTurns: context.limits.maxTurns,
      maxWallClockMs: context.limits.maxWallClockMs,
      maxProviderSpendUsd: context.limits.maxProviderSpendUsd,
    },
    // Carried into the sandbox as data. The harness is the only place a shell
    // command exists before it runs, so it is the only place this can apply.
    ...(verification ? { verification: toSandboxPolicy(verification) } : {}),
    /*
     * The completion budget, with the brief's own paths.
     *
     * The paths are what let the harness tell a read of a file Vibe pointed at
     * from a read of one it did not — the distinction the outside-brief
     * allowance rests on, and the reason the brief and the budget are compiled
     * together rather than in two places.
     */
    ...(completionBudget
      ? {
          completion: toSandboxCompletionPolicy({
            budget: completionBudget,
            briefPaths: (brief?.fileCandidates ?? []).map((candidate) => candidate.path),
            /*
             * The required checks travel with the budget, because the harness
             * has to know which operations a Vibe policy already marked
             * required before it may refuse one on resource grounds (PART H).
             */
            requiredChecks: verification?.requiredChecks ?? [],
          }),
        }
      : {}),
    // Nothing to cancel through: the harness outlives this call. Cancellation
    // is the poll loop's job, and the sandbox's own lifetime is the backstop.
    signal: new AbortController().signal,
  });

  /*
   * The tool trail is written here, not at collect.
   *
   * It belongs to the gateway instance the harness was handed, and that
   * instance dies with this invocation — the collecting step is a different
   * function on a different machine and builds a fresh, empty one. Recording it
   * anywhere else would silently persist zeros.
   *
   * Under the sandbox topology the trail is empty by construction: the harness
   * edits files with its own tools inside the VM and never calls back. It is
   * still written, because "the gateway brokered nothing" is a fact worth
   * having recorded rather than an absence to infer.
   */
  /*
   * Nothing to record from the broker any more.
   *
   * This wrote `tool_calls_allowed`, `tool_calls_denied`, `files_read`,
   * `check_runs`, `repair_attempts` and `changed_bytes` from the gateway's
   * counters, plus one row per brokered tool call and activity record. Under
   * the sandbox topology every one of those was empty by construction — the
   * harness edits files with its own tools inside the VM and never calls back —
   * so each run wrote six zeros and two empty lists, and the comment here said
   * so while doing it anyway.
   *
   * What the run actually did is in `agent_execution_events`, written by the
   * harness feed, and `economy/harness-metrics.ts` already derives the real
   * counts from there. The columns stay for now, holding their historical
   * values from the in-process era; dropping them is a separate migration,
   * because dropping a column the deployed code still selects is exactly the
   * skew `docs/deployment/migrations-and-rollback.md` forbids.
   */

  /*
   * An interrupt no longer arrives here.
   *
   * `gateway.interrupt` was set when the agent called `ask_founder` through the
   * broker, in the topology where the harness ran in this process. It runs in
   * the VM now and reports through the runtime protocol instead, so the observe
   * step is where a raised interrupt is seen — and it does the same three
   * things this branch did: raise it, pause the run and the operation, and
   * release the hold as `abandoned_with_usage` because real inference already
   * ran (see `observe.ts`). Keeping a second copy here meant two places could
   * disagree about how a paused run is settled, and only one of them could ever
   * execute.
   */

  if (!started.ok) {
    console.error("[agent-execution] the agent harness could not be started", {
      operationId,
      agentExecutionRunId: context.run.id,
      detail: started.failureDetail,
    });
    return { ok: false, failureCode: "provider_unavailable" };
  }

  return { ok: true };
}
