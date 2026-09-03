import "server-only";
import {
  AgentExecutionDeps,
  StepOutcome,
  recordLifecycle,
  AgentRunContext,
  loadAgentRunContext,
} from "./shared";
import { recordAuditEvent } from "@/modules/audit-log/events";
import {
  discoverWorkspaceChanges,
  readWorkspaceBaseline,
} from "@/modules/coding-agent/sandbox-runtime/changes";
import { MAX_EVENTS_PER_RUN } from "@/modules/coding-agent/observability/events";
import { eventsFromRuntimeFeed } from "@/modules/coding-agent/observability/runtime-feed";
import {
  listExecutionEvents,
  recordExecutionEvents,
} from "@/modules/coding-agent/observability/store";
import type { ExecutionSpec } from "@/modules/execution-contract/spec";
import { loadExecutionBrief } from "@/modules/execution-context/service";
import { summarizeContextUsage } from "@/modules/execution-context/usage";
import {
  executionSpecAlreadyResolvedFounderInput,
  runtimeFounderInputRequirement,
} from "@/modules/founder-input/runtime";
import {
  pauseAgentRunForUser,
  raiseExecutionInterrupt,
  recordAgentRunObservations,
  recordAgentMessageProgress,
  type StoredAgentExecutionRun,
} from "@/modules/coding-agent/store";
import { releaseOperationCredits } from "@/modules/credits/operation-billing";
import { pauseOperationForUser } from "../../store";
/* ---------------------------------------------------------------------------
 * Step 2b — watch it, briefly and repeatedly
 * ------------------------------------------------------------------------ */

export type PollAgentOutcome = StepOutcome<{
  /** The harness wrote its result. Nothing further will change. */
  finished: boolean;
  /** The run outlived its authorized wall clock and must be stopped. */
  expired: boolean;
  /** Model responses observed so far — already persisted before this returns. */
  assistantMessages: number;
}>;

/**
 * One short look at a running agent.
 *
 * Cheap by construction: it reconnects, reads two small files and writes at
 * most one column. It is called on a timer for the whole length of a run, so
 * anything expensive here is paid for dozens of times.
 *
 * The turn count is persisted *here*, not at the end. That is the whole point —
 * the first real run's turns were lost because the only record of them lived in
 * a function the platform killed.
 */
export async function pollAgentStep(
  deps: AgentExecutionDeps,
  operationId: string,
): Promise<PollAgentOutcome> {
  const loaded = await loadAgentRunContext(deps, operationId);
  if (!loaded.ok) return loaded;
  const { context } = loaded;

  const observation = await context.provider.observe();

  // Written before anything else can fail. A model response that happened is a
  // fact about what a customer was charged for (Rule 47).
  await recordAgentMessageProgress(deps.supabase, context.run.id, observation.assistantMessages);

  /*
   * The harness's feed, made durable.
   *
   * The whole file is re-offered on every poll and the write is an upsert on
   * the sequence the harness itself assigned, so a lost poll costs nothing and
   * a workflow retry rewrites identical rows. That is the same property the
   * turn counter has, for the same reason: nothing in this process survives to
   * the next invocation, so a cursor would be a fourth thing to lose.
   *
   * Wrapped, because this is telemetry hanging off a paid run. A run whose
   * event log could not be written is still a run.
   */
  if (observation.entries && observation.entries.length > 0) {
    try {
      await recordExecutionEvents(deps.supabase, {
        runId: context.run.id,
        projectId: context.run.projectId,
        userId: context.run.userId,
        events: eventsFromRuntimeFeed({
          entries: observation.entries,
          observedAt: new Date((deps.now ?? Date.now)()).toISOString(),
          // The two halves of a real timestamp: Vibe's own start time, and the
          // harness's offset from it. Neither alone is enough — the sandbox's
          // clock is not this system's, and a poll's read time stamps a whole
          // batch with one moment.
          startedAt: context.run.startedAt,
          workspaceDir: context.paths.workspaceDir,
        }),
      });
    } catch (error) {
      console.error("[agent-observability] the runtime feed could not be recorded", {
        operationId,
        agentExecutionRunId: context.run.id,
        detail:
          error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown",
      });
    }
  }

  /*
   * The wall clock, enforced by Vibe against durable state.
   *
   * Measured from the run row's own `started_at` rather than from anything this
   * invocation remembers, because no invocation has been here before. A harness
   * that ignored its own ceiling is stopped by this and by the sandbox's
   * independent lifetime — two bounds, neither of which is the agent's to hold.
   */
  const startedAt = context.run.startedAt ? Date.parse(context.run.startedAt) : null;
  const now = (deps.now ?? Date.now)();
  const expired =
    startedAt !== null && Number.isFinite(startedAt)
      ? now - startedAt > context.limits.maxWallClockMs
      : false;

  return {
    ok: true,
    finished: observation.finished,
    expired,
    assistantMessages: observation.assistantMessages,
  };
}

/* ---------------------------------------------------------------------------
 * Step 2c — collect what it left behind (§16, §17, §19, §25, §35)
 * ------------------------------------------------------------------------ */

export type RunAgentOutcome = StepOutcome<{
  /** True when the run stopped on a question and is holding (§25). */
  paused: boolean;
  /**
   * Paths Vibe observed, *before* any of them is known to be a change.
   *
   * Named for what it is. The candidate count comes one step later, from the
   * comparison against the pinned base, and is usually smaller — 14 against 2
   * in run #3, because the agent's own build wrote twelve artifacts the
   * repository ignores.
   */
  observedPathCount: number;
  /**
   * The paths Vibe observed.
   *
   * Carried to the extract step rather than re-derived there, because the
   * answer must be taken at the moment the agent stopped and while its baseline
   * is still in the sandbox — not after whatever else touches the workspace next.
   */
  changedPaths: readonly string[] | null;
}>;

export async function collectAgentStep(
  deps: AgentExecutionDeps,
  operationId: string,
): Promise<RunAgentOutcome> {
  const loaded = await loadAgentRunContext(deps, operationId);
  if (!loaded.ok) return loaded;
  const { context } = loaded;
  const { run } = context;

  const startedAtMs = run.startedAt ? Date.parse(run.startedAt) : (deps.now ?? Date.now)();
  const result = await context.provider.collect({
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : (deps.now ?? Date.now)(),
  });

  /*
   * What the run changed, read off the filesystem while the sandbox is still
   * alive and before anything else touches it.
   *
   * Taken even when the run failed. A harness that died after writing four
   * files still wrote four files, and a change set that quietly became empty
   * because of how a run ended would be a false statement about the workspace.
   */
  const baseline = await readWorkspaceBaseline({
    sandbox: context.sandbox,
    baselinePath: context.paths.baselinePath,
  });

  const observed = baseline
    ? await discoverWorkspaceChanges({
        sandbox: context.sandbox,
        cwd: context.paths.workspaceCwd,
        before: baseline,
        markerPath: context.paths.markerPath,
      })
    : null;

  const changedPaths = observed?.paths ?? null;
  const observedPathCount = changedPaths?.length ?? 0;

  /*
   * Only the columns this step is the one to know.
   *
   * The tool counters were written when the harness was started, by the gateway
   * instance that saw the calls. Writing them again from a gateway rebuilt here
   * would overwrite a real trail with the zeros of an object nothing ever used.
   *
   * `observed_path_count`, not `changed_file_count`. This step has looked at the
   * filesystem and nothing else: it does not yet know which of these paths are
   * a change, because that is decided by comparing them against the pinned base
   * one step later. Run #3 stored 14 in a column named for the other number and
   * the change was two files — the same confusion that made run #2's eighteen
   * touched paths read as eighteen changes.
   */
  await recordAgentRunObservations(deps.supabase, run.id, {
    /*
     * Both counts, each written under its own name.
     *
     * `sdkLoopIterations` is the unit the budget's ceiling is in and is null
     * when the harness never reported one — which is the honest value for a run
     * that died before its terminal message. Filling it with the message count
     * is the substitution that made run b33635a1 read "66 / 40".
     */
    assistantMessages: result.assistantMessages,
    sdkLoopIterations: result.sdkLoopIterations,
    observedPathCount,
    durationMs: result.durationMs,
    providerSessionId: result.sessionId,
  });

  if (result.runtimeFounderInput) {
    const interruptType =
      result.runtimeFounderInput.kind === "decision"
        ? "business_decision_required"
        : "founder_input_required";
    const founderInputRequirement = runtimeFounderInputRequirement({
      stepKey: context.spec.spec.stepKey,
      draft: result.runtimeFounderInput,
    });
    if (!founderInputRequirement) {
      return { ok: false, failureCode: "missing_required_context" };
    }
    if (
      executionSpecAlreadyResolvedFounderInput(
        context.spec.spec.businessContext.approvedDecisions,
        founderInputRequirement,
      )
    ) {
      return { ok: false, failureCode: "inference_interrupted" };
    }

    const responseSchema =
      founderInputRequirement.alternatives.length >= 2
        ? {
            kind: "single_choice" as const,
            options: founderInputRequirement.alternatives.map((option) => ({
              id: option.id,
              label: option.label,
            })),
          }
        : { kind: "text" as const, maxLength: 1200 };

    await raiseExecutionInterrupt(deps.supabase, {
      projectId: run.projectId,
      userId: run.userId,
      executionSpecId: run.executionSpecId,
      agentExecutionRunId: run.id,
      interrupt: {
        type: interruptType,
        question: founderInputRequirement.question,
        responseSchema,
        whyBlocked: interruptType,
        founderInputRequirement,
      },
    });
    const paused = await pauseAgentRunForUser(deps.supabase, run.id);
    await pauseOperationForUser(deps.supabase, operationId);
    if (paused && run.creditReservationId) {
      await releaseOperationCredits(deps.supabase, {
        reservationId: run.creditReservationId,
        reason: "abandoned_with_usage",
      });
    }

    await recordAuditEvent(deps.supabase, {
      userId: run.userId,
      projectId: run.projectId,
      eventType: "agent_execution.needs_user_input",
      metadata: {
        projectId: run.projectId,
        operationId,
        agentExecutionRunId: run.id,
        interruptType,
      },
    });

    return { ok: true, paused: true, observedPathCount: 0, changedPaths: null };
  }

  /*
   * Provider usage is NOT recorded here.
   *
   * Every sampling call already wrote its own row as it happened, from the
   * Agent Gateway — which is the only place that sees what a streamed response
   * actually cost. Recording a summary here as well would double-count a run
   * whose per-call rows are the ones the ceilings are measured against.
   */

  if (result.outcome === "provider_error") {
    /*
     * The one string that says *why*, written where a person can read it.
     *
     * This is an infrastructure error string, not model output: no prompt, no
     * response, no reasoning, so Rules 43 and 47 have nothing to say about it.
     */
    console.error("[agent-execution] the coding-agent provider failed", {
      operationId,
      agentExecutionRunId: run.id,
      provider: context.provider.id,
      durationMs: result.durationMs,
      assistantMessages: result.assistantMessages,
      detail: result.failureDetail,
    });

    return { ok: false, failureCode: "provider_unavailable" };
  }

  /*
   * A change set Vibe is not sure is complete cannot become a diff.
   *
   * The baseline was lost, or a listing degraded, so "these are the files" is a
   * claim this run cannot make. Refusing here is the honest outcome: preparing a
   * partial change would hand a reviewer something to approve that is missing a
   * file nobody knows about (Rule 27).
   */
  if (!baseline || observed?.truncated) {
    console.error("[agent-execution] the workspace observation was incomplete", {
      operationId,
      agentExecutionRunId: run.id,
      baselineFound: baseline !== null,
      observedPaths: observed?.paths.length ?? 0,
    });
    return { ok: false, failureCode: "change_preparation_failed" };
  }

  await recordLifecycle(deps, run, "agent_finished", "Finished working on the change", {
    outcome: result.outcome,
    assistantMessages: result.assistantMessages,
    // Null when the harness never reported one, and recorded as null rather
    // than as the message count — the inspector reads this field directly.
    sdkLoopIterations: result.sdkLoopIterations,
    durationMs: result.durationMs,
  });

  await recordLifecycle(
    deps,
    run,
    "change_discovered",
    `Observed ${observedPathCount} ${observedPathCount === 1 ? "path" : "paths"} in the workspace`,
    { observedPaths: observedPathCount },
  );

  await recordContextUsage(deps, context);
  await recordVerificationOutcome(deps, context, result);

  return { ok: true, paused: false, observedPathCount, changedPaths };
}

/* ---------------------------------------------------------------------------
 * What the briefing was worth (EXECUTION CONTEXT INTELLIGENCE, PART L, PART M)
 * ------------------------------------------------------------------------ */

/**
 * Counts what the run read against what it was briefed with.
 *
 * ## Where each half comes from
 *
 * The reading comes from the durable `file_read` events, which were built from
 * the harness's own tool stream — what the agent *executed*, never its account
 * of what it looked at (Rule 77). The briefing is recompiled: it is a pure
 * function of the immutable spec and the snapshot that spec names, so the same
 * inputs give the same candidates, and storing a second copy of a list already
 * derivable from stored state would be the duplicate source of truth this
 * sprint exists to avoid.
 *
 * "Recompiled" is checked rather than assumed. If the recompiled brief does not
 * match the version and freshness the run recorded at start, nothing is written
 * — an unmeasurable run is recorded as unmeasured, which is a fact, rather than
 * as a comparison against a briefing it was never given.
 *
 * ## Why a failure here changes nothing
 *
 * Because this is telemetry hanging off a paid execution, computed after the
 * change has already been observed. A run whose context metrics could not be
 * written is still a run, and its change is still exactly as good.
 */
async function recordContextUsage(
  deps: AgentExecutionDeps,
  context: AgentRunContext,
): Promise<void> {
  const { run } = context;
  if (!run.contextBriefVersion) return;

  try {
    const brief = await loadExecutionBrief({
      supabase: deps.supabase,
      projectId: run.projectId,
      spec: context.spec.spec,
    });

    if (
      !brief ||
      brief.briefVersion !== run.contextBriefVersion ||
      brief.freshness.state !== run.contextFreshness
    ) {
      return;
    }

    const events = await listExecutionEvents(deps.supabase, {
      runId: run.id,
      projectId: run.projectId,
      limit: MAX_EVENTS_PER_RUN,
    });

    const readPaths = events
      .filter((event) => event.type === "file_read")
      .map((event) => event.metadata.path)
      .filter((path): path is string => typeof path === "string");

    const usage = summarizeContextUsage({
      candidates: brief.fileCandidates.map((candidate) => candidate.path),
      readPaths,
    });

    await recordAgentRunObservations(deps.supabase, run.id, {
      contextCandidatesRead: usage.candidatesRead,
      uniqueFilesRead: usage.uniqueFilesRead,
      repeatedFileReads: usage.repeatedFileReads,
      filesReadOutsideContext: usage.filesReadOutsideContext,
    });

    await recordLifecycle(
      deps,
      run,
      "context_used",
      `Read ${usage.candidatesRead} of ${usage.candidatesOffered} briefed file(s) and ` +
        `${usage.filesReadOutsideContext} beyond the briefing`,
      {
        candidatesOffered: usage.candidatesOffered,
        candidatesRead: usage.candidatesRead,
        uniqueFilesRead: usage.uniqueFilesRead,
        repeatedFileReads: usage.repeatedFileReads,
        filesReadOutsideContext: usage.filesReadOutsideContext,
      },
    );
  } catch (error) {
    console.error("[execution-context] context usage could not be recorded", {
      agentExecutionRunId: run.id,
      detail: error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown",
    });
  }
}

/**
 * Provider calls and cost after the last observed write (PART L).
 *
 * A timestamp comparison against one boundary, and nothing cleverer. Returns
 * nothing at all when the boundary is unknown — PART L is explicit that an
 * unreliable split should not exist rather than exist approximately, and a run
 * that wrote no file has no far side to be on.
 *
 * `provider_cost_usd` is untouched. This is an additional column beside it,
 * never a re-derivation of it.
 */
async function postEditSpend(
  deps: AgentExecutionDeps,
  run: StoredAgentExecutionRun,
  lastEditMs: number | null,
): Promise<{ postEditProviderCalls?: number; postEditProviderCostUsd?: number }> {
  if (lastEditMs === null || !run.startedAt) return {};

  const boundary = new Date(Date.parse(run.startedAt) + lastEditMs).toISOString();

  const { data, error } = await deps.supabase
    .from("ai_usage_events")
    .select("provider_cost_usd")
    .eq("job_id", run.id)
    .eq("project_id", run.projectId)
    .gt("created_at", boundary);

  if (error) return {};

  const rows = (data ?? []) as { provider_cost_usd: string | number | null }[];
  return {
    postEditProviderCalls: rows.length,
    postEditProviderCostUsd: rows.reduce<number>(
      (total, row) => total + Number(row.provider_cost_usd ?? 0),
      0,
    ),
  };
}

/**
 * How many post-edit reads landed outside what the brief named.
 *
 * The number the outside-brief allowance exists to move. Compared against the
 * recompiled brief's own candidate paths, and skipped entirely when the brief
 * cannot be reproduced — an unmeasurable run is recorded as unmeasured.
 */
async function postEditBriefReads(
  deps: AgentExecutionDeps,
  run: StoredAgentExecutionRun,
  spec: ExecutionSpec,
  postEdit: readonly { type: string; metadata: Record<string, unknown> }[],
): Promise<{ postEditReadsBeyondBrief?: number }> {
  if (!run.contextBriefVersion) return {};

  try {
    const brief = await loadExecutionBrief({
      supabase: deps.supabase,
      projectId: run.projectId,
      spec,
    });
    if (!brief || brief.briefVersion !== run.contextBriefVersion) return {};

    const named = new Set(brief.fileCandidates.map((candidate) => candidate.path));
    const reads = postEdit.filter((event) => event.type === "file_read");

    return {
      postEditReadsBeyondBrief: reads.filter((event) => {
        const path = event.metadata.path;
        return typeof path === "string" && !named.has(path);
      }).length,
    };
  } catch {
    return {};
  }
}

/** Tool events that count as "the agent did something" for the tail counters. */
const TOOL_EVENT_TYPES: ReadonlySet<string> = new Set([
  "file_read",
  "file_written",
  "file_edited",
  "file_searched",
  "command_started",
]);

/**
 * What the verification plan cost, and where the implementation ended
 * (Sprint 0042, PART K, PART L).
 *
 * ## The boundary, and why it is named for what it measures
 *
 * Vibe cannot observe the moment an agent believes it is finished — there is no
 * signal for it, and asking the agent would be reading its account of its own
 * work, which Rule 77 forbids for exactly this kind of question. What Vibe can
 * observe is the last time it wrote a file. Everything after that instant was
 * checking or exploring, so `time_to_last_edit_ms` is the honest approximation
 * and the column is named for the observation rather than for the inference.
 *
 * That one number is what makes PART L answerable without inventing a split:
 * with it, "how many provider calls happened after the implementation was
 * already complete" is a timestamp comparison against the usage ledger, done at
 * read time, rather than a figure stored here that could drift from it.
 *
 * ## Failure changes nothing
 *
 * Telemetry hanging off a paid execution, computed after the change has already
 * been observed. A run whose verification metrics could not be written is still
 * a run, and its change is exactly as good.
 */
async function recordVerificationOutcome(
  deps: AgentExecutionDeps,
  context: AgentRunContext,
  /*
   * Passed in rather than read off the run row.
   *
   * The row was loaded at the top of this step, before this invocation wrote
   * `duration_ms` to it — so `run.durationMs` here is whatever it was *before*
   * the run finished, which for every real run is null. The collected result is
   * the only value that describes the run that just ended.
   */
  result: {
    durationMs: number;
    verificationCommands: number | null;
    verificationRefusals: number | null;
    policyDecisions: number | null;
    repairCycles: number | null;
    implementationMutations: number | null;
    convergenceMutations: number | null;
    requiredVerificationActions: number | null;
    requiredVerificationOverrides: number | null;
  },
): Promise<void> {
  const { run } = context;
  const durationMs = result.durationMs;

  try {
    const events = await listExecutionEvents(deps.supabase, {
      runId: run.id,
      projectId: run.projectId,
      limit: MAX_EVENTS_PER_RUN,
    });

    const startedAt = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
    if (!Number.isFinite(startedAt)) return;

    const offsetOf = (event: { occurredAt: string }): number | null => {
      const at = Date.parse(event.occurredAt);
      return Number.isFinite(at) ? Math.max(0, at - startedAt) : null;
    };

    const writes = events.filter(
      (event) => event.type === "file_written" || event.type === "file_edited",
    );
    const checks = events.filter((event) => event.type === "verification_check_started");
    const refusals = events.filter((event) => event.type === "verification_command_refused");

    const editOffsets = writes.map(offsetOf).filter((value): value is number => value !== null);
    const checkOffsets = checks.map(offsetOf).filter((value): value is number => value !== null);

    /*
     * From the first permitted check to the end of the run.
     *
     * Not "the sum of the check durations": the gaps between checks are the
     * model deciding what to do next, and that time is bought by the plan just
     * as surely as the commands are. Run #4's 4m58s was mostly the commands,
     * but a run that spends two minutes thinking between two ten-second tests
     * has still spent two minutes on verification.
     */
    const verificationMs =
      checkOffsets.length > 0 ? Math.max(0, durationMs - Math.min(...checkOffsets)) : null;

    /*
     * The harness's own count wins, and a disagreement is logged.
     *
     * Two counters exist because one of them cannot detect its own silence.
     * Run #5 derived zero verification commands from the feed while the run
     * had executed a permitted targeted test — correct arithmetic over an
     * empty set, because `allowedTools` had auto-allowed Bash past the
     * permission handler and the decision point was never reached. A counter
     * written where the decision happens is the only thing that could have
     * disagreed, and the disagreement is the bug report.
     */
    const harnessChecks = result.verificationCommands;
    if (harnessChecks !== null && harnessChecks !== checks.length) {
      console.error("[agent-verification] the harness and the feed disagree on check count", {
        agentExecutionRunId: run.id,
        harness: harnessChecks,
        feed: checks.length,
      });
    }

    /*
     * The tail, counted against the one boundary Vibe can actually observe.
     *
     * Everything after the last write was either checking or exploring, and
     * splitting those two apart afterwards would need to know what the agent
     * intended. The useful question — how much did this run spend once the code
     * was already written — does not need that, so it is not claimed.
     */
    const lastEditMs = editOffsets.length > 0 ? Math.max(...editOffsets) : null;
    const after = (event: { occurredAt: string }): boolean => {
      const offset = offsetOf(event);
      return lastEditMs !== null && offset !== null && offset > lastEditMs;
    };

    const postEdit = events.filter(after);
    const completionRefusals = events.filter((event) => event.type === "completion_action_refused");

    await recordAgentRunObservations(deps.supabase, run.id, {
      verificationCommands: harnessChecks ?? checks.length,
      verificationRefusals: result.verificationRefusals ?? refusals.length,
      verificationMs,
      timeToFirstEditMs: editOffsets.length > 0 ? Math.min(...editOffsets) : null,
      timeToLastEditMs: lastEditMs,

      postEditToolCalls: postEdit.filter((event) => TOOL_EVENT_TYPES.has(event.type)).length,
      postEditReads: postEdit.filter((event) => event.type === "file_read").length,
      postEditCommands: postEdit.filter((event) => event.type === "command_started").length,
      completionRefusals: completionRefusals.length,
      repairCycles: result.repairCycles ?? undefined,
      implementationMutations: result.implementationMutations ?? undefined,
      convergenceMutations: result.convergenceMutations ?? undefined,
      requiredVerificationActions: result.requiredVerificationActions ?? undefined,
      requiredVerificationOverrides: result.requiredVerificationOverrides ?? undefined,
      policyDecisions: result.policyDecisions,
      ...(await postEditSpend(deps, run, lastEditMs)),
      ...(await postEditBriefReads(deps, run, context.spec.spec, postEdit)),
    });

    if (run.verificationMode) {
      await recordLifecycle(
        deps,
        run,
        "verification_completed",
        `Ran ${checks.length} check(s); ${refusals.length} refused by policy`,
        {
          mode: run.verificationMode,
          commands: checks.length,
          refusals: refusals.length,
          verificationMs: verificationMs ?? 0,
          lastEditMs: editOffsets.length > 0 ? Math.max(...editOffsets) : 0,
        },
      );
    }
  } catch (error) {
    console.error("[agent-verification] the verification outcome could not be recorded", {
      agentExecutionRunId: run.id,
      detail: error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown",
    });
  }
}

/* ---------------------------------------------------------------------------
 * Step 3 — Vibe computes the change and checks it (§27, §28)
 * ------------------------------------------------------------------------ */
