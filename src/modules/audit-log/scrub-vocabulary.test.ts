import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every audit metadata key is classified, or this fails (ADR 0056 §8).
 *
 * ## Why a denylist needs a guard and an allowlist would not
 *
 * §8 decided the scrub by naming what is withheld and what is retained. That is
 * the right call — the retained set is open-ended (counts, durations, versions,
 * closed-enum reasons) and an allowlist would destroy useful evidence every
 * time somebody added a benign field. But it inverts the failure mode: a new
 * *sensitive* key added later is retained by default, silently, in an operation
 * that cannot be re-run.
 *
 * So the denylist is kept and this is what makes it maintainable. It reads the
 * key vocabulary out of the `recordAuditEvent` call sites themselves and
 * requires every key to appear in one of four places: deleted by the migration,
 * nulled by the migration, pseudonymized as a path, or listed in
 * {@link RETAINED} here with a person having decided it is not personal.
 *
 * ## What this does not assert
 *
 * That the classification is *correct*. A key wrongly placed in `RETAINED`
 * passes. What it prevents is the case that actually happens: a key nobody
 * thought about at all.
 */

const ROOT = process.cwd();
const MIGRATION = join(ROOT, "supabase", "migrations", "20260827060000_audit_metadata_scrub.sql");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry) || entry.includes(".test.")) return [];
    return [path];
  });
}

/**
 * The metadata keys the repository actually writes.
 *
 * Brace-matched from each `recordAuditEvent(` call's `metadata: { … }` rather
 * than regex-scraped from the whole file, so a key in an unrelated object
 * literal does not count and a nested object's keys do.
 */
function writtenKeys(): Set<string> {
  const keys = new Set<string>();

  for (const file of sourceFiles(join(ROOT, "src"))) {
    const source = readFileSync(file, "utf8");

    for (const call of source.matchAll(/recordAuditEvent\(/g)) {
      const tail = source.slice(call.index + call[0].length, call.index + 3000);
      const start = /metadata:\s*\{/.exec(tail);
      if (!start) continue;

      let depth = 1;
      let cursor = start.index + start[0].length;
      while (cursor < tail.length && depth > 0) {
        if (tail[cursor] === "{") depth += 1;
        else if (tail[cursor] === "}") depth -= 1;
        cursor += 1;
      }

      for (const key of tail.slice(start.index + start[0].length, cursor - 1).matchAll(
        /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[:,]/gm,
      )) {
        keys.add(key[1]);
      }
    }
  }

  return keys;
}

/** The two withholding lists, read from the migration rather than restated. */
function migrationKeys(): { deleted: Set<string>; nulled: Set<string> } {
  const sql = readFileSync(MIGRATION, "utf8");

  const list = (name: string): Set<string> => {
    const block = new RegExp(`${name} constant text\\[\\] := array\\[([^\\]]+)\\]`).exec(sql);
    if (!block) throw new Error(`${name} not found in ${MIGRATION}`);
    return new Set([...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]));
  };

  return { deleted: list("deleted_keys"), nulled: list("nulled_keys") };
}

/**
 * Keys deliberately kept, per §8's "retained untouched" list.
 *
 * Grouped by why, because "why is this not personal" is the question a reviewer
 * has to answer when this list grows, and a flat array answers none of it.
 */
const RETAINED: Readonly<Record<string, readonly string[]>> = {
  "content identifiers": [
    "commitSha",
    "approved_commit_sha",
    "base_sha",
    "current_commit_sha",
    "merged_commit_sha",
    "observed_default_head",
    "observed_default_head_sha",
    "prepared_commit_sha",
    "resulting_default_head_sha",
    "target_sha",
    "intentHash",
    "specIdentity",
    "conclusionLineage",
  ],
  "internal row ids": [
    "actionPlanId",
    "agentExecutionRunId",
    "approval_id",
    "auditId",
    "business_measurement_id",
    "change_approval_id",
    "change_merge_id",
    "change_outcome_verification_id",
    "creditAccountId",
    "executionSpecId",
    "grantId",
    "ledgerEntryId",
    "lotId",
    "measurement_plan_id",
    "operationId",
    "operation_id",
    "opportunityId",
    "opportunitySetId",
    "preparedChangeId",
    "prepared_change_id",
    "previewSessionId",
    "productProfileId",
    "profileId",
    "reservationId",
    "reviewArtifactId",
    "sessionId",
    "validationRunId",
  ],
  "policy, model and schema versions": [
    "analyzerVersion",
    "approval_policy_version",
    "measurement_policy_version",
    "merge_policy_version",
    "model",
    "outcome_policy_version",
    "outcome_profile_version",
    "policyVersion",
    "previewPolicyVersion",
    "productProfileSchemaVersion",
    "promptVersion",
    "resolverVersion",
    "reviewPolicyVersion",
    "rubricVersion",
    "sandboxPolicyVersion",
  ],
  "closed enums, reasons and failure codes": [
    "accessMode",
    "accountType",
    "adapter",
    "capability",
    "code",
    "conclusionKey",
    "executionProvider",
    "failureCode",
    "failureDetail",
    "failure_code",
    "grantReason",
    "interruptType",
    "invalidation_reason",
    "materiality",
    // Sprint 0055: "visual" | "code" | "visual_and_code", and which of the two
    // evidence forms a human's yes actually rested on.
    "review_classification",
    "review_evidence",
    "merge_strategy",
    "metric_direction",
    "metric_key",
    "mode",
    "operation",
    "operationType",
    "outcome",
    // VB-020: "release" | "settlement" — which repair a stuck hold is owed.
    "owed",
    "outcome_profile",
    "plan",
    "previewProfile",
    "primary_metric",
    "profile",
    "provider",
    "questionIntent",
    "reason",
    "releaseReason",
    "resolved_by",
    "riskClass",
    "route",
    "sku",
    "sourceKind",
    "source_kind",
    "status",
    "validationDepth",
    "validationDepthEscalatedBy",
    "validationDepthReason",
    "default_branch",
    "branchName",
    "disclosure",
    "detail",
    "fields",
    "data_quality",
  ],
  "counts, amounts, durations and measurements": [
    "affectedLenses",
    "allocatedAfter",
    "allocatedBefore",
    "attempt_count",
    "baseline_days",
    "baseline_end",
    "baseline_start",
    "bytesFetched",
    "capabilityCount",
    "chargedCredits",
    "checks_errored",
    "checks_failed",
    "checks_not_observed",
    "checks_passed",
    "completeness",
    "coverage",
    "credits",
    "durationMs",
    "expected_check_count",
    "expiresAt",
    "fileCount",
    "filesFetched",
    "maxAuthorizedCredits",
    "measurement_days",
    "measurement_end",
    "measurement_start",
    "measurement_timezone",
    "observed_relative_change",
    "opportunityCount",
    "overallScore",
    "pagesInspected",
    "port",
    "postedAfter",
    "postedBefore",
    "postedDrift",
    "reservedAfter",
    "reservedBefore",
    "reservedCredits",
    "reservedDrift",
    "sample_size_after",
    "sample_size_before",
    "sandboxDurationMs",
    "settling_days",
    "stepCount",
    "stepOrder",
    "usageOutstanding",
    "validationFindings",
    "drift",
  ],
  "booleans about what happened": [
    "answered",
    "artifactDeleted",
    "cancelAtPeriodEnd",
    "cleanup",
    "hasMove",
    "nonProductionEconomics",
    "publicExposureConfirmed",
    "recovered",
    "retryable",
  ],
};

/** Pseudonymized positionally wherever it appears, at any depth. */
const PSEUDONYMIZED = new Set(["path"]);

describe("the audit metadata vocabulary is fully classified (ADR 0056 §8)", () => {
  const written = writtenKeys();
  const { deleted, nulled } = migrationKeys();

  it("extracts a real vocabulary rather than nothing", () => {
    // Without this the suite would pass by finding no keys at all, which is the
    // way a source-scanning guard usually dies.
    expect(written.size).toBeGreaterThan(150);
    expect(written.has("githubLogin")).toBe(true);
    expect(written.has("failureCode")).toBe(true);
  });

  it("reads both withholding lists out of the migration", () => {
    expect(deleted.size).toBe(10);
    expect(nulled.size).toBe(7);
  });

  it("classifies every key somewhere", () => {
    const retained = new Set(Object.values(RETAINED).flat());
    const unclassified = [...written]
      .filter(
        (key) => !deleted.has(key) && !nulled.has(key) && !retained.has(key) && !PSEUDONYMIZED.has(key),
      )
      .sort();

    expect(unclassified).toEqual([]);
  });

  it("has no retained key that the migration also withholds", () => {
    const retained = new Set(Object.values(RETAINED).flat());
    const contradictory = [...retained].filter((key) => deleted.has(key) || nulled.has(key)).sort();

    expect(contradictory).toEqual([]);
  });
});
