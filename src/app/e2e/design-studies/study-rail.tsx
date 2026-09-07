import { NovaRail } from "@/app/app/projects/[projectId]/nova/nova-rail";
import type { ActionPlanChecklist } from "@/modules/action-plans/service";
import { buildActivityFeed } from "@/modules/audit-log/view";
import type { AuditEventRecord } from "@/modules/audit-log/queries";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import type { Study } from "./studies";

/**
 * The rail, drawn from the product's own component.
 *
 * ## Why this sheet exists
 *
 * The rail shipped with nothing that could look at it. Home is behind a
 * session and a project in a particular state, so the only way to see a plan
 * three steps in with two events behind it was to be a founder in exactly that
 * position. This mounts `NovaRail` itself — not a copy — with fixtures, so the
 * four states it can be in are one page rather than four accounts.
 *
 * The data is a fixture; the component is production. A study that redrew the
 * rail would be a picture of a rail, and the first change to either would make
 * it a lie.
 */

function step(
  order: number,
  title: string,
  actor: ActionPlanStep["actor"],
  dependsOn: number[],
): ActionPlanStep {
  return {
    id: `step_${order}`,
    order,
    title,
    description: "",
    purpose: "",
    actor,
    changeKind: actor === "vibe" ? "product_change" : "decision",
    completionCriteria: "",
    dependsOn,
    evidenceIds: [],
    founderInputRequirement: null,
    executionSupport:
      actor === "vibe"
        ? "vibe_executes_now"
        : actor === "founder_decision"
          ? "founder_decides"
          : "founder_acts",
    capability: null,
    requiresApproval: false,
  };
}

const STEPS: ActionPlanStep[] = [
  step(1, "Read what the site promises today", "vibe", []),
  step(2, "Decide who the pricing page is for", "founder_decision", [1]),
  step(3, "Write the pricing page", "vibe", [2]),
  step(4, "Put the price on the home page", "vibe", [3]),
  step(5, "Tell your existing customers", "founder_action", [4]),
];

const CHECKLIST: ActionPlanChecklist = {
  steps: STEPS,
  firstActionableOrder: 2,
  completedStepOrders: [1],
  absorbedByStepOrder: {},
};

const RECORDS: AuditEventRecord[] = [
  {
    id: "act-1",
    eventType: "agent_execution.change_verified",
    createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    metadata: { commitSha: "9f2c41ab77e3d5" },
  },
  {
    id: "act-2",
    eventType: "agent_execution.completed",
    createdAt: new Date(Date.now() - 32 * 60_000).toISOString(),
    metadata: {},
  },
  {
    id: "act-3",
    eventType: "business_audit.completed",
    createdAt: new Date(Date.now() - 16 * 3600_000).toISOString(),
    metadata: {},
  },
];

const ACTIVITY = buildActivityFeed(RECORDS).reverse();

export function StudyRail({ study }: { study: Study }) {
  const panel =
    study.skin === "glass"
      ? "study-glass rounded-panel"
      : "rounded-panel border border-line-2 bg-surface-1";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10 max-sm:px-4">
      <div className="border-line-3 bg-well rounded-panel flex flex-col gap-3 border border-dashed p-5">
        <p className="text-label text-fg-meta font-mono tracking-[0.16em] uppercase">The rail</p>
        <p className="text-fg-prose study-measure text-sm leading-relaxed">
          Nova, the sequence, and what already happened. The mark carries the state and the line
          under it is the stage the executor wrote — never a model&rsquo;s account of its own
          thinking. Below it the plan in its own order, and the event log, which is the one thing on
          this screen that is a record rather than a re-derivation.
        </p>
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className="text-label text-fg-meta font-mono tracking-[0.16em] uppercase">
            Working, with a plan
          </p>
          <NovaRail
            presence="working"
            seed="project_e2e"
            working={{
              operationId: "op-1",
              stageLabel: "Reading what you built",
              phase: "working",
              shouldPoll: true,
            }}
            checklist={CHECKLIST}
            activity={ACTIVITY}
          />
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-label text-fg-meta font-mono tracking-[0.16em] uppercase">
            Idle, and nothing planned yet
          </p>
          {/*
            Both absences at once, which is the state a new project is in. No
            stage line because nothing is running, no plan because none has
            completed, and no log because nothing has happened — each section
            simply absent rather than an empty box explaining itself.
          */}
          <NovaRail
            presence="idle"
            seed="project_e2e"
            working={null}
            checklist={null}
            activity={[]}
          />
        </div>
      </div>

      <div className={`flex flex-col gap-3 p-5 ${panel}`}>
        <p className="text-label text-fg-meta font-mono tracking-[0.16em] uppercase">
          Everything done
        </p>
        <NovaRail
          presence="settled"
          seed="project_e2e"
          working={null}
          checklist={{
            steps: STEPS,
            firstActionableOrder: null,
            completedStepOrders: [1, 2, 3, 4, 5],
            absorbedByStepOrder: {},
          }}
          activity={ACTIVITY}
        />
      </div>
    </div>
  );
}
