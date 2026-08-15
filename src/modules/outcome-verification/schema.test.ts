import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkedValues, migrationSql } from "@/modules/operations/migration-test-support";
import { OPERATION_STAGES, OPERATION_TYPES } from "@/modules/operations/schema";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { OUTCOME_FAILURE_MESSAGES, outcomeCheckLabel } from "./messages";
import {
  OUTCOME_CHECK_KINDS,
  OUTCOME_CHECK_STATUSES,
  OUTCOME_EVIDENCE_SCHEMA_VERSION,
  OUTCOME_FAILURE_CODES,
  OUTCOME_POLICY_VERSION,
  OUTCOME_PROFILES,
  OUTCOME_RESOURCE_PATHS,
  OUTCOME_STATUSES,
} from "./schema";

/**
 * The database contract for outcome verification (Sprint 12A §36, §37, §38).
 *
 * ## Why this file exists at all
 *
 * A TypeScript union and a SQL CHECK state the same rule in two places nothing
 * forces to agree, and the in-memory test database does not evaluate
 * constraints — so no behavioural test can see them drift. This project has now
 * been bitten four times: a capability bump that would have failed every INSERT
 * with 1376 tests green, and three `operation_type` CHECKs that did not permit
 * the operation the sprint had just built.
 *
 * The specific failure this migration would have produced without it: every
 * "Check production outcome" click failing at INSERT on
 * `operation_runs_operation_type_check`, before a single request was made, with
 * the whole suite green.
 */

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260814170000_change_outcome_verifications.sql",
);

function sql(): string {
  return readFileSync(MIGRATION, "utf8");
}

describe("the operation type and stages exist in the database (§38)", () => {
  it("permits change_outcome_verification as an operation type", () => {
    expect(checkedValues("operation_runs", "operation_type")).toContain(
      "change_outcome_verification",
    );
  });

  it("pins the operation type union to the SQL CHECK exactly", () => {
    expect([...checkedValues("operation_runs", "operation_type")].sort()).toEqual(
      [...OPERATION_TYPES].sort(),
    );
  });

  it("pins the stage union to the SQL CHECK exactly", () => {
    expect([...checkedValues("operation_runs", "stage")].sort()).toEqual(
      [...OPERATION_STAGES].sort(),
    );
  });

  it("permits both observation stages", () => {
    const stages = checkedValues("operation_runs", "stage");
    expect(stages).toContain("observing");
    expect(stages).toContain("evaluating");
  });
});

describe("the verification table's enumerations match the code (§38)", () => {
  it("pins the outcome status union to the SQL CHECK exactly", () => {
    expect([...checkedValues("change_outcome_verifications", "status")].sort()).toEqual(
      [...OUTCOME_STATUSES].sort(),
    );
  });

  it("pins the outcome profile union to the SQL CHECK exactly", () => {
    // The profile is a closed set of code paths, not a version string, so the
    // database enumerates it and adding one is a deliberate migration.
    expect([...checkedValues("change_outcome_verifications", "outcome_profile")].sort()).toEqual(
      [...OUTCOME_PROFILES].sort(),
    );
  });

  it("does not constrain the policy or profile version to an enumerated set", () => {
    // Same reasoning as the merge and sandbox policy versions: bumping must not
    // require a migration, because a forgotten one fails only at INSERT.
    expect(sql()).toContain(
      "outcome_policy_version text not null check (char_length(btrim(outcome_policy_version)) > 0)",
    );
    expect(OUTCOME_POLICY_VERSION.trim().length).toBeGreaterThan(0);
    expect(OUTCOME_EVIDENCE_SCHEMA_VERSION.trim().length).toBeGreaterThan(0);
  });

  it("requires a public origin that is https, at the database level (§11)", () => {
    // The production-URL policy refuses plain HTTP; the column says so too, so
    // an origin that bypassed the policy could not be stored either.
    expect(sql()).toContain("public_origin text not null check (public_origin like 'https://%')");
  });
});

describe("the database refuses an outcome without its evidence (§36, §45)", () => {
  it("requires a verified row to carry observations, results and a completion", () => {
    // The most load-bearing constraint in the file. A mutation that skips
    // observation entirely cannot store a green outcome.
    expect(sql()).toContain("constraint outcome_verified_has_observations");

    const constraint = sql().slice(sql().indexOf("outcome_verified_has_observations"));
    expect(constraint).toMatch(/check_results is not null/);
    expect(constraint).toMatch(/attempt_count > 0/);
    expect(constraint).toMatch(/observation_completed_at is not null/);
    expect(constraint).toMatch(/failure_code is null/);
  });

  it("requires partial and not_observed to carry observations too", () => {
    expect(sql()).toContain("constraint outcome_product_answer_has_observations");
    const constraint = sql().slice(sql().indexOf("outcome_product_answer_has_observations"));
    expect(constraint).toMatch(/status not in \('partial', 'not_observed'\)/);
    expect(constraint).toMatch(/check_results is not null/);
  });

  it("requires a failed row to say why", () => {
    expect(sql()).toContain("constraint outcome_failed_has_reason");
  });

  it("requires the observation window to actually be a window (§17, §45)", () => {
    // The mutation §45 names as "observation deadline removed", refused from
    // below: a deadline that does not follow a start cannot be stored.
    expect(sql()).toContain("constraint outcome_window_is_bounded");
    expect(sql()).toMatch(/verification_window_ends_at > verification_window_started_at/);
  });

  it("bounds the attempt count", () => {
    expect(sql()).toMatch(/attempt_count >= 0 and attempt_count <= 32/);
  });
});

describe("a normal user cannot forge an outcome (§37, §45)", () => {
  it("has no update policy, so only durable execution can record a result", () => {
    // The strongest available form of §37: not "the update policy is narrow"
    // but "there is no update policy". `verified`, the passed checks and the
    // observation timestamps are unreachable from a browser by construction.
    expect(sql()).not.toMatch(/on public\.change_outcome_verifications\s+for update/i);
  });

  it("has no delete policy", () => {
    expect(sql()).not.toMatch(/on public\.change_outcome_verifications\s+for delete/i);
  });

  it("only lets a client open a row that claims nothing", () => {
    const insertPolicy = sql().slice(
      sql().indexOf('create policy "insert own change_outcome_verifications"'),
    );

    expect(insertPolicy).toMatch(/change_outcome_verifications\.status = 'queued'/);
    expect(insertPolicy).toMatch(/change_outcome_verifications\.check_results is null/);
    expect(insertPolicy).toMatch(/change_outcome_verifications\.attempt_count = 0/);
    expect(insertPolicy).toMatch(/change_outcome_verifications\.completed_at is null/);
    expect(insertPolicy).toMatch(
      /change_outcome_verifications\.observation_completed_at is null/,
    );
    expect(insertPolicy).toMatch(
      /change_outcome_verifications\.verification_window_ends_at is null/,
    );
  });

  it("requires a genuinely merged, read-back merge at the database level (§10, §45)", () => {
    const insertPolicy = sql().slice(
      sql().indexOf('create policy "insert own change_outcome_verifications"'),
    );

    // The database saying what §10 says: an unmerged change cannot open a
    // verification row, whatever the application believes.
    expect(insertPolicy).toMatch(/from public\.change_merges cm/);
    expect(insertPolicy).toMatch(/cm\.status = 'merged'/);
    expect(insertPolicy).toMatch(
      /cm\.resulting_default_head_sha = change_outcome_verifications\.merged_commit_sha/,
    );
    expect(insertPolicy).toMatch(
      /cm\.prepared_commit_sha = change_outcome_verifications\.merged_commit_sha/,
    );
  });

  it("qualifies every reference to the new row, so no subquery binds the wrong table", () => {
    // Migration 20260814101000 is this lesson learned expensively.
    // `prepared_change_id` exists on `change_merges` and `change_approvals` too.
    const policies = sql().slice(
      sql().indexOf('create policy "select own change_outcome_verifications"'),
    );
    const bare = policies.match(
      /\b(?<!\.)(prepared_change_id|merged_commit_sha|change_approval_id)\s*=\s*(?!change_outcome_verifications\.)/g,
    );

    for (const reference of bare ?? []) {
      expect(reference).toMatch(/^(cm|orn|p)\./);
    }
  });

  it("keeps the identity index off `failed`, so a Vibe-side problem is retryable (§27)", () => {
    expect(sql()).toContain("create unique index change_outcome_verifications_identity_idx");
    expect(sql()).toMatch(
      /where status in \('queued', 'observing', 'verified', 'partial', 'not_observed'\)/,
    );
    // And `failed` is deliberately absent — a lock with no release would block
    // that verification forever with no way to clear it through the product.
    const predicate = sql().slice(sql().indexOf("change_outcome_verifications_identity_idx"));
    expect(predicate.slice(0, 400)).not.toMatch(/'failed'/);
  });
});

describe("no other migration weakens this one", () => {
  it("is the only place change_outcome_verifications policies are defined", () => {
    const definitions = migrationSql().filter((migration) =>
      /create\s+policy[\s\S]*?\bon\s+public\.change_outcome_verifications\b/i.test(migration),
    );
    expect(definitions).toHaveLength(1);
  });

  it("never grants update or delete anywhere in the history", () => {
    for (const migration of migrationSql()) {
      expect(migration).not.toMatch(
        /on\s+public\.change_outcome_verifications\s+for\s+(update|delete)/i,
      );
    }
  });
});

describe("every closed union has copy (§22, §23, §30)", () => {
  it("has a message for every failure code", () => {
    for (const code of OUTCOME_FAILURE_CODES) {
      expect(OUTCOME_FAILURE_MESSAGES[code]).toBeTruthy();
      // And it reaches the shared operation copy, so a durable failure never
      // renders as an internal identifier.
      expect(OPERATION_FAILURE_MESSAGES[code]).toBe(OUTCOME_FAILURE_MESSAGES[code]);
    }
  });

  it("has a human label for every check kind", () => {
    for (const kind of OUTCOME_CHECK_KINDS) {
      const label = outcomeCheckLabel({ kind, target: "/login" });
      expect(label).toBeTruthy();
      // Written the way a person would describe the behaviour, not the way the
      // domain models it.
      expect(label).not.toContain("_");
    }
  });

  it("has a path for every fetchable resource", () => {
    expect(OUTCOME_RESOURCE_PATHS).toEqual({
      robots_txt: "/robots.txt",
      sitemap_xml: "/sitemap.xml",
    });
  });

  it("keeps `error` distinct from `failed` in the check statuses (§23)", () => {
    expect([...OUTCOME_CHECK_STATUSES].sort()).toEqual(
      ["error", "failed", "not_observed", "passed"].sort(),
    );
  });
});

describe("no failure message characterises the customer's product (§22, §23)", () => {
  it("never says deployment failed", () => {
    for (const message of Object.values(OUTCOME_FAILURE_MESSAGES)) {
      expect(message.toLowerCase()).not.toContain("deployment failed");
      expect(message.toLowerCase()).not.toContain("deploy failed");
    }
  });

  it("never claims a business result", () => {
    for (const message of Object.values(OUTCOME_FAILURE_MESSAGES)) {
      for (const word of ["revenue", "conversion", "traffic", "growth"]) {
        expect(message.toLowerCase()).not.toContain(word);
      }
    }
  });
});
