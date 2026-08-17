import type { ExecutionCapability } from "@/modules/execution/schema";
import { matchCapability, type CapabilityMatchContext } from "./capability-registry";
import type { ExecutionSupport, StepActor, StepChangeKind } from "./schema";

/**
 * Server-side execution classification (CORE-2b §10, §46, §48).
 *
 * ## The split
 *
 * ```
 * model  →  actor          who has to act
 *           changeKind     what kind of changed state this produces
 *
 * server →  executionSupport   whether Vibe can act on it today
 *           capability         which real executor, if any
 *           requiresApproval   whether a human would have to say yes first
 * ```
 *
 * Everything on the right of that line is computed here, from the closed
 * vocabularies on the left plus the capability registry. Nothing on the right
 * exists as a wire field, so there is no channel through which a model could
 * assert it — the guarantee is structural rather than a rule the prompt asks
 * the model to respect (§10).
 *
 * ## Why `vibe_prepares` is not `vibe_executes_now`
 *
 * §24 asks the product to do Vibe's work before asking the founder to do
 * theirs: derive the plausible segments, compare them, prepare the
 * recommendation, *then* ask. Those steps are genuinely Vibe's responsibility,
 * and calling them "founder work" would be wrong.
 *
 * They are also not a button. There is no executor that produces a segment
 * comparison on click, and labelling them executable would be the exact
 * dishonesty §94 exists to catch. `vibe_prepares` says the first thing without
 * claiming the second.
 */

export type ClassifyStepInput = {
  actor: StepActor;
  changeKind: StepChangeKind;
  evidenceIds: string[];
};

export type StepClassification = {
  executionSupport: ExecutionSupport;
  capability: ExecutionCapability | null;
  capabilityVersion: string | null;
  requiresApproval: boolean;
};

/**
 * Would carrying this step out change something outside the plan (§50)?
 *
 * Derived from the change kind alone, because approval is a property of the
 * *consequence*, not of who does it or of whether Vibe could. A founder-run
 * product change still needs the founder to approve it; that it needs approval
 * says nothing about whether Vibe can perform it.
 *
 * So `requiresApproval` and `executionSupport` are independent, and the pair
 * `requiresApproval: true, executionSupport: "not_yet_supported"` is both
 * representable and common — which is exactly what §50 requires.
 */
function requiresApproval(changeKind: StepChangeKind): boolean {
  return changeKind === "product_change" || changeKind === "external_setup";
}

export function classifyStep(
  step: ClassifyStepInput,
  context: CapabilityMatchContext,
): StepClassification {
  const approval = requiresApproval(step.changeKind);

  switch (step.actor) {
    case "external_party":
      // Not a failure and not Vibe's fault (§27). Something outside the system
      // has to happen, and the plan says so rather than pretending otherwise.
      return {
        executionSupport: "external_dependency",
        capability: null,
        capabilityVersion: null,
        requiresApproval: approval,
      };

    case "founder_decision":
      return {
        executionSupport: "founder_decides",
        capability: null,
        capabilityVersion: null,
        requiresApproval: approval,
      };

    case "founder_action":
      return {
        executionSupport: "founder_acts",
        capability: null,
        capabilityVersion: null,
        requiresApproval: approval,
      };

    case "vibe": {
      // The only path to `vibe_executes_now`, and it goes through the registry.
      // No model field, no confidence value and no wording reaches this branch.
      const match = matchCapability(
        { changeKind: step.changeKind, evidenceIds: step.evidenceIds },
        context,
      );

      if (match) {
        return {
          executionSupport: "vibe_executes_now",
          capability: match.capability,
          capabilityVersion: match.capabilityVersion,
          requiresApproval: approval,
        };
      }

      // Vibe's own reasoning work, done from evidence it already holds.
      if (step.changeKind === "analysis" || step.changeKind === "measurement") {
        return {
          executionSupport: "vibe_prepares",
          capability: null,
          capabilityVersion: null,
          requiresApproval: approval,
        };
      }

      // A real business action Vibe should eventually carry out and currently
      // cannot. Kept in the plan (§28); never described as executable.
      return {
        executionSupport: "not_yet_supported",
        capability: null,
        capabilityVersion: null,
        requiresApproval: approval,
      };
    }
  }
}
