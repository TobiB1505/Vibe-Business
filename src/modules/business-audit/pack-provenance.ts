import type { StoredAudit } from "./store";

/**
 * Did this evidence pack come from the observations the audit reasoned from?
 *
 * The Opportunity Engine and the Action Planner do not carry the audit's
 * evidence pack across the durable boundary — that would put untrusted source
 * content into the execution provider's log (Rule 52). They rebuild it, by
 * loading the *latest* successful snapshot of each kind and running the same
 * builders. Rebuilding is deterministic, so the same rows produce the same
 * pack and therefore the same evidence ids the audit cited.
 *
 * "The same rows" is the load-bearing clause, and nothing was checking it.
 *
 * Both steps guard their inputs by recomputing the operation's input identity,
 * but neither identity contains a snapshot id: `computeOpportunityInputHash`
 * hashes the audit's id, the audit's own input hash, and version constants,
 * and `computeActionPlanInputHash` adds the Move, the profile and the founder
 * intent. The audit's stored `input_hash` is a fixed value on a row that is not
 * being rewritten. So a scan finishing between the click and the durable step
 * moves `getLatestSuccessfulSnapshot` without moving anything either identity
 * hashes — the guard passes, and the model receives one run's conclusions
 * beside another run's evidence.
 *
 * What that produces is not a crash. The audit's citations are ids like
 * `repo.surface.payments`, minted by a builder that still mints them, so they
 * still render; they simply now point at a different observation than the one
 * the sentence above them was written from. The pack's own labels — "Repository
 * surface not detected: Payments" — would describe the new scan while the
 * audit's conclusion describes the old one, and the model is asked to
 * prioritize the one using the other. That is a paid call producing advice
 * about a state that no longer exists, and neither the model nor the founder
 * has any way to see it happened.
 *
 * So the check is made against the audit row rather than against click time.
 * `operation.inputIdentity` answers "are these the inputs the user clicked on?"
 * This answers the different and stronger question: "are these the inputs the
 * audit reasoned from?" — which is what makes a rebuilt pack the audit's pack.
 */

export type LoadedPackSources = {
  repositorySnapshotId: string;
  liveSnapshotId: string;
  productProfileId: string;
  founderIntentHash: string;
};

/** Which observation moved. `inputs_changed` either way; this names it. */
export type PackProvenance =
  | { matches: true }
  | {
      matches: false;
      diverged: "repository" | "live" | "product_profile" | "founder_intent";
    };

/**
 * Compares what a rebuild just loaded against what the audit recorded.
 *
 * `repository_snapshot_id` and `live_snapshot_id` are `not null` on the table
 * and have been since it existed, so a null here cannot come from production —
 * only from a fixture that did not describe a real audit. It is treated as a
 * mismatch rather than skipped: a guard that passes on absent data is a guard
 * that passes vacuously, and this one is worth more than that.
 *
 * `product_profile_id` and `founder_intent_hash` are genuinely nullable — rows
 * written before CORE-2 have neither, and back-filling one would be inventing a
 * fact. Those are skipped when absent. A pre-CORE-2 audit therefore keeps the
 * coverage it always had for the profile, and gains the snapshot check.
 *
 * The Deep Scan snapshot is *not* compared, because the audit table has no
 * column for it: `computeAuditInputHash` takes `authenticatedSnapshotId` from a
 * live lookup and hashes it, but nothing writes it to a column, so there is
 * nothing on the row to compare against. That gap is named rather than papered
 * over — closing it needs a column and a migration.
 */
export function verifyPackProvenance(
  audit: Pick<
    StoredAudit,
    "repositorySnapshotId" | "liveSnapshotId" | "productProfileId" | "founderIntentHash"
  >,
  loaded: LoadedPackSources,
): PackProvenance {
  if (audit.repositorySnapshotId !== loaded.repositorySnapshotId) {
    return { matches: false, diverged: "repository" };
  }
  if (audit.liveSnapshotId !== loaded.liveSnapshotId) {
    return { matches: false, diverged: "live" };
  }
  if (audit.productProfileId !== null && audit.productProfileId !== loaded.productProfileId) {
    return { matches: false, diverged: "product_profile" };
  }
  if (audit.founderIntentHash !== null && audit.founderIntentHash !== loaded.founderIntentHash) {
    return { matches: false, diverged: "founder_intent" };
  }
  return { matches: true };
}
