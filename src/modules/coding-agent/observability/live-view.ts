import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { readExecutionEconomics } from "../economics/store";
import type { ExecutionEconomics } from "../economics/cost";
import type { OperationView } from "@/modules/operations/view";
import { buildExecutionTimeline, currentAction, type TimelineStep } from "./timeline";
import { listExecutionEvents } from "./store";
import type { StoredExecutionEvent } from "./events";
import type { FreshnessState } from "@/modules/execution-context/brief";

/**
 * Everything one agent execution's live view needs, in one read.
 *
 * ## Why this is a module and not a page
 *
 * Because the Dogfood page is a testing surface, not the destination. The same
 * numbers belong in the production dashboard, and the way to make that move an
 * integration rather than a rewrite is for the page to own no logic: it calls
 * this, and renders what comes back. A second consumer needs a route and a
 * layout, not a second copy of the derivation.
 *
 * ## What is derived here rather than stored
 *
 * The timeline, the counts, the changed-file classification and every economic
 * figure. All of them are functions of rows that already exist — events,
 * `ai_usage_events`, `sandbox_usage_events`, the run row — and storing any of
 * them would create a number that can disagree with its own source.
 *
 * ## Observed is not candidate
 *
 * The two file lists are kept apart the whole way through, because run
 * `b33635a1` conflated them and cost a run: eighteen paths were touched and six
 * were the change. `observed` is what the harness reported doing, `candidate`
 * is what Vibe verified against the pinned base, and nothing in this file lets
 * the first stand in for the second.
 */

export type LiveFileKind = "candidate" | "observed" | "generated";

export type LiveFile = {
  path: string;
  kind: LiveFileKind;
  /** `modified`, `added`, `deleted` for a candidate; a tool verb otherwise. */
  detail: string | null;
  bytes: number | null;
  /** Which rule withheld a generated path. Null for everything else. */
  withheldBy: string | null;
};

export type AgentRunMetrics = {
  /**
   * Model responses observed, from the harness's tool stream.
   *
   * Named for what it counts. It is **not** comparable to `maxSdkIterations`:
   * that bounds the SDK's own loop, which advances on tool results as well as
   * on responses. Run `b33635a1` recorded 66 of these against a ceiling of 40
   * and overran nothing — see docs/sprints/0040a-turn-metric-mismatch.md.
   */
  assistantMessages: number;
  /** The ceiling handed to the harness, in the harness's own unit. */
  maxSdkIterations: number | null;
  /**
   * The harness's own loop count, once it has reported one.
   *
   * Only available after the run finishes, because the number comes from the
   * SDK's terminal result message. Null while running, and null is the honest
   * answer rather than the message count standing in for it.
   */
  sdkLoopIterations: number | null;
  filesRead: number;
  filesWritten: number;
  filesEdited: number;
  searches: number;
  commands: number;
  elapsedMs: number | null;
  wallClockBudgetMs: number | null;

  /**
   * What Vibe told the run before it started, and what the run then read.
   *
   * Passed through from the run row rather than recomputed here: the counts
   * describe the bytes that were actually sent, and a live view that re-derived
   * them from a brief compiled now would eventually disagree with the prompt
   * the run received. Null means this run had no Execution Brief.
   */
  context: LiveRunRow["context"];
  verification: LiveRunRow["verification"];
  completion: LiveRunRow["completion"];
};

/*
 * Re-exported from `./poll`, which holds no server dependency (Sprint 0053).
 *
 * The predicate is needed by the client component that owns the run page's
 * poll, and this module is `server-only` — importing it from a client
 * component pulls Supabase into the browser bundle and fails the build. The
 * re-export keeps one import path for server-side callers without making the
 * client reach through a server module to get a pure function.
 */
export { validationStillSettling } from "./poll";
export type { ValidationState } from "./poll";
import type { ValidationState } from "./poll";

/**
 * What a run did, as a founder may read it (audit C7).
 *
 * ## Why this is a separate type
 *
 * `AgentExecutionLiveModel` reads execution economics out of `ai_usage_events`
 * — Vibe's own cost ledger, which the customer role deliberately cannot
 * select. Mounting the whole model on a customer page threw
 * `42501 permission denied`, and the workaround was to build a second, thinner
 * timeline by hand in `agent-workspace.ts`: two derivations of the same run,
 * only one of them maintained, and the observation half — current action,
 * files, counters — never reached the founder at all.
 *
 * The split is what the RLS failure was actually pointing at. Everything here
 * comes from the execution event log and the run row, both readable under the
 * customer's own policies. Nothing here needs a grant.
 *
 * ## No USD, anywhere in it
 *
 * `completion.providerCostUsd` is stripped rather than passed through. What a
 * run cost Vibe to produce is not a founder's to read — it is not the retail
 * price, and showing it beside the retail price would invite exactly the
 * comparison this product does not make. Removing the field, rather than
 * declining to render it, is what keeps that true for every future consumer.
 */
export type RunObservation = {
  operation: OperationView & { agentExecutionRunId: string | null };
  timeline: TimelineStep[];
  currentAction: string | null;
  events: readonly StoredExecutionEvent[];
  customerEvents: readonly StoredExecutionEvent[];
  metrics: ObservedRunMetrics;
  files: readonly LiveFile[];
  gatewayRequestCeiling: number | null;
  validation: ValidationState;
};

/** `AgentRunMetrics` with the operator's cost figure removed. */
export type ObservedRunMetrics = Omit<AgentRunMetrics, "completion"> & {
  completion: Omit<NonNullable<AgentRunMetrics["completion"]>, "providerCostUsd"> | null;
};

export type AgentExecutionLiveModel = {
  operation: OperationView & { agentExecutionRunId: string | null };
  timeline: TimelineStep[];
  currentAction: string | null;
  /** Every event, ordered by when it happened rather than by producer. */
  events: readonly StoredExecutionEvent[];
  customerEvents: readonly StoredExecutionEvent[];
  metrics: AgentRunMetrics;
  files: readonly LiveFile[];
  economics: ExecutionEconomics;
  gatewayRequestCeiling: number | null;
  validation: ValidationState;
};

export type LiveRunRow = {
  id: string;
  status: string;
  /** Model responses. Never comparable to the budget's turn ceiling. */
  assistantMessages: number;
  /** The harness's own loop count, in the ceiling's unit. Null if unreported. */
  sdkLoopIterations: number | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  /** Paths the runtime touched. Always >= `changedFileCount`. */
  observedPathCount: number;
  /** Files in the verified candidate. Never what the runtime touched. */
  changedFileCount: number;

  /**
   * What the run was told before it started, and what it read after
   * (EXECUTION CONTEXT INTELLIGENCE, PART L).
   *
   * Null throughout means this run had no Execution Brief — either it predates
   * the compiler, or nothing Vibe had described the commit it worked against.
   * Rendered as raw counts and never as a ratio: reading a briefed file proves
   * the agent opened it, never that opening it was what made the change right.
   */
  /**
   * How much this run was allowed to check its own work (Sprint 0042).
   *
   * Null means no plan was compiled and the run checked whatever it liked —
   * which is what every run before #5 did. Advisory throughout: a mode never
   * authorized anything, and independent validation is unaffected by it.
   */
  verification: {
    mode: string;
    planVersion: string | null;
    commands: number | null;
    refusals: number | null;
    verificationMs: number | null;
    timeToFirstEditMs: number | null;
    timeToLastEditMs: number | null;
  } | null;

  /**
   * Where the run's work went after the code was written (Sprint 0043).
   *
   * Null means no completion budget was compiled and the run explored freely —
   * which is what every run before #6 did. Resource control over model
   * behaviour, never a statement about whether the change is safe.
   */
  completion: {
    budgetVersion: string;
    toolCalls: number | null;
    reads: number | null;
    readsBeyondBrief: number | null;
    commands: number | null;
    providerCalls: number | null;
    providerCostUsd: number | null;
    refusals: number | null;
    repairCycles: number | null;
    implementationMutations: number | null;
    convergenceMutations: number | null;
    requiredVerificationActions: number | null;
    requiredVerificationOverrides: number | null;
    contextSurfaceScopes: string[] | null;
    contextSurfacePages: number | null;
    policyDecisions: number | null;
  } | null;

  context: {
    briefVersion: string;
    freshness: FreshnessState;
    bytes: number;
    factsSent: number;
    candidatesSent: number;
    candidatesRead: number | null;
    uniqueFilesRead: number | null;
    repeatedFileReads: number | null;
    filesReadOutsideContext: number | null;
  } | null;
};

/**
 * Assembles the model.
 *
 * Takes the run row rather than re-reading it, because every caller already has
 * one and a second read could disagree with the first within one render.
 */
type ObservationParams = {
  operation: OperationView & { agentExecutionRunId: string | null };
  projectId: string;
  run: LiveRunRow | null;
  limits?: { maxWallClockMs: number; maxTurns: number; maxProviderSpendUsd: number } | null;
  gatewayRequestCeiling?: number | null;
  validation?: ValidationState;
  now?: () => number;
};

/**
 * The observation half, and the only half a customer surface may build.
 *
 * Reads the execution event log and the run row. Touches no usage ledger, so
 * it cannot fail on a policy the customer role does not hold — which is the
 * failure that produced the second, hand-built timeline this replaces.
 */
export async function buildRunObservation(
  supabase: SupabaseClient,
  params: ObservationParams,
): Promise<RunObservation> {
  const runId = params.operation.agentExecutionRunId;

  const events = runId
    ? await listExecutionEvents(supabase, { runId, projectId: params.projectId })
    : [];

  return runObservationFrom(events, params);
}

export async function buildAgentExecutionLiveModel(
  supabase: SupabaseClient,
  params: ObservationParams,
): Promise<AgentExecutionLiveModel> {
  const runId = params.operation.agentExecutionRunId;

  const [events, economics] = await Promise.all([
    runId
      ? listExecutionEvents(supabase, { runId, projectId: params.projectId })
      : Promise.resolve([]),
    runId
      ? readExecutionEconomics(supabase, {
          runId,
          projectId: params.projectId,
          providerBudgetUsd: params.limits?.maxProviderSpendUsd ?? null,
          // The boundary between building and checking, so the calls that
          // happened after the code was already written can be counted. Both
          // halves come from the run row; without either, the split is null.
          startedAt: params.run?.startedAt ?? null,
          lastEditMs: params.run?.verification?.timeToLastEditMs ?? null,
        })
      : Promise.resolve(emptyEconomics()),
  ]);

  const observation = runObservationFrom(events, params);

  return {
    ...observation,
    metrics: {
      ...observation.metrics,
      completion: completionWithCost(params.run),
    },
    economics,
  };
}

/** The operator's view keeps the figure the founder's does not get. */
function completionWithCost(run: LiveRunRow | null): AgentRunMetrics["completion"] {
  return run?.completion ?? null;
}

/**
 * The same observation, from events a caller has already read.
 *
 * Exported because the Agent workspace reads the event log for its own reasons
 * and a second read inside this module could disagree with the first within
 * one render — the reason the run row is passed in rather than re-read.
 */
export function runObservationFrom(
  events: readonly StoredExecutionEvent[],
  params: ObservationParams,
): RunObservation {
  /*
   * Chronological, not by sequence.
   *
   * `sequence` orders the harness's feed exactly and puts Vibe's own milestones
   * in a reserved band above it, so sorting by it would show every milestone at
   * the end. `occurred_at` is what a person means by "then what happened".
   * Sequence breaks ties, so two events in the same millisecond stay stable.
   */
  const ordered = [...events].sort((a, b) => {
    const byTime = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    return byTime !== 0 ? byTime : a.sequence - b.sequence;
  });

  const metrics = deriveMetrics({
    events: ordered,
    run: params.run,
    limits: params.limits ?? null,
    now: params.now,
  });

  const files = deriveFiles(ordered);

  const timeline = buildExecutionTimeline({
    events: ordered,
    status: params.operation.status,
    candidateFileCount: candidateCount(ordered),
    filesInspected: metrics.filesRead,
  });

  return {
    operation: params.operation,
    timeline,
    currentAction: currentAction(ordered),
    events: ordered,
    customerEvents: ordered.filter((event) => event.audience === "customer"),
    metrics: {
      ...metrics,
      /*
       * The one field that had to be removed rather than left unread. Every
       * other completion counter describes what the run *did*; this one is
       * what it cost Vibe, and it has no place on a customer's screen.
       */
      completion: metrics.completion
        ? (({ providerCostUsd: _cost, ...rest }) => rest)(metrics.completion)
        : null,
    },
    files,
    gatewayRequestCeiling: params.gatewayRequestCeiling ?? null,
    validation: params.validation ?? "not_started",
  };
}

function emptyEconomics(): ExecutionEconomics {
  return {
    provider: {
      calls: 0,
      succeededCalls: 0,
      failedCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      thinkingTokens: 0,
      cacheHitRatio: null,
      averageInputTokensPerCall: null,
      largestCallInputTokens: null,
      costUsd: 0,
    },
    sandbox: {
      activeCpuMs: null,
      durationMs: null,
      networkEgressBytes: null,
      networkIngressBytes: null,
      costUsd: null,
    },
    totalCostUsd: null,
    providerBudgetUsd: null,
    providerBudgetRemainingUsd: null,
    afterLastEdit: null,
  };
}

function numberFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function deriveMetrics(input: {
  events: readonly StoredExecutionEvent[];
  run: LiveRunRow | null;
  limits: { maxWallClockMs: number; maxTurns: number } | null;
  now?: () => number;
}): AgentRunMetrics {
  const counts = { filesRead: 0, filesWritten: 0, filesEdited: 0, searches: 0, commands: 0 };
  let assistantMessages = 0;

  for (const event of input.events) {
    switch (event.type) {
      case "turn_completed":
        assistantMessages = Math.max(assistantMessages, numberFrom(event.metadata.assistantMessages) ?? 0);
        break;
      case "file_read":
        counts.filesRead += 1;
        break;
      case "file_written":
        counts.filesWritten += 1;
        break;
      case "file_edited":
        counts.filesEdited += 1;
        break;
      case "file_searched":
        counts.searches += 1;
        break;
      case "command_started":
        counts.commands += 1;
        break;
      default:
        break;
    }
  }


  const startedAt = input.run?.startedAt ? Date.parse(input.run.startedAt) : null;
  const endedAt = input.run?.completedAt ? Date.parse(input.run.completedAt) : null;
  const elapsedMs =
    startedAt !== null && Number.isFinite(startedAt)
      ? Math.max(0, (endedAt ?? (input.now?.() ?? Date.now())) - startedAt)
      : null;

  return {
    // The event log's count while running; the run row's own number once the
    // harness has reported. Never one standing in for the other.
    assistantMessages: Math.max(assistantMessages, input.run?.assistantMessages ?? 0),
    maxSdkIterations: input.limits?.maxTurns ?? null,
    /*
     * The run row's own column, and nothing else.
     *
     * This used to read `agent_finished`'s `assistantMessages` metadata — so the
     * inspector labelled the message count as SDK loop iterations, which is the
     * exact confusion the two names exist to prevent. Null while the harness has
     * not reported one, because there is no observable proxy for it.
     */
    sdkLoopIterations: input.run?.sdkLoopIterations ?? null,
    ...counts,
    elapsedMs,
    wallClockBudgetMs: input.limits?.maxWallClockMs ?? null,
    context: input.run?.context ?? null,
    verification: input.run?.verification ?? null,
    completion: input.run?.completion ?? null,
  };
}

/**
 * The verified candidate count, or null while none exists.
 *
 * From the event rather than from the run row, because the event exists the
 * moment verification finishes and the row is written in the same step — either
 * is correct, and the event is the one a live view already has in memory. Null
 * rather than the observed count standing in: run #3 observed fourteen paths
 * and changed two, and the two numbers are never interchangeable.
 */
function candidateCount(events: readonly StoredExecutionEvent[]): number | null {
  const verified = events.find((event) => event.type === "change_verified");
  return verified ? numberFrom(verified.metadata.candidateFiles) : null;
}

/**
 * The file list, with observed and candidate kept apart.
 *
 * While a run is working, everything is `observed` — the harness touched it and
 * Vibe has not yet compared anything to the base. That is deliberately *not*
 * presented as a change: run `b33635a1` touched eighteen paths and changed six,
 * and a live view that promised eighteen would have been wrong for ten minutes
 * and then wrong again in the other direction.
 *
 * A production view can collapse this to "6 files changed" once
 * `change_verified` exists. The distinction stays in the data either way.
 */
function deriveFiles(events: readonly StoredExecutionEvent[]): LiveFile[] {
  const files = new Map<string, LiveFile>();

  for (const event of events) {
    const path = typeof event.metadata.path === "string" ? event.metadata.path : null;
    if (!path) continue;

    const detail =
      event.type === "file_written"
        ? "added"
        : event.type === "file_edited"
          ? "modified"
          : event.type === "file_read"
            ? "read"
            : null;

    const existing = files.get(path);

    // A file read and then edited is an edit. Never the other way round: a
    // later read must not downgrade what the harness already wrote.
    if (existing && existing.detail !== "read") continue;

    files.set(path, { path, kind: "observed", detail, bytes: null, withheldBy: null });
  }

  return [...files.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
