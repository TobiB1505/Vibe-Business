import { isPreviewExpired, type PreviewFailureCode, type PreviewSession, type PreviewStage } from "./schema";

/**
 * What a preview looks like to a user (Sprint 10B-3 §2, §3, §8, §14).
 *
 * ## Why this is a pure function on the server
 *
 * The panel has ten states and most of them look similar from a distance:
 * "there is no preview" is true of a change that has never been validated, one
 * whose artifact expired, one whose artifact was deleted, and one whose preview
 * failed — and the right sentence, and the right button, differ in every case.
 *
 * Deriving that in the component would mean the client inferring authority from
 * a handful of unrelated fields. It would be wrong in exactly the way that
 * matters: a stale client could offer **Start temporary preview** for an
 * artifact that no longer exists, and the user would pay for a failed sandbox
 * to find out.
 *
 * So the server decides, from persisted state, and the component renders what
 * it was given. Same discipline as `validation/view.ts`, for the same reason.
 *
 * ## Expiry is evaluated here, not in the browser
 *
 * A client clock can be wrong, paused by a sleeping laptop, or simply stale
 * because the tab has been open for twenty minutes. `expires_at` is compared on
 * the server on every read, so a preview past its deadline never renders an
 * **Open preview** button — whatever the browser believes (§13).
 *
 * ## No percentages, and no invented reassurance
 *
 * The stage copy names real work. A preview is tens of seconds, the phases have
 * different durations, and any progress number would be made up.
 */

export type PreviewCardState =
  /** No prepared change artifact to preview at all. */
  | "not_available"
  /** Validation has not passed, so there is nothing validated to run. */
  | "needs_validation"
  /** Validation passed, but the retained artifact has passed its deadline. */
  | "artifact_expired"
  /** Validation passed, but no artifact was captured or it has been deleted. */
  | "artifact_unavailable"
  | "ready_to_start"
  | "starting"
  | "running"
  | "failed"
  | "stopped"
  | "expired";

export type PreviewCard = {
  state: PreviewCardState;
  /** The session to act on, when there is one. Never a sandbox or snapshot id. */
  previewSessionId: string | null;
  /** The live operation, so the panel can poll without inventing an id. */
  operationRunId: string | null;
  stage: PreviewStage | null;
  failureCode: PreviewFailureCode | null;
  /** Safe copy for a failure. Never a provider message (§14). */
  failureMessage: string | null;
  expiresAt: string | null;
  readyAt: string | null;
  /**
   * Whether a re-validation is the honest next step, and what it costs.
   *
   * Present only when the artifact is genuinely gone. Never phrased as a free
   * refresh: a new ValidationRun provisions a paid sandbox, and the user starts
   * it deliberately or not at all (§15, CLAUDE.md rule 60).
   */
  revalidationRequired: boolean;
};

/**
 * Stage copy for a starting preview (§7).
 *
 * A `Record` over the closed stage union: adding a stage without copy becomes a
 * type error rather than a blank line while a user waits.
 */
export const PREVIEW_STAGE_LABELS: Record<PreviewStage, string> = {
  preflight: "Checking preview eligibility",
  restoring_artifact: "Restoring validated artifact",
  verifying_artifact: "Verifying artifact integrity",
  starting_server: "Starting application",
  checking_preview: "Checking application",
  completed: "Preview ready",
};

export type PreviewCardInput = {
  /** Null when the change has never been validated. */
  validation: { status: string } | null;
  /** Null when no artifact was captured, or it has been deleted. */
  artifact: { expiresAt: string } | null;
  /** The most recent preview session for this change, in any state. */
  session: PreviewSession | null;
  /** Safe copy for `session.failureCode`, resolved by the caller. */
  failureMessage: string | null;
};

export function buildPreviewCard(input: PreviewCardInput, now: Date = new Date()): PreviewCard {
  const empty = {
    previewSessionId: null,
    operationRunId: null,
    stage: null,
    failureCode: null,
    failureMessage: null,
    expiresAt: null,
    readyAt: null,
    revalidationRequired: false,
  } as const;

  // A live session outranks everything below it, including artifact state. The
  // artifact is deleted at teardown, so a *running* preview whose artifact is
  // already gone is the normal case rather than an inconsistency — and reading
  // the artifact first would report it as `artifact_unavailable` while the user
  // is looking at a working preview.
  if (input.session && !isPreviewExpired(input.session, now)) {
    if (input.session.status === "starting") {
      return {
        ...empty,
        state: "starting",
        previewSessionId: input.session.id,
        operationRunId: input.session.operationRunId,
        stage: input.session.stage,
        expiresAt: input.session.expiresAt,
      };
    }

    if (input.session.status === "running") {
      return {
        ...empty,
        state: "running",
        previewSessionId: input.session.id,
        operationRunId: input.session.operationRunId,
        stage: input.session.stage,
        expiresAt: input.session.expiresAt,
        readyAt: input.session.readyAt,
      };
    }
  }

  // Everything from here needs a passing validation to say anything useful.
  if (!input.validation) return { ...empty, state: "not_available" };
  if (input.validation.status !== "passed") return { ...empty, state: "needs_validation" };

  const terminal = terminalSession(input, now);
  if (terminal) return terminal;

  if (!input.artifact) {
    // Captured and deleted, or never captured. Both mean the same thing to the
    // user and both are fixed the same way — deliberately, by them.
    return { ...empty, state: "artifact_unavailable", revalidationRequired: true };
  }

  if (isPreviewExpired({ expiresAt: input.artifact.expiresAt }, now)) {
    return { ...empty, state: "artifact_expired", revalidationRequired: true };
  }

  return { ...empty, state: "ready_to_start" };
}

/**
 * A finished session, and why it finished.
 *
 * Returned only when the artifact cannot support a *new* preview either —
 * otherwise a change that was previewed, stopped, and then re-validated would
 * be stuck showing "Preview stopped" with no way forward.
 */
function terminalSession(input: PreviewCardInput, now: Date): PreviewCard | null {
  const session = input.session;
  if (!session) return null;

  const artifactUsable =
    input.artifact !== null && !isPreviewExpired({ expiresAt: input.artifact.expiresAt }, now);

  const unconverged =
    (session.status === "starting" || session.status === "running") &&
    isPreviewExpired(session, now);

  // A usable artifact outranks a *settled* session. Previewed, stopped, then
  // re-validated is a real sequence, and reporting it as "Preview stopped"
  // would leave the user looking at history with no way forward while a live
  // artifact sits there, already paid for.
  //
  // It does not outrank an **unconverged** one. A session whose deadline passed
  // but whose row still says `running` is a state the system has not finished
  // processing — its artifact is about to be deleted by the next authorized
  // read — and "your preview expired" is what actually happened. Offering a
  // start there would describe a window that is closing as it is read.
  if (artifactUsable && !unconverged) return null;

  const base = {
    previewSessionId: session.id,
    operationRunId: session.operationRunId,
    stage: null,
    failureCode: session.failureCode,
    failureMessage: session.failureCode ? input.failureMessage : null,
    expiresAt: session.expiresAt,
    readyAt: session.readyAt,
    // Always true here: this branch is only reached when no usable artifact
    // remains. The artifact is deleted when a preview ends, so another preview
    // costs a validation — said plainly rather than discovered by clicking
    // (§15).
    revalidationRequired: true,
  };

  if (session.status === "failed") return { ...base, state: "failed" };
  if (session.status === "stopped") return { ...base, state: "stopped" };
  if (session.status === "expired") return { ...base, state: "expired" };

  // `starting` or `running` past its deadline. The row has not converged yet —
  // an authorized read is what converges it — but the user must not be offered
  // a preview URL in the meantime (§13).
  if (isPreviewExpired(session, now)) {
    return { ...base, state: "expired", stage: null };
  }

  return null;
}
