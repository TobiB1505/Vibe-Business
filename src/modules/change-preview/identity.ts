import { createHash } from "node:crypto";
import type { PreviewProfile } from "./schema";

/**
 * What makes two previews "the same preview" (Sprint 10B-2 §22).
 *
 * A repeated preview is not dangerous — it is expensive and confusing. Two
 * sandboxes serving the same artifact on two public URLs is double spend plus a
 * question nobody can answer ("which link is the real one?").
 *
 * ## Why the policy version is an input
 *
 * The same reason it is an input to the validation identity. "This artifact
 * previews fine" is a claim about the port that was exposed, the egress policy
 * the server ran under, the command that started it and the secrets it did not
 * have. Change any of those and a live session was started under rules the new
 * request is not asking about, so it must not be handed back as an answer.
 *
 * ## Why the prepared commit is in here alongside the ids
 *
 * Deliberately redundant, exactly as in `computeValidationIdentity`. The
 * validation run id alone would be sufficient today; the commit sha is what was
 * actually built and served, and an artifact-centric identity should say so
 * rather than rely on a foreign key to imply it.
 */
export function computePreviewIdentity(params: {
  projectId: string;
  preparedChangeId: string;
  validationRunId: string;
  /** The snapshot restored. Two captures of the same run are not the same preview. */
  artifactSnapshotId: string;
  preparedCommitSha: string;
  previewProfile: PreviewProfile;
  previewProfileVersion: string;
  previewPolicyVersion: string;
}): string {
  // Fixed order rather than object key order, so a refactor cannot silently
  // rehash every stored identity.
  const canonical = JSON.stringify([
    params.projectId,
    params.preparedChangeId,
    params.validationRunId,
    params.artifactSnapshotId,
    params.preparedCommitSha,
    params.previewProfile,
    params.previewProfileVersion,
    params.previewPolicyVersion,
  ]);

  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * The sandbox name for one preview **session**.
 *
 * Derived from the session id, not from the preview identity — the same
 * distinction that cost Sprint 10A a real dogfood run. An identity is stable by
 * design, which is what makes reuse work and exactly what makes it useless as a
 * provider name: the second session for the same artifact would ask for a name
 * that already exists and `Sandbox.create` would refuse.
 *
 * Nothing about the sandbox is persisted. The name is recomputed from a row the
 * database already holds, so no connection material, capability URL or opaque
 * provider id ever enters the durable log (ADR 0015 §10, CLAUDE.md rule 52).
 *
 * Carries no project, user or repository information: sandbox names are
 * third-party metadata, and customer identifiers do not belong there.
 */
export function previewSandboxNameFor(previewSessionId: string): string {
  return `vibe-preview-${previewSessionId.replace(/-/g, "").slice(0, 20)}`;
}

/**
 * The operation identity for tearing one preview down.
 *
 * A preview ends once, so the session id is the whole question. Hashing it into
 * the 64-character shape `operation_runs.input_identity` requires makes the
 * unique index the second guard behind the session claim: two teardown requests
 * for the same session cannot both create an operation.
 */
export function computeTeardownIdentity(previewSessionId: string): string {
  return createHash("sha256")
    .update(JSON.stringify(["preview_teardown", previewSessionId]))
    .digest("hex");
}
