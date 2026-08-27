import {
  agentCoreCaption,
  agentCoreState,
  agentStageSteps,
  type AgentCoreState,
  type AgentStageStep,
} from "@/modules/coding-agent/observability/agent-stages";
import type { ChangeStage } from "@/modules/execution/change-progress";
import type { OperationStatus } from "@/modules/operations/schema";
import type { TimelineStep } from "@/modules/coding-agent/observability/timeline";

/**
 * The Agent rail's states, in a browser (UI-19).
 *
 * ## Why these need a browser at all
 *
 * The unit tests already prove the *view model* — which stage is active, which
 * is skipped, that no caption estimates. What they cannot see is the thing this
 * sprint is actually about: whether a founder can tell those states apart on a
 * screen. A rail that renders `skipped` and `pending` identically passes every
 * unit test in the file and still tells somebody to keep waiting for work that
 * will never happen.
 *
 * And reduced motion is only real in a browser. `prefers-reduced-motion` is a
 * media query; no assertion about it means anything until something has
 * evaluated it.
 *
 * The steps come from the real `agentStageSteps`, so a change to the rules
 * reaches these screens rather than leaving a fixture behind.
 */

const PHASES = [
  "preparing",
  "working",
  "reviewing_change",
  "preparing_branch",
  "validating",
  "finished",
] as const;

/** The real labels, so a screenshot shows what production shows. */
const PHASE_LABELS: Record<(typeof PHASES)[number], Record<"pending" | "active" | "done", string>> = {
  preparing: {
    pending: "Prepare the project",
    active: "Preparing your project",
    done: "Project prepared",
  },
  working: { pending: "Make the change", active: "Making the change", done: "Change made" },
  reviewing_change: {
    pending: "Check the change",
    active: "Checking the change",
    done: "Change checked",
  },
  preparing_branch: {
    pending: "Prepare your change",
    active: "Preparing your change",
    done: "Change prepared",
  },
  validating: {
    pending: "Independent validation",
    active: "Running independent validation",
    done: "Validation passed",
  },
  finished: { pending: "Ready for review", active: "Finishing up", done: "Ready for review" },
};

function timeline(states: Partial<Record<(typeof PHASES)[number], TimelineStep["state"]>>): TimelineStep[] {
  return PHASES.map((phase) => {
    const state = states[phase] ?? "pending";
    const tense = state === "done" || state === "active" ? state : "pending";
    return { phase, label: PHASE_LABELS[phase][tense], state, detail: null };
  });
}

function progress(stage: ChangeStage) {
  return {
    stage,
    headline: `Headline for ${stage}.`,
    earlySettled: false,
    approved: false,
    merged: stage === "merged",
  };
}

import type { AgentTask } from "@/app/app/projects/[projectId]/agent/agent-task-panel";

/** The Move the reference set works on, in the shape the panel takes. */
const TASK: AgentTask = {
  title: "Make your pricing visible",
  problem: "Turn your existing subscription model into something customers can see and buy.",
  whyNow: "This is your biggest constraint right now and improves multiple areas of your business.",
  impact: "high",
  effort: "medium",
  lens: "revenue_economics",
  steps: [
    "Add a clear pricing section to your website",
    "Connect your existing checkout flow",
    "Make the paid path obvious for visitors",
    "Ensure everything works for signed-in users",
  ],
};

import type { ValidationCheck } from "@/app/app/projects/[projectId]/agent/agent-validation-checks";
import type { StoredExecutionEvent } from "@/modules/coding-agent/observability/events";

/** The four checks the sandbox actually runs, mid-flight. */
const CHECKS: ValidationCheck[] = [
  { name: "Dependencies", detail: "Installing packages", state: "passed" },
  { name: "Type safety", detail: "Checking TypeScript types", state: "passed" },
  { name: "Tests", detail: "Running unit and integration tests", state: "passed" },
  { name: "Production build", detail: "Building for production", state: "running" },
];

const FILE_EVENTS: StoredExecutionEvent[] = ([
  ["Updated pricing page structure", "src/app/pricing/page.tsx"],
  ["Added pricing components", "src/components/pricing/PricingPlans.tsx"],
  ["Connected checkout flow", "src/lib/checkout.ts"],
  ["Updated environment config", ".env.example"],
] as const).map(([summary, path], index) => ({
  sequence: index + 1,
  type: "file_written",
  phase: "working",
  audience: "customer",
  occurredAt: new Date(Date.UTC(2026, 7, 27, 10, 44 + index)).toISOString(),
  summary: summary!,
  metadata: { path: path! },
}));

import type {
  PreviewChange,
  PreviewImages,
} from "@/app/app/projects/[projectId]/agent/agent-preview-stage";

const PREVIEW_CHANGES: PreviewChange[] = [
  {
    title: "Added pricing section",
    detail: "New pricing page with 3 plans and clear value messaging",
    kind: "added",
  },
  {
    title: "Connected existing checkout",
    detail: "Integrated with your current Stripe checkout flow",
    kind: "connected",
  },
  {
    title: "Added upgrade CTA",
    detail: "New CTA in navbar and hero for better conversions",
    kind: "improved",
  },
];

/*
 * No image URLs in a fixture. Real captures are short-lived signed URLs minted
 * per request, and a fixture pointing at a file would prove the frame renders
 * something rather than that it renders a capture. The absent state is the one
 * this suite can assert honestly.
 */
const PREVIEW_IMAGES: PreviewImages | null = null;

type Fixture = {
  steps: AgentStageStep[];
  core: AgentCoreState;
  caption: string;
  /** The run's own phase rows, for the live-activity panel. */
  activity: TimelineStep[];
  task: AgentTask | null;
  checks: ValidationCheck[];
  previewChanges: PreviewChange[];
  previewImages: PreviewImages | null;
  fileEvents: StoredExecutionEvent[];
};

function build(input: Parameters<typeof agentStageSteps>[0]): Fixture {
  const steps = agentStageSteps(input);
  return {
    steps,
    core: agentCoreState(steps),
    caption: agentCoreCaption(steps),
    activity: [...(input.timeline ?? [])],
    task: input.timeline === null ? null : TASK,
    checks: CHECKS,
    previewChanges: PREVIEW_CHANGES,
    previewImages: PREVIEW_IMAGES,
    fileEvents: FILE_EVENTS,
  };
}

const running = (status: OperationStatus = "running") => ({
  timeline: timeline({ preparing: "done", working: "active" }),
  runStatus: status,
  changeProgress: null,
  filesInspected: 6,
});

export const E2E_AGENT_STAGE_SCENARIOS = {
  /** Nothing has ever run. Five pending stages and an idle core. */
  "agent-stages-idle": () =>
    build({ timeline: null, runStatus: null, changeProgress: null }),

  /** Mid-run. One stage lit, the rest ahead of it. */
  "agent-stages-building": () => build(running()),

  /** The run stopped to ask a question. Amber, and nothing claiming progress. */
  "agent-stages-paused": () => build(running("needs_user")),

  /**
   * The state the rail exists for: a run that ended without reaching three of
   * its stages. Those must not read as "not yet".
   */
  "agent-stages-stopped": () =>
    build({
      timeline: timeline({ preparing: "done", working: "failed" }),
      runStatus: "failed",
      changeProgress: null,
    }),

  /** Stage 3: the checks are the centre of the screen. */
  "agent-stages-validating": () =>
    build({
      timeline: timeline({
        preparing: "done",
        working: "done",
        reviewing_change: "done",
        preparing_branch: "done",
        validating: "active",
      }),
      runStatus: "running",
      changeProgress: null,
      filesInspected: 12,
    }),

  /** Stage 4: before and after, at the same size. */
  "agent-stages-preview": () =>
    build({
      timeline: timeline({
        preparing: "done",
        working: "done",
        reviewing_change: "done",
        preparing_branch: "done",
        validating: "done",
        finished: "done",
      }),
      runStatus: "completed",
      changeProgress: progress("review_required"),
      filesInspected: 12,
      filesChanged: 8,
    }),

  /** A change that reached review without a preview ever existing. */
  "agent-stages-no-preview": () =>
    build({
      timeline: timeline({
        preparing: "done",
        working: "done",
        reviewing_change: "done",
        preparing_branch: "done",
        validating: "done",
        finished: "done",
      }),
      runStatus: "completed",
      changeProgress: progress("review_unavailable"),
      filesInspected: 12,
      filesChanged: 3,
    }),
} as const;

export type E2eAgentStageScenario = keyof typeof E2E_AGENT_STAGE_SCENARIOS;

export function isE2eAgentStageScenario(value: string): value is E2eAgentStageScenario {
  return value in E2E_AGENT_STAGE_SCENARIOS;
}
