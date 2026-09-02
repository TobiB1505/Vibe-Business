import type { OutcomeEligibility } from "./eligibility";
import { outcomeCheckLabel, outcomeProfileScopeNote } from "./messages";
import type {
  ChangeOutcomeVerification,
  OutcomeCheckStatus,
  OutcomeFailureCode,
} from "./schema";

/**
 * What an outcome looks like to a user (Sprint 12A §29–§34).
 *
 * ## The distinction this card carries as data
 *
 * ```
 * Merged                 delivery — the default branch moved (Sprint 11C)
 * Production outcome     this sprint — verified / partial / not observed
 * Business impact        not measured, and not measurable by this sprint
 * ```
 *
 * All three are fields on the card rather than strings in a component, so a
 * redesign cannot drop the row that says business impact is unmeasured, and
 * cannot promote a verified outcome into a claim about the business (§33).
 *
 * ## The word that never appears
 *
 * `deployed`. `deploymentVerified` is a constant `false` here, exactly as it is
 * on the merge card, because Vibe reads no deployment API and has no provenance
 * for which build is serving. Observing the expected behaviour is consistent
 * with the new build being live; it is not proof of it, and the UI is required
 * to render the distinction rather than to remember it (§3, §34).
 */

export type OutcomeCardState =
  /** Nothing has been merged, so there is no outcome to check.  */
  | "unavailable"
  /** Merged and verifiable — the action may be offered (§29). */
  | "not_started"
  /** A durable observation is in flight. */
  | "observing"
  /** Every expected behaviour was observed (§30). */
  | "verified"
  /** Some expectations held and others did not (§31). */
  | "partial"
  /** Nothing expected appeared within the window (§32). */
  | "not_observed"
  /** Vibe could not observe reliably — a statement about Vibe (§23). */
  | "failed";

export type OutcomeCheckLine = {
  checkId: string;
  label: string;
  status: OutcomeCheckStatus;
};

export type OutcomeCard = {
  state: OutcomeCardState;
  verificationId: string | null;
  operationRunId: string | null;
  /** The origin that was observed, or would be. Never client-chosen (§11). */
  publicOrigin: string | null;
  /** The commit the default branch was read back at. */
  mergedCommitSha: string | null;
  /**
   * Every check, in contract order, including the ones that did not pass.
   *
   * Failures are never hidden (§31). A card that showed only its green lines
   * would be a card that turns a partial outcome into a verified one by
   * omission, which is the exact misreading this whole sprint is built around.
   */
  checks: OutcomeCheckLine[];
  /**
   * What this profile's `verified` means, in one sentence (ADR 0071).
   *
   * A field rather than a string in a component, for the same reason
   * `businessImpactMeasured` is: the two profiles check genuinely different
   * things and the state copy around them is identical, so a redesign that
   * dropped this line would silently promote "these pages answer" into "the
   * change is live on your site".
   *
   * Null only when no profile is known — nothing is merged, or the change was
   * refused before a contract resolved.
   */
  profileNote: string | null;
  observedAt: string | null;
  windowEndsAt: string | null;
  attemptCount: number;
  failureCode: OutcomeFailureCode | null;
  /** Safe copy for the refusal. Never an internal error string. */
  failureMessage: string | null;
  /** Whether the panel may offer the action at all. */
  canVerify: boolean;
  /**
   * Whether a deployment has been verified by Vibe.
   *
   * Always `false`, and present as a field so "Vibe did not deploy this, and
   * does not know whether anything was deployed" survives a redesign of the
   * panel (§34).
   */
  deploymentVerified: false;
  /**
   * Whether any business metric has been measured.
   *
   * Always `false`. Sprint 12B may make this a real value; until then it is a
   * constant the UI is required to render, because the moment a user sees a
   * green tick after a merge is the moment they will assume otherwise (§33).
   */
  businessImpactMeasured: false;
};

export type OutcomeCardInput = {
  latest: ChangeOutcomeVerification | null;
  eligibility: OutcomeEligibility;
  resolveFailureMessage: (code: OutcomeFailureCode) => string;
};

function checkLines(verification: ChangeOutcomeVerification): OutcomeCheckLine[] {
  const results = verification.checkResults ?? [];
  const byId = new Map(results.map((result) => [result.checkId, result]));

  // Driven by the **frozen expectation**, not by the results, so a check that
  // never produced a result still appears rather than silently vanishing from
  // the evidence list. Expectations are what the user was promised would be
  // looked at (§9).
  return verification.expectedOutcome.checks.map((check) => {
    const checkId = check.target === null ? check.kind : `${check.kind}:${check.target}`;
    const result = byId.get(checkId);
    return {
      checkId,
      label: outcomeCheckLabel({ kind: check.kind, target: check.target }),
      status: result?.status ?? "not_observed",
    };
  });
}

function latestObservedAt(verification: ChangeOutcomeVerification): string | null {
  return (
    verification.observationCompletedAt ??
    verification.checkResults?.[0]?.observedAt ??
    null
  );
}

const EMPTY = {
  verificationId: null,
  operationRunId: null,
  publicOrigin: null,
  mergedCommitSha: null,
  checks: [] as OutcomeCheckLine[],
  profileNote: null,
  observedAt: null,
  windowEndsAt: null,
  attemptCount: 0,
  failureCode: null,
  failureMessage: null,
} as const;

export function buildOutcomeCard(input: OutcomeCardInput): OutcomeCard {
  const base = { deploymentVerified: false as const, businessImpactMeasured: false as const };
  const latest = input.latest;

  if (latest !== null) {
    const shared = {
      ...base,
      verificationId: latest.id,
      operationRunId: latest.operationRunId,
      publicOrigin: latest.publicOrigin,
      mergedCommitSha: latest.mergedCommitSha,
      checks: checkLines(latest),
      profileNote: outcomeProfileScopeNote(latest.outcomeProfile),
      observedAt: latestObservedAt(latest),
      windowEndsAt: latest.verificationWindowEndsAt,
      attemptCount: latest.attemptCount,
      canVerify: false,
    };

    if (latest.status === "queued" || latest.status === "observing") {
      return { ...shared, state: "observing", failureCode: null, failureMessage: null };
    }

    if (latest.status === "verified" || latest.status === "partial" || latest.status === "not_observed") {
      return { ...shared, state: latest.status, failureCode: null, failureMessage: null };
    }

    // `failed` — Vibe could not observe. Distinct from `not_observed`, and the
    // copy that goes with it never characterises the customer's product (§23).
    return {
      ...shared,
      state: "failed",
      failureCode: latest.failureCode,
      failureMessage: latest.failureCode
        ? input.resolveFailureMessage(latest.failureCode)
        : null,
    };
  }

  if (input.eligibility.eligible) {
    return {
      ...base,
      ...EMPTY,
      state: "not_started",
      publicOrigin: input.eligibility.publicOrigin,
      mergedCommitSha: input.eligibility.mergedCommitSha,
      // Before the click, not only after it. What Vibe is about to look at is
      // what makes the button worth pressing, or worth not pressing.
      profileNote: outcomeProfileScopeNote(input.eligibility.outcomeProfile),
      canVerify: true,
    };
  }

  // Not merged at all is the ordinary case for most prepared changes, and it is
  // not worth a refusal message: the merge panel directly above already says
  // what is missing, and two components narrating the same gate is noise.
  if (input.eligibility.reason === "outcome_merge_required") {
    return { ...base, ...EMPTY, state: "unavailable", canVerify: false };
  }

  return {
    ...base,
    ...EMPTY,
    state: "unavailable",
    failureCode: input.eligibility.reason,
    failureMessage: input.resolveFailureMessage(input.eligibility.reason),
    canVerify: false,
  };
}
