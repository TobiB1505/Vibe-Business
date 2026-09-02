import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SANDBOX_BUDGETS, SANDBOX_RESOURCES, STEP_DEADLINE_MS } from "./budgets";
import { VALIDATION_DEPTH_POLICY_VERSION } from "./depth";
import { installCommand } from "./commands";
import { computeValidationIdentity } from "./identity";
import { DEPENDENCY_HOSTS, SOURCE_HOSTS } from "./sandbox-port";
import { SANDBOX_POLICY_VERSION, VALIDATION_STAGES } from "./schema";

/**
 * The TypeScript vocabulary against the SQL that has to accept it.
 *
 * ## Why this file exists
 *
 * Twice now, a value has existed in TypeScript and been rejected by a database
 * CHECK constraint, and both times every unit test passed while every real run
 * would have failed at INSERT:
 *
 *  - Sprint 9 bumped an execution capability against a column carrying
 *    `CHECK (execution_capability = '...v1')`;
 *  - the post-dogfood pass repeated the shape closely enough that a migration
 *    was assumed unnecessary and was not.
 *
 * The in-memory test database does not evaluate CHECK constraints, so no
 * behavioural test can catch this. Only reading the migrations can.
 *
 * The durable-phase refactor writes stages that were previously never reached
 * on their own — `cleaning_up` in particular is now written by a step of its
 * own — so `operation_runs.stage` is the constraint that would have failed
 * silently this time.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/**
 * The live definition of a CHECK constraint, taking the last migration to
 * define it.
 *
 * Migrations are applied in filename order, and this codebase redefines
 * constraints by dropping and re-adding them — so the *last* definition is the
 * one in force, exactly as it is on the remote database.
 */
function currentStageConstraint(): string {
  const files = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  let constraint: string | null = null;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const matches = [
      ...sql.matchAll(/operation_runs_stage_check\s*\n?\s*check \(stage in \(([\s\S]*?)\)\)/g),
    ];
    if (matches.length > 0) constraint = matches[matches.length - 1][1];
  }

  if (constraint === null)
    throw new Error("no operation_runs stage constraint found in migrations");
  return constraint;
}

function permittedStages(): string[] {
  return [...currentStageConstraint().matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

describe("stage vocabulary against the database (§26)", () => {
  it("permits every validation stage the code can write", () => {
    const permitted = new Set(permittedStages());
    const missing = VALIDATION_STAGES.filter((stage) => !permitted.has(stage));

    // A stage in TypeScript that the constraint rejects is an INSERT failure in
    // production and a green test suite everywhere else.
    expect(missing).toEqual([]);
  });

  it("permits the stages the durable-phase refactor writes from their own steps", () => {
    const permitted = new Set(permittedStages());

    // Named explicitly rather than left to the loop above: these are the ones
    // whose *writers* changed in this refactor, and a future edit that drops
    // one from the union should not quietly drop it from this test too.
    for (const stage of [
      "provisioning",
      "verifying_source",
      "securing_sandbox",
      "installing",
      "typechecking",
      "testing",
      "building",
      "collecting_results",
      "cleaning_up",
      "completed",
    ]) {
      expect(permitted.has(stage)).toBe(true);
    }
  });
});

/**
 * Whether any migration constrains a column to an enumerated set of values.
 *
 * Matched per statement rather than across the file: comments in these
 * migrations mention column names freely, and a whole-file regex reports the
 * next unrelated `in (...)` as a constraint on whatever was named above it.
 */
function constrainedToASet(sql: string, column: string): boolean {
  return sql
    .split(";")
    .map((statement) =>
      statement
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n"),
    )
    .some((statement) => new RegExp(`${column}[^\\n]*check \\([^)]*in \\(`).test(statement));
}

describe("columns the refactor writes without a migration (§26)", () => {
  function migrationSql(): string {
    return readdirSync(MIGRATIONS)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => readFileSync(join(MIGRATIONS, file), "utf8"))
      .join("\n");
  }

  it("does not constrain the sandbox policy version to an enumerated set", () => {
    const sql = migrationSql();

    // The policy version is bumped whenever validation semantics change, so a
    // CHECK listing permitted versions would turn every bump into a migration —
    // and, on the evidence of Sprint 9, into a production incident. The live
    // constraint is a non-empty check, and this asserts it stays that way.
    expect(sql).toContain(
      "sandbox_policy_version text not null check (char_length(btrim(sandbox_policy_version)) > 0)",
    );
    expect(constrainedToASet(sql, "sandbox_policy_version")).toBe(false);
  });

  it("does not constrain validation failure codes to an enumerated set", () => {
    const sql = migrationSql();

    // `sandbox_lost` is new in this refactor. It is stored in
    // `validation_runs.failure_code`, which is deliberately unconstrained —
    // otherwise adding a failure reason would mean a migration, and a forgotten
    // one fails only at INSERT.
    expect(constrainedToASet(sql, "failure_code")).toBe(false);
  });
});

describe("validation retry index after artifact capture failure", () => {
  function currentActiveStatuses(): string[] {
    const files = readdirSync(MIGRATIONS)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    let statuses: string[] | null = null;

    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS, file), "utf8").replace(/--[^\n]*/g, "");
      const matches = [
        ...sql.matchAll(
          /create unique index validation_runs_single_active_idx[\s\S]*?where status in \(([^)]*)\)/g,
        ),
      ];
      const latest = matches.at(-1);
      if (latest) statuses = [...latest[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    }

    if (statuses === null)
      throw new Error("no validation_runs_single_active_idx found in migrations");
    return statuses;
  }

  it("blocks concurrent work without making a historical pass permanently active", () => {
    // A pass whose snapshot capture failed must be allowed to run again. The
    // operation and this index still prevent two concurrent retries from
    // provisioning two paid sandboxes.
    expect(currentActiveStatuses().sort()).toEqual(["queued", "running"]);
  });
});

describe("the sandbox policy version tracks what it claims to (§9)", () => {
  /**
   * The rule this file could not previously enforce.
   *
   * `SANDBOX_POLICY_VERSION` is part of the validation identity, so it decides
   * which stored results may be reused. "Validated" is a claim about the
   * commands that ran, the network they ran with, the secrets they did not
   * have — **and the budgets they ran under**, because a budget decides which
   * artifacts can pass at all. The durable-phase refactor is exactly that kind
   * of change: work that could only ever record `sandbox_timeout` under v2 can
   * legitimately pass under v3.
   *
   * Until now nothing failed when the version was left behind. A mutation that
   * reverted the bump to `sandbox-policy-v2` broke no test — every real run
   * would then have reused a v2 pass to answer a v3 question, and reported an
   * old verdict as a current one.
   *
   * The version cannot be pinned to a literal: doing that makes every
   * legitimate bump look like a regression, which is why the earlier test
   * deliberately asserted against the constant instead. What *can* be pinned is
   * the relationship — the version against a digest of the policy it names. A
   * change to the policy with no change to the version fails here, and so does
   * the reverse. Updating both is a deliberate act, which is the point.
   */
  function policyDigest(): string {
    // Everything that changes what a passing validation means. Ordered
    // explicitly so a refactor of any of these objects cannot silently rehash.
    const policy = JSON.stringify([
      STEP_DEADLINE_MS,
      SANDBOX_BUDGETS.totalLifetimeMs,
      SANDBOX_BUDGETS.installTimeoutMs,
      SANDBOX_BUDGETS.commandTimeoutMs,
      SANDBOX_BUDGETS.sourceTimeoutMs,
      SANDBOX_BUDGETS.maxIntegrityFileBytes,
      SANDBOX_BUDGETS.maxBuildIdentityFileBytes,
      // How long a successful validation's artifact is retained. Part of the
      // policy because a stored pass now implies something was kept.
      SANDBOX_BUDGETS.validatedArtifactTtlMs,
      SANDBOX_RESOURCES.vcpus,
      SANDBOX_RESOURCES.image,
      [...SOURCE_HOSTS],
      [...DEPENDENCY_HOSTS],
      installCommand("pnpm"),
      installCommand("npm"),
    ]);

    return createHash("sha256").update(policy).digest("hex").slice(0, 16);
  }

  /**
   * The policy each version names.
   *
   * Add a row when bumping the version; never edit an existing one. An edited
   * row would mean a stored result claims a policy it was not checked against,
   * which is the failure the version exists to prevent.
   */
  const POLICY_DIGESTS: Record<string, string> = {
    "sandbox-policy-v3": "1516401ee57c583c",
    "sandbox-policy-v4": "60c4a0790acd706c",
    "sandbox-policy-v5": "b581f04c52fe0e7a",
  };

  it("names a policy version that matches the policy actually in force", () => {
    expect(POLICY_DIGESTS[SANDBOX_POLICY_VERSION]).toBe(policyDigest());
  });

  it("changes the validation identity when the policy version changes", () => {
    // The mechanism behind the rule: identity is what stops a v2 pass being
    // reused to answer a v3 question.
    const base = {
      preparedChangeId: "prepared_1",
      preparedCommitSha: "2f05958e3410deaeb97029861abc05889139b4a7",
      validationProfile: "nextjs_node_v1" as const,
      validationProfileVersion: "nextjs-node-v1",
      validationDepth: "standard" as const,
      validationDepthPolicyVersion: VALIDATION_DEPTH_POLICY_VERSION,
      workspaceRoot: ".",
    };

    expect(
      computeValidationIdentity({ ...base, sandboxPolicyVersion: "sandbox-policy-v2" }),
    ).not.toBe(computeValidationIdentity({ ...base, sandboxPolicyVersion: "sandbox-policy-v3" }));
  });

  it("changes the validation identity when the depth changes", () => {
    // The same mechanism, applied to the axis Sprint 0047 added: a `fast` pass
    // and a `deep` pass answer different questions about the same commit, so
    // one must never be reused to satisfy a request for the other.
    const base = {
      preparedChangeId: "prepared_1",
      preparedCommitSha: "2f05958e3410deaeb97029861abc05889139b4a7",
      validationProfile: "nextjs_node_v1" as const,
      validationProfileVersion: "nextjs-node-v1",
      sandboxPolicyVersion: SANDBOX_POLICY_VERSION,
      validationDepthPolicyVersion: VALIDATION_DEPTH_POLICY_VERSION,
      workspaceRoot: ".",
    };

    const fast = computeValidationIdentity({ ...base, validationDepth: "fast" });
    const standard = computeValidationIdentity({ ...base, validationDepth: "standard" });
    const deep = computeValidationIdentity({ ...base, validationDepth: "deep" });

    expect(new Set([fast, standard, deep]).size).toBe(3);
  });

  it("changes the validation identity when the depth policy version changes", () => {
    const base = {
      preparedChangeId: "prepared_1",
      preparedCommitSha: "2f05958e3410deaeb97029861abc05889139b4a7",
      validationProfile: "nextjs_node_v1" as const,
      validationProfileVersion: "nextjs-node-v1",
      sandboxPolicyVersion: SANDBOX_POLICY_VERSION,
      validationDepth: "fast" as const,
      workspaceRoot: ".",
    };

    expect(
      computeValidationIdentity({ ...base, validationDepthPolicyVersion: "validation-depth-v1" }),
    ).not.toBe(
      computeValidationIdentity({ ...base, validationDepthPolicyVersion: "validation-depth-v2" }),
    );
  });
});
