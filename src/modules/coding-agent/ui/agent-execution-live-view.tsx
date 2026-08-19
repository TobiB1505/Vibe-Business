"use client";

import type { ReactNode } from "react";
import { Disclosure } from "@/components/ui/disclosure";
import { Metric } from "@/components/ui/metric";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import type { AgentExecutionLiveModel, LiveFile, ValidationState } from "../observability/live-view";
import type { StoredExecutionEvent } from "../observability/events";
import type { TimelineStep } from "../observability/timeline";
import {
  UNKNOWN,
  formatBytes,
  formatClock,
  formatDuration,
  formatPercent,
  formatTokens,
  formatUsd,
} from "./format";

/**
 * One agent execution, live (EXECUTION CORE-4 observability).
 *
 * ## Reusable on purpose
 *
 * This component takes a model and renders it. It reads nothing, fetches
 * nothing and knows about no route — so mounting it in the production dashboard
 * later is an import and a data call, not a rewrite. The Dogfood page is its
 * first host, not its home.
 *
 * ## Two readers, one component
 *
 * The default view is for somebody who wants to know whether their change is
 * happening: six named steps, the current action, the files, the validation
 * state. Everything else — tokens, gateway calls, cache ratios, the raw feed —
 * lives behind **Developer details**, collapsed, because a founder watching
 * their site get fixed does not need `cache_creation_input_tokens` and the
 * person debugging run #3 needs all of it.
 *
 * ## What is deliberately not here
 *
 * The model's reasoning. There is no component for it because there is no field
 * for it: the event log records actions, tools, paths, commands, durations and
 * costs, and has no column a sentence could arrive in. What a person sees is
 * "Updated login/page.tsx", never why the model thought it should.
 */

export function AgentExecutionLiveView({
  model,
  developerDetails = true,
}: {
  model: AgentExecutionLiveModel;
  /** Off for a customer-facing mount; on for the dogfood surface. */
  developerDetails?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ExecutionHeader model={model} />
      <ExecutionTimeline steps={model.timeline} />
      <ChangedFilesPanel files={model.files} candidateFiles={candidateFileCount(model)} />
      <ValidationPanel state={model.validation} />
      {developerDetails ? <DeveloperInspector model={model} /> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Header
 * ------------------------------------------------------------------------ */

const STATUS_TONES: Record<string, StatusTone> = {
  queued: "waiting",
  running: "active",
  needs_user: "waiting",
  completed: "success",
  failed: "problem",
  cancelled: "neutral",
};

function ExecutionHeader({ model }: { model: AgentExecutionLiveModel }) {
  const { operation, metrics } = model;
  const live = operation.shouldPoll;

  return (
    <Surface level="section" padding="md" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-fg-body text-lg font-medium">
            {live ? "Building your change" : headline(operation.status)}
          </h2>
          {model.currentAction ? (
            <p className="text-fg-muted truncate text-sm">{model.currentAction}</p>
          ) : null}
        </div>
        <StatusPill tone={STATUS_TONES[operation.status] ?? "neutral"} dot={live}>
          {operation.status.replace(/_/g, " ")}
        </StatusPill>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Elapsed" value={formatDuration(metrics.elapsedMs)} mono />
        <Metric
          label="Time budget"
          value={formatDuration(metrics.wallClockBudgetMs)}
          mono
        />
        <Metric label="Files inspected" value={metrics.filesRead || null} mono />
        <Metric label="Commands run" value={metrics.commands || null} mono />
      </div>
    </Surface>
  );
}

function headline(status: string): string {
  if (status === "completed") return "Your change is ready";
  if (status === "failed") return "The run stopped";
  if (status === "needs_user") return "Waiting on your answer";
  return "Preparing";
}

/* ---------------------------------------------------------------------------
 * Timeline
 * ------------------------------------------------------------------------ */

const MARKS: Record<TimelineStep["state"], string> = {
  done: "✓",
  active: "●",
  failed: "✕",
  pending: "○",
  skipped: "·",
};

const MARK_CLASSES: Record<TimelineStep["state"], string> = {
  done: "text-mint",
  active: "text-mint animate-pulse",
  failed: "text-coral",
  pending: "text-fg-faint",
  skipped: "text-fg-faint",
};

export function ExecutionTimeline({ steps }: { steps: readonly TimelineStep[] }) {
  return (
    <Surface level="section" padding="md" className="flex flex-col gap-3">
      <MonoLabel>Progress</MonoLabel>
      <ol className="flex flex-col gap-2">
        {steps.map((step) => (
          <li key={step.phase} className="flex items-start gap-3">
            <span
              aria-hidden
              className={`mt-0.5 w-4 shrink-0 text-center font-mono text-sm ${MARK_CLASSES[step.state]}`}
            >
              {MARKS[step.state]}
            </span>
            <span className="flex min-w-0 flex-col">
              <span
                className={
                  step.state === "pending" || step.state === "skipped"
                    ? "text-fg-faint text-sm"
                    : "text-fg-body text-sm"
                }
              >
                {step.label}
              </span>
              {step.detail ? (
                <span className="text-fg-muted truncate text-xs">{step.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </Surface>
  );
}

/* ---------------------------------------------------------------------------
 * Files
 * ------------------------------------------------------------------------ */

function candidateFileCount(model: AgentExecutionLiveModel): number | null {
  const verified = model.events.find((event) => event.type === "change_verified");
  const value = verified?.metadata.candidateFiles;
  return typeof value === "number" ? value : null;
}

/**
 * What the run touched, and what of it is actually a change.
 *
 * The two are labelled separately and never merged. While a run is working
 * every path is `observed` — the harness read or wrote it and Vibe has compared
 * nothing yet — and the panel says so. Run `b33635a1` touched eighteen paths
 * and changed six; a panel that had promised eighteen changes would have been
 * wrong for ten minutes and then wrong the other way.
 */
export function ChangedFilesPanel({
  files,
  candidateFiles,
}: {
  files: readonly LiveFile[];
  candidateFiles: number | null;
}) {
  if (files.length === 0) return null;

  const verified = candidateFiles !== null;

  return (
    <Surface level="section" padding="md" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonoLabel>Files</MonoLabel>
        <span className="text-fg-muted text-xs">
          {verified
            ? `${candidateFiles} in the change · ${files.length} touched`
            : `${files.length} touched so far`}
        </span>
      </div>

      {!verified ? (
        <p className="text-fg-faint text-xs">
          Files the agent has opened or written. Which of them become the change is
          decided afterwards, by comparing the workspace against your repository.
        </p>
      ) : null}

      <ul className="flex flex-col gap-1">
        {files.slice(0, 40).map((file) => (
          <li key={file.path} className="flex items-baseline gap-3 font-mono text-xs">
            <span className="text-fg-faint w-16 shrink-0 uppercase">{file.detail ?? "seen"}</span>
            <span className="text-fg-body min-w-0 break-all">{file.path}</span>
          </li>
        ))}
      </ul>
      {files.length > 40 ? (
        <span className="text-fg-faint text-xs">and {files.length - 40} more</span>
      ) : null}
    </Surface>
  );
}

/* ---------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------ */

const VALIDATION_COPY: Record<ValidationState, { label: string; tone: StatusTone }> = {
  not_started: { label: "Not started", tone: "neutral" },
  queued: { label: "Queued", tone: "waiting" },
  running: { label: "Running", tone: "active" },
  passed: { label: "Passed", tone: "success" },
  failed: { label: "Failed", tone: "problem" },
};

/**
 * The independent validation sandbox's slot.
 *
 * Present before it is reachable, and honest about that. Validation is a
 * *separate* system that runs against the prepared branch after this execution
 * ends — the agent's own checks are advisory and Vibe's are the verdict — so
 * this panel reports its state and never synthesises one from the agent's.
 */
export function ValidationPanel({ state }: { state: ValidationState }) {
  const copy = VALIDATION_COPY[state];

  return (
    <Surface level="section" padding="md" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <MonoLabel>Independent validation</MonoLabel>
        <StatusPill tone={copy.tone} dot={state === "running"}>
          {copy.label}
        </StatusPill>
      </div>
      <p className="text-fg-faint text-xs">
        {state === "not_started"
          ? "Runs in its own isolated sandbox once a change has been prepared. Typecheck, tests and build are re-run there — the agent's own checks do not decide this."
          : "Typecheck, tests and build, re-run independently against the prepared branch."}
      </p>
    </Surface>
  );
}

/* ---------------------------------------------------------------------------
 * Developer inspector
 * ------------------------------------------------------------------------ */

export function DeveloperInspector({ model }: { model: AgentExecutionLiveModel }) {
  const { metrics, economics, operation } = model;
  const provider = economics.provider;

  return (
    <Surface level="section" padding="md">
      <Disclosure label="Developer details">
        <div className="mt-4 flex flex-col gap-6">
          <InspectorGroup label="Execution">
            <Metric label="Run" value={operation.agentExecutionRunId} mono />
            <Metric label="Operation" value={operation.operationId} mono />
            <Metric label="Status" value={operation.status} mono />
            <Metric label="Stage" value={operation.stage} mono />
            <Metric label="Elapsed" value={formatDuration(metrics.elapsedMs)} mono />
            <Metric label="Wall-clock budget" value={formatDuration(metrics.wallClockBudgetMs)} mono />
          </InspectorGroup>

          {/*
            Two counters, two names, and never a ratio between them.

            `assistantMessages` counts model responses; `maxSdkIterations`
            bounds the harness's own loop, which also advances on tool results.
            Run b33635a1 recorded 66 of the first against a ceiling of 40 of the
            second and overran nothing — rendering that as "66 / 40" would have
            reported a breach that did not happen.
          */}
          <InspectorGroup label="Agent">
            <Metric label="Assistant messages" value={metrics.assistantMessages || null} mono />
            <Metric
              label="SDK loop iterations"
              value={metrics.sdkLoopIterations ?? UNKNOWN}
              mono
            />
            <Metric label="Max SDK iterations" value={metrics.maxSdkIterations} mono />
            <Metric label="Files read" value={metrics.filesRead || null} mono />
            <Metric label="Files written" value={metrics.filesWritten || null} mono />
            <Metric label="Files edited" value={metrics.filesEdited || null} mono />
          </InspectorGroup>

          {/*
            Where the run's work went once the code was written.

            The panel run #5 needed and nobody had: it spent 69% of its wall
            clock and eight of fifteen provider calls after its last edit, and
            the only way to see that was to reconstruct it from raw events
            afterwards.

            "Refused" is shown, never hidden. A bounded agent that is silently
            bounded cannot be told apart from one that chose to stop, and a
            budget that turns out to be too tight should look like evidence.
          */}
          {metrics.completion ? (
            <InspectorGroup label="After the change">
              <Metric label="Budget" value={metrics.completion.budgetVersion} mono />
              <Metric
                label="Implementation"
                value={formatDuration(metrics.verification?.timeToLastEditMs ?? null) ?? UNKNOWN}
                mono
              />
              <Metric label="Tool calls" value={metrics.completion.toolCalls ?? UNKNOWN} mono />
              <Metric label="Reads" value={metrics.completion.reads ?? UNKNOWN} mono />
              <Metric
                label="Reads beyond brief"
                value={metrics.completion.readsBeyondBrief ?? UNKNOWN}
                mono
              />
              <Metric label="Commands" value={metrics.completion.commands ?? UNKNOWN} mono />
              <Metric
                label="Provider calls"
                value={metrics.completion.providerCalls ?? UNKNOWN}
                mono
              />
              <Metric
                label="Provider cost"
                value={formatUsd(metrics.completion.providerCostUsd) ?? UNKNOWN}
                mono
              />
              <Metric label="Refused" value={metrics.completion.refusals ?? UNKNOWN} mono />
              {/*
                Two counters, because run #6 proved one cannot mean both. It
                edited two files with nothing failing and recorded a "repair
                cycle" for the second. Windows reset on any edit; a repair is
                one that answered an observed failure.
              */}
              <Metric label="Windows" value={metrics.completion.completionWindows ?? UNKNOWN} mono />
              <Metric label="Repairs" value={metrics.completion.repairCycles ?? UNKNOWN} mono />
              {/*
                Zero decisions beside a run full of tool calls means the policy
                never ran — the exact failure that made run #5 execute a
                governed command while recording nothing. It is shown so that
                state is visible rather than inferred.
              */}
              <Metric
                label="Policy decisions"
                value={metrics.completion.policyDecisions ?? UNKNOWN}
                mono
              />
            </InspectorGroup>
          ) : null}

          {/*
            How much this run was allowed to check its own work.

            Developer detail only, and deliberately not a customer surface: a
            founder wants to know their change is being checked, not to tune a
            verification mode. "Skipped by policy" is shown rather than hidden,
            because a bounded agent that is silently bounded is one nobody can
            tell apart from an agent that chose to stop.

            Nothing here is a verdict. A run whose every permitted check passed
            has proved that the agent found no mistake it could see — the
            independent validation row below is the one that decides anything.
          */}
          {metrics.verification ? (
            <InspectorGroup label="Agent verification">
              <Metric label="Mode" value={metrics.verification.mode} mono />
              <Metric label="Checks run" value={metrics.verification.commands ?? UNKNOWN} mono />
              <Metric
                label="Refused by policy"
                value={metrics.verification.refusals ?? UNKNOWN}
                mono
              />
              <Metric
                label="First edit at"
                value={formatDuration(metrics.verification.timeToFirstEditMs) ?? UNKNOWN}
                mono
              />
              {/*
                Named for what it measures. Vibe cannot observe the moment an
                agent believes it is finished; it can observe the last time the
                agent wrote a file, and everything after that was checking or
                exploring.
              */}
              <Metric
                label="Last edit at"
                value={formatDuration(metrics.verification.timeToLastEditMs) ?? UNKNOWN}
                mono
              />
              <Metric
                label="Checking time"
                value={formatDuration(metrics.verification.verificationMs) ?? UNKNOWN}
                mono
              />
              {economics.afterLastEdit ? (
                <>
                  <Metric label="Calls after last edit" value={economics.afterLastEdit.calls} mono />
                  <Metric
                    label="Cost after last edit"
                    value={formatUsd(economics.afterLastEdit.costUsd)}
                    mono
                  />
                  <Metric
                    label="Share of run cost"
                    value={formatPercent(economics.afterLastEdit.shareOfCost)}
                    mono
                  />
                </>
              ) : null}
            </InspectorGroup>
          ) : null}

          {/*
            What the run started from, and where its reading went.

            Raw counts, never a ratio (PART M). "Read 3 of 6 briefed files" is
            checkable; a "context hit rate" is a number whose denominator is
            arguable and whose movement nobody can act on. Files read beyond the
            briefing is deliberately not framed as a miss — the instruction tells
            the agent to look wider when the briefing does not cover what it
            needs, so a high number here can mean the brief was thin or that the
            step was simply larger than the analysis.
          */}
          {metrics.context ? (
            <InspectorGroup label="Context">
              <Metric label="Brief" value={metrics.context.briefVersion} mono />
              <Metric label="Freshness" value={metrics.context.freshness} mono />
              <Metric label="Prompt bytes" value={formatBytes(metrics.context.bytes)} mono />
              <Metric label="Facts sent" value={metrics.context.factsSent || null} mono />
              <Metric label="Files offered" value={metrics.context.candidatesSent || null} mono />
              <Metric
                label="Offered files read"
                value={metrics.context.candidatesRead ?? UNKNOWN}
                mono
              />
              <Metric
                label="Unique files read"
                value={metrics.context.uniqueFilesRead ?? UNKNOWN}
                mono
              />
              <Metric
                label="Re-reads"
                value={metrics.context.repeatedFileReads ?? UNKNOWN}
                mono
              />
              <Metric
                label="Read beyond brief"
                value={metrics.context.filesReadOutsideContext ?? UNKNOWN}
                mono
              />
            </InspectorGroup>
          ) : null}

          <InspectorGroup label="Provider">
            <Metric label="Gateway requests" value={provider.calls || null} mono />
            <Metric label="Request ceiling" value={model.gatewayRequestCeiling} mono />
            <Metric label="Succeeded" value={provider.succeededCalls || null} mono />
            <Metric label="Failed" value={provider.failedCalls || null} mono />
            <Metric
              label="Avg input / call"
              value={formatTokens(provider.averageInputTokensPerCall)}
              mono
            />
            <Metric
              label="Largest call"
              value={formatTokens(provider.largestCallInputTokens)}
              mono
            />
          </InspectorGroup>

          <InspectorGroup label="Tokens">
            <Metric label="Input" value={formatTokens(provider.inputTokens)} mono />
            <Metric label="Output" value={formatTokens(provider.outputTokens)} mono />
            <Metric label="Cache read" value={formatTokens(provider.cacheReadInputTokens)} mono />
            <Metric
              label="Cache write"
              value={formatTokens(provider.cacheCreationInputTokens)}
              mono
            />
            <Metric label="Thinking" value={formatTokens(provider.thinkingTokens)} mono />
            <Metric label="Cache hit ratio" value={formatPercent(provider.cacheHitRatio)} mono />
          </InspectorGroup>

          {/*
            Sandbox cost is shown as `not reported` rather than derived. The
            provider does not price a sandbox per run and this codebase stores
            no rate, so a computed figure would look like money and not be.
          */}
          <InspectorGroup label="Cost">
            <Metric label="Provider" value={formatUsd(provider.costUsd)} mono />
            <Metric label="Sandbox" value={formatUsd(economics.sandbox.costUsd) ?? UNKNOWN} mono />
            <Metric label="Total" value={formatUsd(economics.totalCostUsd) ?? UNKNOWN} mono />
            <Metric label="Provider budget" value={formatUsd(economics.providerBudgetUsd)} mono />
            <Metric
              label="Budget remaining"
              value={formatUsd(economics.providerBudgetRemainingUsd)}
              mono
            />
            <Metric label="Active CPU" value={formatDuration(economics.sandbox.activeCpuMs)} mono />
          </InspectorGroup>

          <InspectorGroup label="Network">
            <Metric label="Egress" value={formatBytes(economics.sandbox.networkEgressBytes)} mono />
            <Metric
              label="Ingress"
              value={formatBytes(economics.sandbox.networkIngressBytes)}
              mono
            />
            <Metric label="Sandbox duration" value={formatDuration(economics.sandbox.durationMs)} mono />
          </InspectorGroup>

          <ActivityFeed events={model.events} />
        </div>
      </Disclosure>
    </Surface>
  );
}

function InspectorGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <MonoLabel className="tracking-[0.14em]">{label}</MonoLabel>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{children}</div>
    </div>
  );
}

/** The verb shown in the feed. Composed here, from the event type alone. */
const FEED_VERBS: Record<string, string> = {
  file_read: "READ",
  file_written: "WRITE",
  file_edited: "EDIT",
  file_searched: "SEARCH",
  command_started: "COMMAND",
  command_completed: "PASS",
  command_failed: "FAIL",
  turn_completed: "TURN",
  usage_updated: "USAGE",
  verification_check_started: "CHECK",
  verification_command_refused: "SKIP",
  verification_escalated: "ESCALATE",
  completion_action_refused: "STOP",
  completion_window_started: "WROTE",
  completion_repair_started: "REPAIR",
};

export function ActivityFeed({ events }: { events: readonly StoredExecutionEvent[] }) {
  if (events.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <MonoLabel className="tracking-[0.14em]">Activity</MonoLabel>
      {/*
        Scrolls inside its own box rather than stretching the page. A run can
        produce hundreds of lines and the panel below it must stay reachable.
      */}
      <div className="border-line-2 max-h-96 overflow-y-auto rounded-md border">
        <ul className="divide-line-2 divide-y">
          {events.map((event) => (
            <li
              key={event.sequence}
              className="flex items-baseline gap-3 px-3 py-1.5 font-mono text-[0.6875rem]"
            >
              <span className="text-fg-faint shrink-0">{formatClock(event.occurredAt)}</span>
              <span className="text-fg-muted w-16 shrink-0">
                {FEED_VERBS[event.type] ?? event.type.replace(/_/g, " ").toUpperCase().slice(0, 14)}
              </span>
              <span className="text-fg-body min-w-0 break-all">{event.summary}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
