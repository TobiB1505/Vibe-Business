import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkedValues, migrationSql } from "@/modules/operations/migration-test-support";
import { OPERATION_STAGES, OPERATION_TYPES } from "@/modules/operations/schema";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { CAUSAL_PHRASES, findCausalClaims } from "./causality";
import { MEASUREMENT_FAILURE_MESSAGES, MEASUREMENT_LADDER_LABELS, MEASUREMENT_STATUS_HEADLINES } from "./messages";
import { METRIC_DEFINITIONS } from "./metrics";
import {
  DATA_QUALITY,
  MEASUREMENT_FAILURE_CODES,
  MEASUREMENT_PLAN_STATUSES,
  MEASUREMENT_POLICY_VERSION,
  MEASUREMENT_STATUSES,
  METRIC_AGGREGATIONS,
  METRIC_CATEGORIES,
  METRIC_DIRECTIONS,
  METRIC_KEYS,
  METRIC_SOURCE_KINDS,
} from "./schema";

/**
 * The database contract for business measurement (Sprint 12B §37, §44).
 *
 * ## Why this file exists
 *
 * A TypeScript union and a SQL CHECK state the same rule in two places nothing
 * forces to agree, and the in-memory test database does not evaluate
 * constraints — so no behavioural test can see them drift. This project has now
 * been bitten five times, each one an `operation_type` the deployed database
 * refused while the whole suite stayed green.
 */

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260815120000_business_outcome_measurement.sql",
);

function sql(): string {
  return readFileSync(MIGRATION, "utf8");
}

describe("the operation type and stages exist in the database (§37)", () => {
  it("permits business_measurement as an operation type", () => {
    expect(checkedValues("operation_runs", "operation_type")).toContain("business_measurement");
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

  it("permits every measurement stage", () => {
    const stages = checkedValues("operation_runs", "stage");
    for (const stage of ["collecting_baseline", "collecting_post", "comparing"]) {
      expect(stages).toContain(stage);
    }
  });
});

describe("the enumerations match the code (§37)", () => {
  it("pins the measurement status union to the SQL CHECK exactly", () => {
    expect([...checkedValues("business_outcome_measurements", "status")].sort()).toEqual(
      [...MEASUREMENT_STATUSES].sort(),
    );
  });

  it("pins the plan status union to the SQL CHECK exactly", () => {
    expect([...checkedValues("measurement_plans", "status")].sort()).toEqual(
      [...MEASUREMENT_PLAN_STATUSES].sort(),
    );
  });

  it("pins the metric key union to the SQL CHECK exactly", () => {
    expect([...checkedValues("business_outcome_measurements", "metric_key")].sort()).toEqual(
      [...METRIC_KEYS].sort(),
    );
  });

  it("pins the metric direction union, including the unimplemented one (§5)", () => {
    // `target_range` must exist in the database too, so a future metric
    // declaring it is refused by the classifier rather than by an INSERT.
    expect([...checkedValues("business_outcome_measurements", "metric_direction")].sort()).toEqual(
      [...METRIC_DIRECTIONS].sort(),
    );
  });

  it("pins the aggregation, category, source kind and data quality unions", () => {
    expect([...checkedValues("business_outcome_measurements", "metric_aggregation")].sort()).toEqual(
      [...METRIC_AGGREGATIONS].sort(),
    );
    expect([...checkedValues("measurement_plans", "metric_category")].sort()).toEqual(
      [...METRIC_CATEGORIES].sort(),
    );
    expect([...checkedValues("business_outcome_measurements", "metric_source_kind")].sort()).toEqual(
      [...METRIC_SOURCE_KINDS].sort(),
    );
    expect([...checkedValues("business_outcome_measurements", "data_quality")].sort()).toEqual(
      [...DATA_QUALITY].sort(),
    );
  });

  it("does not constrain the policy version to an enumerated set", () => {
    expect(sql()).toContain(
      "measurement_policy_version text not null check (char_length(btrim(measurement_policy_version)) > 0)",
    );
    expect(MEASUREMENT_POLICY_VERSION.trim().length).toBeGreaterThan(0);
  });
});

describe("the database refuses a result without its numbers (§37, §46)", () => {
  it("requires a stated result to carry baseline, observed value and samples", () => {
    // The most load-bearing constraint in the file. A mutation that skips
    // collection entirely cannot store a green result.
    expect(sql()).toContain("constraint business_measurement_result_has_values");

    const constraint = sql().slice(sql().indexOf("business_measurement_result_has_values"));
    expect(constraint).toMatch(/baseline_value is not null/);
    expect(constraint).toMatch(/observed_value is not null/);
    expect(constraint).toMatch(/sample_size_before is not null/);
    expect(constraint).toMatch(/sample_size_after is not null/);
    expect(constraint).toMatch(/jsonb_array_length\(provenance\) > 0/);
  });

  it("requires insufficient_data to say it looked", () => {
    expect(sql()).toContain("constraint business_measurement_insufficient_has_quality");
  });

  it("requires a failed measurement to say why (§33)", () => {
    expect(sql()).toContain("constraint business_measurement_failed_has_reason");
  });

  it("refuses windows that overlap (§42, §46)", () => {
    // An overlap silently compares part of a period against itself and biases
    // every result toward "no change". Enforced from below because it is the
    // kind of arithmetic mistake that reads as correct.
    expect(sql()).toContain("constraint business_measurement_windows_do_not_overlap");
    expect(sql()).toMatch(/measurement_start >= baseline_end/);
  });

  it("refuses a window that ends before it begins", () => {
    expect(sql()).toContain("constraint business_measurement_windows_are_ordered");
  });

  it("never defaults a value to zero", () => {
    // A missing value and a measured zero are different facts, and a default
    // would make an analytics outage look like a collapse in traffic.
    const table = sql().slice(sql().indexOf("create table public.business_outcome_measurements"));
    expect(table).toMatch(/baseline_value double precision,/);
    expect(table).not.toMatch(/baseline_value double precision not null default 0/);
  });

  it("requires an explicit timezone on every measurement (§32)", () => {
    expect(sql()).toMatch(
      /measurement_timezone text not null check \(char_length\(btrim\(measurement_timezone\)\) > 0\)/,
    );
  });
});

describe("a client cannot forge a result (§44, §46)", () => {
  it("has no update policy on either table", () => {
    // The strongest available form: not "the update policy is narrow" but
    // "there is no update policy". The baseline, the observed value, the
    // classification and the sample sizes are unreachable from a browser.
    expect(sql()).not.toMatch(/on public\.business_outcome_measurements\s+for update/i);
    expect(sql()).not.toMatch(/on public\.measurement_plans\s+for update/i);
  });

  it("has no delete policy on either table", () => {
    expect(sql()).not.toMatch(/on public\.business_outcome_measurements\s+for delete/i);
    expect(sql()).not.toMatch(/on public\.measurement_plans\s+for delete/i);
  });

  it("only lets a client open a measurement that claims nothing", () => {
    const policy = sql().slice(
      sql().indexOf('create policy "insert own business_outcome_measurements"'),
    );

    expect(policy).toMatch(/business_outcome_measurements\.baseline_value is null/);
    expect(policy).toMatch(/business_outcome_measurements\.observed_value is null/);
    expect(policy).toMatch(/business_outcome_measurements\.observed_relative_change is null/);
    expect(policy).toMatch(/business_outcome_measurements\.sample_size_before is null/);
    expect(policy).toMatch(/business_outcome_measurements\.data_quality is null/);
    expect(policy).toMatch(/business_outcome_measurements\.completed_at is null/);
    expect(policy).toMatch(/business_outcome_measurements\.provenance = '\[\]'::jsonb/);
  });

  it("refuses a status that already states a result", () => {
    const policy = sql().slice(
      sql().indexOf('create policy "insert own business_outcome_measurements"'),
    );
    expect(policy).toMatch(
      /business_outcome_measurements\.status in \('waiting_for_source', 'waiting_for_window'\)/,
    );
  });

  it("requires a merged merge before a plan can exist (§37)", () => {
    const policy = sql().slice(sql().indexOf('create policy "insert own measurement_plans"'));

    expect(policy).toMatch(/from public\.change_merges cm/);
    expect(policy).toMatch(/cm\.status = 'merged'/);
    expect(policy).toMatch(/cm\.resulting_default_head_sha = cm\.prepared_commit_sha/);
  });

  it("requires a ready plan naming this exact metric before a measurement can exist", () => {
    const policy = sql().slice(
      sql().indexOf('create policy "insert own business_outcome_measurements"'),
    );

    expect(policy).toMatch(/mp\.status = 'ready'/);
    expect(policy).toMatch(/mp\.primary_metric = business_outcome_measurements\.metric_key/);
    expect(policy).toMatch(/mp\.metric_direction = business_outcome_measurements\.metric_direction/);
  });

  it("qualifies every reference to the new row", () => {
    const policies = sql().slice(sql().indexOf('create policy "select own measurement_plans"'));
    const bare = policies.match(
      /\b(?<!\.)(change_merge_id|prepared_change_id|metric_key|primary_metric)\s*=\s*(?!measurement_plans\.|business_outcome_measurements\.)/g,
    );

    for (const reference of bare ?? []) {
      expect(reference).toMatch(/^(cm|mp|orn|p)\./);
    }
  });

  it("keeps the identity index off `failed`, so a Vibe-side problem is retryable (§35)", () => {
    expect(sql()).toContain("create unique index business_measurements_identity_idx");
    const predicate = sql().slice(sql().indexOf("business_measurements_identity_idx"));
    expect(predicate.slice(0, 400)).not.toMatch(/'failed'/);
  });

  it("indexes due work, so a future runner is a consumer rather than a redesign (§30)", () => {
    expect(sql()).toContain("create index business_measurements_due_idx");
    expect(sql()).toMatch(/on public\.business_outcome_measurements \(next_observation_at\)/);
  });
});

describe("no other migration weakens this one", () => {
  it("is the only place these policies are defined", () => {
    for (const table of ["measurement_plans", "business_outcome_measurements"]) {
      const definitions = migrationSql().filter((migration) =>
        new RegExp(`create\\s+policy[\\s\\S]*?\\bon\\s+public\\.${table}\\b`, "i").test(migration),
      );
      expect(definitions).toHaveLength(1);
    }
  });

  it("never grants update or delete anywhere in the history", () => {
    for (const migration of migrationSql()) {
      expect(migration).not.toMatch(
        /on\s+public\.(measurement_plans|business_outcome_measurements)\s+for\s+(update|delete)/i,
      );
    }
  });
});

describe("every closed union has copy (§21, §26, §33)", () => {
  it("has a message for every failure code, reaching the shared operation copy", () => {
    for (const code of MEASUREMENT_FAILURE_CODES) {
      expect(MEASUREMENT_FAILURE_MESSAGES[code]).toBeTruthy();
      expect(OPERATION_FAILURE_MESSAGES[code]).toBe(MEASUREMENT_FAILURE_MESSAGES[code]);
    }
  });

  it("has a headline and a ladder label for every status", () => {
    for (const status of MEASUREMENT_STATUSES) {
      expect(MEASUREMENT_STATUS_HEADLINES[status]).toBeTruthy();
      expect(MEASUREMENT_LADDER_LABELS[status]).toBeTruthy();
    }
  });

  it("has a complete definition for every metric key", () => {
    for (const key of METRIC_KEYS) {
      const definition = METRIC_DEFINITIONS[key];
      expect(definition.minimumObservationsPerWindow).toBeGreaterThan(0);
      expect(definition.neutralBand).toBeGreaterThan(0);
      expect(definition.sourceKinds.length).toBeGreaterThan(0);
    }
  });
});

describe("no copy asserts causation, and none says 'no impact' (§10, §21, §43)", () => {
  const allCopy = [
    ...Object.values(MEASUREMENT_FAILURE_MESSAGES),
    ...Object.values(MEASUREMENT_STATUS_HEADLINES),
    ...Object.values(MEASUREMENT_LADDER_LABELS),
  ];

  it("contains no causal phrase", () => {
    for (const copy of allCopy) {
      expect(findCausalClaims(copy)).toEqual([]);
    }
  });

  it("never says 'no impact' — the sentence a missing source must not become", () => {
    for (const copy of allCopy) {
      expect(copy.toLowerCase()).not.toContain("no impact");
    }
  });

  it("keeps the causal vocabulary broad enough to be worth checking", () => {
    // A safeguard that only matched the literal word "caused" would miss
    // "drove", "led to" and "thanks to", each of which reads as causal.
    expect(CAUSAL_PHRASES.length).toBeGreaterThan(10);
    expect(findCausalClaims("Traffic rose thanks to this change")).not.toEqual([]);
    expect(findCausalClaims("Signups increased, driven by the sitemap")).not.toEqual([]);
  });

  it("accepts the observational phrasing the product actually uses", () => {
    expect(
      findCausalClaims("Organic search clicks increased during the measurement window."),
    ).toEqual([]);
  });
});
