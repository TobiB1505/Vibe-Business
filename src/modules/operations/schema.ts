/**
 * The durable operation model (Sprint 7 §5).
 *
 * Two axes, deliberately separated:
 *
 *  - **status** is lifecycle: what may still happen to this operation.
 *  - **stage** is progress: where the work has got to.
 *
 * Conflating them is the usual mistake, and it produces states like "running"
 * meaning both "queued somewhere" and "currently calling a provider" — which
 * is precisely the distinction that decides whether a retry is safe.
 *
 * Both are closed sets. Free-form status strings would put UI copy, retry
 * policy and cost safety at the mercy of a typo.
 *
 * There are no percentages here on purpose (§5). A four-step pipeline whose
 * third step takes 50 seconds has no honest percentage, and inventing one
 * teaches users to distrust the number.
 */

export const OPERATION_TYPES = [
  "business_audit",
  "opportunity_generation",
  "change_preparation",
  /** Isolated sandbox validation of a prepared change (Sprint 10A §20). */
  "change_validation",
  /** Temporary preview of a validated artifact (Sprint 10B-2 §23). */
  "change_preview",
  /**
   * Ending a preview: stop, delete the artifact, record the spend.
   *
   * Durable because it needs the privileged ledger writer, not because it is
   * slow. Manual stop and expiry both converge here (ADR 0016 §14).
   */
  "preview_teardown",
  /** Capturing a before/after visual comparison (Sprint 11A §21). */
  "change_review",
  /**
   * Moving a repository's default branch to an approved commit (Sprint 11C §18).
   *
   * Durable because the write, the independent read-back, the database
   * convergence and the audit event must not depend on the initiating request
   * staying open — and because an interrupted default-branch write is the one
   * state in this product that must always be reconciled rather than forgotten.
   */
  "change_merge",
  /**
   * Observing the public product after a merge (Sprint 12A §18).
   *
   * Durable because the observation window is fifteen minutes with sleeps in
   * it, and no browser request should be held open for that — but also because
   * the authoritative result must be written by something the client cannot
   * impersonate. A user requests the check; only durable execution says what
   * was seen.
   */
  "change_outcome_verification",
  /**
   * Measuring a business metric across two elapsed windows (Sprint 12B §30).
   *
   * Durable for a different reason from every operation before it. The others
   * are durable because they are *slow* — tens of seconds, or fifteen minutes.
   * This one is durable because the authoritative numbers must be written by
   * something a browser cannot impersonate, and because the windows it compares
   * are measured in weeks. A user requests it; only durable execution says what
   * was observed.
   */
  "business_measurement",
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export const OPERATION_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export const OPERATION_STAGES = [
  "preparing",
  "counting_tokens",
  /** The audit's paid step. */
  "running_ai",
  /** The Opportunity Engine's paid step (Sprint 8 §25). */
  "prioritizing",
  /** Change preparation: revalidating the premise against live state. */
  "preflight",
  "generating_change",
  /** The consequential external write (Sprint 9B §7). */
  "writing_repository",
  "verifying_repository",
  "validating",
  "persisting",
  /**
   * Isolated validation (Sprint 10A §17).
   *
   * Granular because a five-minute sandbox run reported as one opaque stage
   * tells a waiting user nothing — and a percentage would tell them something
   * false.
   */
  "provisioning",
  "acquiring_source",
  "verifying_source",
  "securing_sandbox",
  "installing",
  "typechecking",
  "testing",
  "building",
  "collecting_results",
  "cleaning_up",
  /**
   * Temporary preview (Sprint 10B-2 §23).
   *
   * Granular for the same reason validation's are: a restore-plus-boot is tens
   * of seconds, and one opaque stage tells a waiting user nothing that a
   * percentage would not tell them falsely.
   */
  "restoring_artifact",
  "verifying_artifact",
  "starting_server",
  "checking_preview",
  /** Visual review (Sprint 11A §21). Two captures, named plainly. */
  "capturing_before",
  "capturing_after",
  "persisting_artifacts",
  /**
   * Safe merge (Sprint 11C §18).
   *
   * `authorizing` is a stage of its own because it is the moment the merge
   * revalidates a human's decision against live GitHub state. A user watching
   * their default branch being written to deserves to see that this happened,
   * rather than one opaque "working" covering both the check and the write.
   */
  "authorizing",
  "writing_default_ref",
  "verifying_default_ref",
  "converging",
  /**
   * Production outcome verification (Sprint 12A §18).
   *
   * Two stages, not seven. `observing` deliberately covers the whole bounded
   * window including its sleeps: a stage that flickered once per attempt would
   * turn a patient wait into a progress bar that lies about how much is left,
   * and there is no honest percentage for "is their deployment done yet".
   */
  "observing",
  "evaluating",
  /**
   * Business measurement (Sprint 12B §30).
   *
   * Named for the two halves of the comparison rather than one opaque
   * "collecting", because they read very differently to a waiting user: the
   * baseline is history and should be instant, while the post-change window is
   * the recent data an analytics source is slowest to settle.
   */
  "collecting_baseline",
  "collecting_post",
  "comparing",
  "completed",
] as const;
export type OperationStage = (typeof OPERATION_STAGES)[number];

/** Statuses from which nothing further happens. Completed operations are immutable. */
export const TERMINAL_STATUSES: readonly OperationStatus[] = ["completed", "failed", "cancelled"];

export function isTerminal(status: OperationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** True while an operation still owns its input identity and must not be duplicated. */
export function isActive(status: OperationStatus): boolean {
  return status === "queued" || status === "running";
}

/**
 * The point of no return for cost (§24).
 *
 * Once the paid inference stage has been entered, the provider may already
 * have been billed, so nothing downstream may quietly start it again and
 * cancellation cannot be honestly promised.
 */
export function hasEnteredPaidWork(stage: OperationStage): boolean {
  return (
    stage === "running_ai" ||
    stage === "prioritizing" ||
    stage === "writing_repository" ||
    stage === "validating" ||
    stage === "persisting" ||
    // Restoring an artifact creates a billed microVM. Not inference, but the
    // property this function exists to express is "money may already have been
    // spent", and a sandbox creation qualifies (Sprint 10B-2 §27).
    stage === "restoring_artifact" ||
    stage === "verifying_artifact" ||
    stage === "starting_server" ||
    stage === "checking_preview" ||
    stage === "completed"
  );
}
