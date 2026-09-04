import { computeAuditInputHash, type StoredAudit } from "./store";

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
 * still render; they simply now point at a different observation than the
 * sentence above them was written from. That is a paid call producing advice
 * about a state that no longer exists, and neither the model nor the founder
 * has any way to see it happened.
 *
 * So the check is made against the audit row rather than against click time.
 * `operation.inputIdentity` answers "are these the inputs the user clicked on?"
 * This answers the different and stronger question: "are these the inputs the
 * audit reasoned from?" — which is what makes a rebuilt pack the audit's pack.
 */

/** The five source identities an audit's `input_hash` is built from. */
export type LoadedPackSources = {
  repositorySnapshotId: string;
  liveSnapshotId: string;
  productProfileId: string;
  founderIntentHash: string;
  /** Null is a real value: "no Deep Scan exists", distinct from any id. */
  authenticatedSnapshotId: string | null;
};

export type PackProvenance =
  | { matches: true; verifiedBy: "input_hash" | "recorded_columns" }
  | {
      matches: false;
      verifiedBy: "input_hash" | "recorded_columns";
      /** Which observation moved. `input_hash` cannot name one; it says so. */
      diverged: "repository" | "live" | "product_profile" | "founder_intent" | "unattributed";
    };

/**
 * Pack versions whose rows are guaranteed to carry the full CORE-2 set.
 *
 * A list rather than an equality test, and that is the whole point. This read
 * `=== "business-evidence.v3"`, so the day a v4 pack shipped, every new audit
 * would have fallen through to the pre-CORE-2 column comparison below — the
 * weaker path, written for rows that predate the profile columns entirely — and
 * the Deep Scan would have stopped being checked at all. Nothing would have
 * failed; the strongest provenance guarantee would simply have gone quiet.
 *
 * `business_readiness_audits_v3_has_profile` is what a member of this list has
 * to satisfy: `product_profile_id`, both profile version columns and
 * `founder_intent_hash` all present. That constraint names v3 explicitly, so
 * adding a version here means widening the constraint in the same migration.
 */
const HASH_VERIFIABLE_PACKS: readonly string[] = [
  "business-evidence.v3",
  "business-evidence.v4",
  "business-evidence.v5",
];

/**
 * Compares what a rebuild just loaded against what the audit recorded.
 *
 * ## The exact path, for a v3 audit
 *
 * `computeAuditInputHash` already *is* the definition of "the same inputs":
 * fourteen values, of which nine are versions the row stores and five are the
 * source identities a rebuild just loaded. Recomputing it from the row's own
 * versions and the fresh sources, then comparing to the row's `input_hash`,
 * therefore verifies all five sources at once — including the **Deep Scan
 * snapshot, which has no column at all** and which no field-by-field check can
 * reach. It also inherits that function's care with null: `authenticatedSnapshotId`
 * is carried through as JSON null rather than a sentinel, so "no Deep Scan"
 * cannot be forged by a snapshot whose id happens to match.
 *
 * The versions must come from the row, never from the current constants. A
 * version bump is a legitimate reason to buy a *new* audit; it is not a reason
 * to refuse to reuse an existing one's conclusions, and comparing against
 * today's constants would answer a question nobody asked.
 *
 * The price of the exactness is attribution: a mismatched digest says something
 * moved, not what. The verdict says `unattributed` rather than guessing, and
 * the failure code is `inputs_changed` either way.
 *
 * ## The fallback, for anything older
 *
 * `business_readiness_audits_v3_has_profile` guarantees the profile columns are
 * present *only* for v3 rows. A pre-CORE-2 row was hashed by an older shape of
 * this function, so recomputing it would refuse forever rather than detect
 * anything. Those fall back to comparing the columns that do exist — which is
 * what this module did in its first version, and is still strictly more than
 * nothing.
 *
 * There, `repository_snapshot_id` and `live_snapshot_id` are `not null` on the
 * table and have been since it existed, so a null cannot come from production —
 * only from a fixture that did not describe a real audit. It is treated as a
 * mismatch rather than skipped: a guard that passes on absent data is a guard
 * that passes vacuously. `product_profile_id` and `founder_intent_hash` are
 * genuinely nullable there and are skipped when absent, because back-filling
 * one would be inventing a fact.
 */
export function verifyPackProvenance(
  audit: StoredAudit,
  loaded: LoadedPackSources,
): PackProvenance {
  if (HASH_VERIFIABLE_PACKS.includes(audit.evidencePackVersion)) {
    // Guaranteed non-null by `business_readiness_audits_v3_has_profile`. The
    // fallbacks are unreachable for a v3 row and exist so a row that somehow
    // violated the constraint mismatches rather than throws.
    const recomputed = computeAuditInputHash({
      repositorySnapshotId: loaded.repositorySnapshotId,
      liveSnapshotId: loaded.liveSnapshotId,
      productProfileId: loaded.productProfileId,
      founderIntentHash: loaded.founderIntentHash,
      authenticatedSnapshotId: loaded.authenticatedSnapshotId,
      schemaVersion: audit.schemaVersion,
      auditVersion: audit.auditVersion,
      evidencePackVersion: audit.evidencePackVersion,
      promptVersion: audit.promptVersion,
      rubricVersion: audit.rubricVersion,
      profileSchemaVersion: audit.productProfileSchemaVersion ?? "",
      profileBuilderVersion: audit.productProfileBuilderVersion ?? "",
      provider: audit.provider,
      model: audit.model,
    });

    return recomputed === audit.inputHash
      ? { matches: true, verifiedBy: "input_hash" }
      : { matches: false, verifiedBy: "input_hash", diverged: "unattributed" };
  }

  const verifiedBy = "recorded_columns" as const;

  if (audit.repositorySnapshotId !== loaded.repositorySnapshotId) {
    return { matches: false, verifiedBy, diverged: "repository" };
  }
  if (audit.liveSnapshotId !== loaded.liveSnapshotId) {
    return { matches: false, verifiedBy, diverged: "live" };
  }
  if (audit.productProfileId !== null && audit.productProfileId !== loaded.productProfileId) {
    return { matches: false, verifiedBy, diverged: "product_profile" };
  }
  if (audit.founderIntentHash !== null && audit.founderIntentHash !== loaded.founderIntentHash) {
    return { matches: false, verifiedBy, diverged: "founder_intent" };
  }
  return { matches: true, verifiedBy };
}
