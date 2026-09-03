import { createHash } from "node:crypto";
import type { ValidationDepth } from "./depth";
import type { ValidationProfile } from "./schema";

/**
 * What makes two validations "the same work" (Sprint 10A §21).
 *
 * Unlike a repository write, a repeated validation is not dangerous — it is
 * merely expensive. Sandbox time is billed in Active CPU and provisioned
 * memory, so a double click that provisions two microVMs is real money for a
 * question already answered.
 *
 * ## Why the policy version is in here
 *
 * The obvious identity is *(prepared change, commit)* — the artifact under
 * test. That is wrong, and the reason matters.
 *
 * "Validated" is a claim about the commands that ran, the network they ran
 * with, and the secrets they did not have. Change the install flags, open the
 * firewall during the build, or add a step, and a previously stored `passed`
 * describes something that no longer happened. Reusing it would let a policy
 * change retroactively bless an artifact under rules it was never checked
 * against.
 *
 * So `validationProfileVersion` and `sandboxPolicyVersion` are identity
 * inputs, and tightening the policy invalidates prior results by construction
 * rather than by anyone remembering to.
 *
 * The prepared change id *and* its commit sha both appear, deliberately
 * redundantly: the id alone would be enough today, but the sha is what was
 * actually validated, and an artifact-centric identity should say so.
 */
export function computeValidationIdentity(params: {
  preparedChangeId: string;
  preparedCommitSha: string;
  validationProfile: ValidationProfile;
  validationProfileVersion: string;
  sandboxPolicyVersion: string;
  /**
   * How much of the profile ran, and the rules that chose it (Sprint 0047).
   *
   * Identity inputs for exactly the reason the policy version is: a `fast` run
   * and a `deep` run answer different questions about the same commit, so a
   * stored `fast` pass must never satisfy a later request for a `deep` one.
   * Including both here makes that true by construction rather than by anyone
   * remembering to check — and re-deciding the depth downward on a re-run
   * cannot reach back and reuse a deeper result either, because the hash moved.
   */
  validationDepth: ValidationDepth;
  validationDepthPolicyVersion: string;
  /**
   * Which directory was validated (Stufe 4).
   *
   * An identity input for the same reason the profile is. Once a repository can
   * hold more than one application and a founder can say which one Vibe works
   * on, the same commit is a legitimate question at `apps/a` and at `apps/b` —
   * and without this, a pass recorded for one would be reused to answer the
   * other. "This commit validated" was never the claim; "this commit validated
   * *here*" is.
   */
  workspaceRoot: string;
}): string {
  // Fixed order rather than object key order, so a refactor cannot silently
  // rehash every stored identity.
  const canonical = JSON.stringify([
    params.preparedChangeId,
    params.preparedCommitSha,
    params.validationProfile,
    params.validationProfileVersion,
    params.sandboxPolicyVersion,
    params.validationDepth,
    params.validationDepthPolicyVersion,
    params.workspaceRoot,
  ]);

  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * The sandbox name for one validation **attempt**.
 *
 * Derived from the validation run id, deliberately **not** from the validation
 * identity. That distinction cost a real dogfood run:
 *
 * The identity is stable by design — same artifact, same policy, same hash —
 * which is exactly what makes reuse work. Naming the sandbox after it meant
 * every retry asked Vercel for a name that already existed, and
 * `Sandbox.create` refused. A second attempt at the same validation was
 * therefore *guaranteed* to fail with `sandbox_unavailable`, which is the
 * opposite of what a retry should do.
 *
 * A run id is unique per attempt and still traceable: a sandbox left behind in
 * a provider console maps back to exactly one row. Carries no project, user or
 * repository information — sandbox names are third-party metadata, and
 * customer identifiers do not belong there.
 */
export function sandboxNameFor(validationRunId: string): string {
  return `vibe-validate-${validationRunId.replace(/-/g, "").slice(0, 20)}`;
}
