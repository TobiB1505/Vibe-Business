import type { ActionPlanStep } from "@/modules/action-plans/schema";
import type { FounderInputResolution } from "./schema";

export type FounderCompletionEvidence = Pick<
  FounderInputResolution,
  "id" | "kind" | "subjectKey" | "resolvedStatement" | "supersededAt"
>;

export function matchingFounderResolution(
  step: ActionPlanStep,
  resolutions: readonly FounderCompletionEvidence[],
): FounderCompletionEvidence | null {
  const requirement = step.founderInputRequirement;
  if (!requirement) return null;
  return (
    resolutions.find(
      (resolution) =>
        resolution.supersededAt === null &&
        resolution.kind === requirement.kind &&
        resolution.subjectKey === requirement.subjectKey,
    ) ?? null
  );
}

/**
 * The first real Action Plan completion authority.
 *
 * Only founder-owned requirements are projected here. Vibe execution,
 * founder-action attestation and external-party evidence require different
 * authorities and deliberately remain incomplete until those are integrated.
 */
export function completedStepsFromFounderResolutions(
  steps: readonly ActionPlanStep[],
  resolutions: readonly FounderCompletionEvidence[],
): ReadonlySet<number> {
  return new Set(
    steps
      .filter((step) => matchingFounderResolution(step, resolutions) !== null)
      .map((step) => step.order),
  );
}
