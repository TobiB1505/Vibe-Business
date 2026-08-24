import Link from "next/link";
import { notFound } from "next/navigation";
import { Surface } from "@/components/ui/surface";
import { EmptyState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { MonoLabel } from "@/components/ui/typography";
import { buttonClasses } from "@/components/ui/button";
import { EXECUTION_MODE_LABELS, EXECUTION_REASON_LABELS } from "@/modules/execution-contract/view";
import { resolveDogfoodPlanRoutes } from "@/modules/coding-agent/website-preflight";
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
  const { supabase, userId } = await requireProjectAccess(projectId);

  /*
   * One call, resolved server-side against the project's real repository.
   *
   * The page used to gate, load the plan and resolve inline — and resolved
   * against a repository context of all nulls, which made every implementation
   * step permanently "waiting on an earlier step" and the whole surface
   * unreachable. Routing is a server question about real state, so it lives in
   * `website-preflight.ts` beside the per-step preflight that answers the same
   * question one step deeper.
   */
  const routes = await resolveDogfoodPlanRoutes(supabase, { projectId, userId });

  if (!routes.available && routes.reason === "not_dogfood_eligible") notFound();

  if (!routes.available) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader />
        <EmptyState
          title="No Action Plan yet"
          description="The coding agent starts from a real Action Plan step. Plan a Move for this project first — from its current top opportunity — then come back here."
          action={
            <Link href={`/app/projects/${projectId}/plan`} className={buttonClasses({ variant: "primary", size: "sm" })}>
              Go to Moves
            </Link>
          }
        />
      </div>
    );
  }

  const { plan, resolutions } = routes;

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
              {/*
                What this run would carry out before the change itself
                (semantics fix §15). Named rather than silently folded in: a
                founder looking at "#2 can run" while "#1" is still open is
                owed the sentence that says why, and this is it.
              */}
              {resolution.absorbedPreparation.length > 0 && (
                <p className="text-fg-meta text-xs">
                  Vibe does this first, as part of the same run:{" "}
                  {resolution.absorbedPreparation
                    .map((order) => `#${order}`)
                    .join(", ")}
                </p>
              )}
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
