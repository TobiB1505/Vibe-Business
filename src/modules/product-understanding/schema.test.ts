import { describe, expect, it } from "vitest";
import { checkedValues, migrationSql } from "@/modules/operations/migration-test-support";
import { OPERATION_STAGES, OPERATION_TYPES, hasEnteredPaidWork } from "@/modules/operations/schema";
import { CONFIDENCE_LEVELS, EDITABLE_FIELDS, SOURCE_PRIORITY } from "./schema";

/**
 * The SQL contract, pinned to the TypeScript one.
 *
 * A union and a CHECK express the same rule in two places that nothing forces
 * to agree, and the in-memory test database does not evaluate constraints — so
 * no behavioural test can see them drift. This project has shipped an
 * `operation_type` that failed every INSERT while every test stayed green.
 * These assertions are the thing that stopped it happening again.
 */

const sql = () => migrationSql().join("\n");

describe("operation vocabulary", () => {
  it("permits every operation type the application can create", () => {
    expect(new Set(checkedValues("operation_runs", "operation_type"))).toEqual(
      new Set(OPERATION_TYPES),
    );
  });

  it("permits every stage the application can set", () => {
    expect(new Set(checkedValues("operation_runs", "stage"))).toEqual(new Set(OPERATION_STAGES));
  });

  it("treats the understanding synthesis stage as paid work", () => {
    // The point of no return for cost: once here, the provider may already
    // have been billed and nothing downstream may quietly start it again.
    expect(hasEnteredPaidWork("understanding_product")).toBe(true);
    // The two stages before it are free reads and must stay cancellable.
    expect(hasEnteredPaidWork("reading_code")).toBe(false);
    expect(hasEnteredPaidWork("reading_public_product")).toBe(false);
  });
});

describe("product_profiles", () => {
  it("permits exactly the statuses the store writes", () => {
    expect(new Set(checkedValues("product_profiles", "status"))).toEqual(
      new Set(["pending", "analyzing", "completed", "failed"]),
    );
  });

  it("refuses a completed profile with no result", () => {
    expect(sql()).toContain("product_profiles_completed_has_result");
  });

  it("refuses a confirmation of something that never completed", () => {
    expect(sql()).toContain("product_profiles_confirmed_is_completed");
  });

  it("refuses a profile that claims a model without naming one", () => {
    // The `synthesized` flag and the attribution columns have to agree, or a
    // deterministic profile could be displayed as a model's work.
    expect(sql()).toContain("product_profiles_synthesis_is_attributed");
  });

  it("blocks two in-flight derivations for one input", () => {
    // The database half of "never spend inference twice on identical input"
    // (CLAUDE.md rule 48). A double-clicked button fails the second insert.
    expect(sql()).toMatch(
      /create unique index product_profiles_single_in_flight_idx[\s\S]{0,300}?where status in \('pending', 'analyzing'\)/i,
    );
  });

  it("keeps a profile explainable by refusing to cascade its evidence away", () => {
    const table = sql().slice(sql().indexOf("create table public.product_profiles"));
    const body = table.slice(0, table.indexOf("\n);"));

    expect(body).toContain("repository_intelligence_snapshots (id) on delete restrict");
    expect(body).toContain("live_product_intelligence_snapshots (id) on delete restrict");
    expect(body).toContain("authenticated_product_intelligence_snapshots (id) on delete restrict");
  });

  it("scopes every policy to the owning user", () => {
    const policies = sql().match(/create policy "[^"]*product_profiles"[\s\S]*?;/g) ?? [];
    expect(policies.length).toBe(4);
    for (const policy of policies) {
      expect(policy).toContain("p.user_id = auth.uid()");
    }
  });
});

describe("product_profile_corrections", () => {
  it("holds one row per project so a correction outlives every re-scan", () => {
    expect(sql()).toContain("product_profile_corrections_project_key unique (project_id)");
  });

  it("refuses anything but a bounded JSON object", () => {
    expect(sql()).toContain("product_profile_corrections_is_object");
    expect(sql()).toContain("product_profile_corrections_bounded");
  });

  it("does not reference a profile id", () => {
    // Scoping a correction to one derivation would mean every re-scan
    // discards what the founder told us — the failure CORE-1 §25 names.
    const table = sql().slice(sql().indexOf("create table public.product_profile_corrections"));
    const body = table.slice(0, table.indexOf("\n);"));

    expect(body).not.toContain("product_profiles (id)");
  });
});

describe("the closed vocabularies the UI depends on", () => {
  it("keeps four confidence levels, with absence distinct from uncertainty", () => {
    expect(CONFIDENCE_LEVELS).toEqual(["confirmed", "likely", "unclear", "not_found"]);
  });

  it("ranks a person's own words above every derived source", () => {
    expect(SOURCE_PRIORITY[0]).toBe("user_confirmed");
    // Served beats declared: the live product outranks the repository.
    expect(SOURCE_PRIORITY.indexOf("live_product")).toBeLessThan(
      SOURCE_PRIORITY.indexOf("repository"),
    );
    // A model's reading is last.
    expect(SOURCE_PRIORITY[SOURCE_PRIORITY.length - 1]).toBe("ai_inferred");
  });

  it("makes only semantic fields editable, never scanner evidence", () => {
    expect(EDITABLE_FIELDS).toEqual([
      "name",
      "shortDescription",
      "understanding",
      "mainPurpose",
      "mainPromise",
      "primaryAudience",
      "problemSolved",
    ]);
  });
});
