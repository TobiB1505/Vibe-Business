import type { SupabaseClient } from "@supabase/supabase-js";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import { resolveValidationProfile, type ProfileResolution } from "@/modules/validation/profile";
import { resolveProjectValidationTarget } from "@/modules/validation/workspace-store";
import {
  SANDBOX_POLICY_VERSION,
  validationProfileVersionFor,
  type ValidationBlockReason,
  type ValidationProfile,
  type ValidationStepName,
} from "@/modules/validation/schema";

/**
 * What must independently pass before agent output becomes reviewable
 * (EXECUTION CORE-3 §30, §31, §53).
 *
 * ## Derived, never declared
 *
 * §53 asks for a *real* required-validation profile connected to the existing
 * validation architecture, not a generic `tests: true`. So this file has no
 * opinions of its own: it asks `resolveValidationProfile` — the same function
 * change validation already uses — what this repository supports, and reports
 * that. A repository with no matching profile produces
 * `validation_not_supported`, and `eligibility.ts` turns that into a refusal.
 *
 * That coupling is the point. If a change cannot be independently validated,
 * there is no honest way to let an agent produce one: the only remaining
 * evidence would be the agent's own claim, which §31 says is not authority.
 *
 * ## The two halves
 *
 * ```
 * preconditions   checked by Vibe against the produced file set, before any write
 * sandboxSteps    the profile's own commands, run in an isolated VM by Vibe
 * ```
 *
 * The preconditions are cheap, deterministic and non-negotiable — they are what
 * makes a diff legal. The sandbox steps are the existing `ValidationRun`, reused
 * exactly (§30, §37 of the DoD): no second validation pipeline is introduced.
 */

/**
 * Checks Vibe performs on the produced change itself, before a branch exists.
 *
 * Every one is observable from the file set plus the spec — none requires
 * running anything, and none may be answered by the agent. `no_secret_material_introduced`
 * is a content check on the produced bytes, distinct from
 * `no_forbidden_paths_changed`, which is a path check: a secret pasted into an
 * ordinary source file passes the path check and must still fail.
 */
export const EXECUTION_PRECONDITIONS = [
  /** The workspace was materialized from the exact base SHA the spec pinned (§16). */
  "source_revision_verified",
  /** Every changed path is inside the compiled write scope (§17, §18). */
  "no_forbidden_paths_changed",
  /** Changed-file count and diff size are within the policy's ceilings. */
  "diff_scope_within_policy",
  /** No credential-shaped content appears in the produced bytes (§11). */
  "no_secret_material_introduced",
] as const;
export type ExecutionPrecondition = (typeof EXECUTION_PRECONDITIONS)[number];

/**
 * Who is allowed to say a check passed (§31).
 *
 * A single value, expressed as a type so that "the agent reported success"
 * cannot be represented at all. A future adapter that wanted to record an
 * agent's self-assessment would have to change this union, which is a change
 * with a reviewer attached.
 */
export type ValidationAuthority = "vibe_observed";

export type ExecutionValidationRequirement =
  | {
      supported: true;
      authority: ValidationAuthority;
      preconditions: readonly ExecutionPrecondition[];
      profile: ValidationProfile;
      profileVersion: string;
      sandboxPolicyVersion: typeof SANDBOX_POLICY_VERSION;
      /** The profile's own steps. Reused, not redefined (§30). */
      sandboxSteps: readonly ValidationStepName[];
      /** Where those steps would run. `"."` for a single-application repository. */
      workspaceRoot: string;
    }
  | {
      supported: false;
      authority: ValidationAuthority;
      preconditions: readonly ExecutionPrecondition[];
      reason: ValidationBlockReason;
    };

/**
 * The steps both existing profiles run.
 *
 * Listed rather than imported from `VALIDATION_STEPS` so that the spec records
 * what was *required*, not what the constant happens to contain later. A stored
 * spec must stay interpretable when a future profile requires a different set.
 */
const NEXTJS_NODE_V1_STEPS: readonly ValidationStepName[] = [
  "install",
  "typecheck",
  "test",
  "build",
] as const;

const PROFILE_STEPS: Record<ValidationProfile, readonly ValidationStepName[]> = {
  nextjs_node_v1: NEXTJS_NODE_V1_STEPS,
  // The same four. The contract profile changed which repositories are
  // admitted, not what is run once one is — `planValidationSteps` never took a
  // profile, and these are the steps it plans.
  node_build_v1: NEXTJS_NODE_V1_STEPS,
};

/**
 * What this repository's changes would have to pass (§30, §53).
 *
 * The preconditions are returned in both branches deliberately: they are
 * unconditional, and a spec whose sandbox profile is unsupported still records
 * that a diff would have had to stay inside scope. Nothing about a missing
 * profile relaxes the path or secret rules.
 */
export function resolveExecutionValidation(
  snapshot: RepositoryIntelligenceSnapshot,
): ExecutionValidationRequirement {
  return requirementFor(resolveValidationProfile(snapshot));
}

/** The requirement one resolution implies. Shared by both forms below. */
function requirementFor(resolution: ProfileResolution): ExecutionValidationRequirement {
  if (!resolution.supported) {
    return {
      supported: false,
      authority: "vibe_observed",
      preconditions: EXECUTION_PRECONDITIONS,
      reason: resolution.reason,
    };
  }

  return {
    supported: true,
    authority: "vibe_observed",
    preconditions: EXECUTION_PRECONDITIONS,
    profile: resolution.profile,
    profileVersion: validationProfileVersionFor(resolution.profile),
    sandboxPolicyVersion: SANDBOX_POLICY_VERSION,
    sandboxSteps: PROFILE_STEPS[resolution.profile],
    workspaceRoot: resolution.workspaceRoot,
  };
}

/**
 * The same requirement, with the founder's answer to "which application?" applied.
 *
 * `resolveExecutionValidation` reads the repository's shape and nothing else,
 * which is right for a pure function and wrong for a decision: a repository with
 * more than one application reports `workspace_choice_required` forever, even
 * once its owner has said which one Vibe works on. This is the asynchronous
 * form, for the callers that are deciding rather than describing.
 *
 * Separate rather than merged so the pure one stays pure — `resolver.ts` maps
 * plan steps synchronously, and a database read per step is not a thing to
 * introduce for a project-level fact.
 */
export async function resolveProjectExecutionValidation(
  supabase: SupabaseClient,
  params: { projectId: string; snapshot: RepositoryIntelligenceSnapshot },
): Promise<ExecutionValidationRequirement> {
  const resolution = await resolveProjectValidationTarget(supabase, params);
  return requirementFor(resolution);
}
