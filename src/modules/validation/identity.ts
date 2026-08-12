import { createHash } from "node:crypto";
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
}): string {
  // Fixed order rather than object key order, so a refactor cannot silently
  // rehash every stored identity.
  const canonical = JSON.stringify([
    params.preparedChangeId,
    params.preparedCommitSha,
    params.validationProfile,
    params.validationProfileVersion,
    params.sandboxPolicyVersion,
  ]);

  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * The sandbox name for a given identity.
 *
 * Deterministic so a leaked sandbox can be traced back to the run that made
 * it, and prefixed so Vibe's sandboxes are identifiable in a provider console.
 * Carries no project, user or repository information: sandbox names are
 * third-party metadata, and customer identifiers do not belong there.
 */
export function sandboxNameFor(identity: string): string {
  return `vibe-validate-${identity.slice(0, 16)}`;
}
