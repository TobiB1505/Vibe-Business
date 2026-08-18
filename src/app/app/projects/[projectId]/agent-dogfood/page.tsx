import Link from "next/link";
import { notFound } from "next/navigation";
import { Surface } from "@/components/ui/surface";
import { EmptyState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { MonoLabel } from "@/components/ui/typography";
import { buttonClasses } from "@/components/ui/button";
import { getLatestCompletedActionPlan } from "@/modules/action-plans/store";
import { resolvePlanExecution } from "@/modules/execution-contract/resolver";
import { EXECUTION_MODE_LABELS, EXECUTION_REASON_LABELS } from "@/modules/execution-contract/view";
import { isDogfoodEligibleProject } from "@/modules/coding-agent/website-preflight";
import { requireProjectAccess } from "@/modules/projects/workspace-context";

/**
 * The internal Core-4 dogfood entry point (EXECUTION CORE-4 website gate, §5, §31).
 *
 * **This is not EXECUTION UI-1.** No polished timeline, no animation, no
 * general customer surface. It exists so an operator-allowlisted founder can
 * reach one real product path: pick a step, see why Vibe could or couldn't
 * hand it to the coding agent, and press the one button that starts a real,
 * billed, sandboxed run.
 *
 * **Invisible to everyone else.** A project not on
 * `VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS` gets `notFound()` before anything
 * else is read — the same 404 an unowned project id gets, so the route's mere
 * existence is not observable from the outside (§26, §27).
 *
 * Eligibility is resolved fresh from the current plan every load — never
 * inferred from the Planner's own `executionSupport` on the client (§6 of
 * Core-3, restated for the browser).
 */
export default async function AgentDogfoodPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase } = await requireProjectAccess(projectId);

  if (!isDogfoodEligibleProject(projectId)) notFound();

  const plan = await getLatestCompletedActionPlan(supabase, projectId);

  if (!plan) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader />
        <EmptyState
          title="No Action Plan yet"
          description="The coding agent starts from a real Action Plan step. Plan a Move for this project first — from its current top opportunity — then come back here."
          action={
            <Link href={`/app/projects/${projectId}/moves`} className={buttonClasses({ variant: "primary", size: "sm" })}>
              Go to Moves
            </Link>
          }
        />
      </div>
    );
  }

  const resolutions = resolvePlanExecution({
    plan: { steps: plan.steps, completedSteps: new Set<number>(), isCurrent: true },
    repository: {
      connection: null,
      snapshot: null,
      snapshotId: null,
      snapshotCommitSha: null,
      snapshotIsLatest: false,
      liveHead: null,
    },
    // Index view: whether *money* authorizes this project is already settled
    // by the allowlist check above. What this list needs to show is only the
    // *route* each step would take — the per-step page re-resolves against
    // live repository state before anything can actually run.
    agenticBudgetAuthorized: true,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader />
      <Surface level="section" padding="md" className="flex flex-col gap-1">
        <MonoLabel>plan</MonoLabel>
        <p className="text-fg-prose text-sm">{plan.goal ?? "(no recorded goal)"}</p>
      </Surface>

      <div className="flex flex-col gap-3">
        {resolutions.map((resolution) => {
          const step = plan.steps.find((candidate) => candidate.order === resolution.stepOrder)!;
          const agentic = resolution.mode === "agentic";

          return (
            <Surface key={step.id} level="panel" padding="md" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-fg text-sm font-semibold">
                  #{step.order} — {step.title}
                </p>
                <StatusPill tone={agentic ? "success" : "neutral"}>
                  {EXECUTION_MODE_LABELS[resolution.mode]}
                </StatusPill>
              </div>
              <p className="text-fg-muted text-xs">{EXECUTION_REASON_LABELS[resolution.reason]}</p>
              {agentic && (
                <div className="mt-1">
                  <Link
                    href={`/app/projects/${projectId}/agent-dogfood/${encodeURIComponent(step.id)}`}
                    className={buttonClasses({ variant: "secondary", size: "sm" })}
                  >
                    Review this step
                  </Link>
                </div>
              )}
            </Surface>
          );
        })}
      </div>
    </div>
  );
}

function PageHeader() {
  return (
    <div className="flex flex-col gap-1">
      <MonoLabel>internal — core-4 dogfood</MonoLabel>
      <h1 className="text-fg text-title font-bold">Run with Vibe</h1>
      <p className="text-fg-muted max-w-[65ch] text-sm">
        Not a customer feature. This page is only reachable for a project an operator has
        explicitly enabled for the first real coding-agent runs.
      </p>
    </div>
  );
}
