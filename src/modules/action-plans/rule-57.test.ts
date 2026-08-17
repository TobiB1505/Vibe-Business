import { describe, expect, it } from "vitest";
import { classifyStep } from "./classify";
import { fakeRepositorySnapshotFor, fakeWirePlan, FAKE_PLAN_EVIDENCE_IDS } from "./test-support";
import { validateActionPlanOutput } from "./validate";
import {
  ANTHROPIC_ACTION_PLAN_OUTPUT_SCHEMA,
  normalizeAnthropicActionPlanOutput,
} from "./wire-schema";

/**
 * CLAUDE.md Rule 57, as a regression suite (CORE-2b §12, §85).
 *
 * > Model output must never control repository paths, refs, branch names,
 * > commit messages or generated code. Only deterministic capability code
 * > produces those.
 *
 * The Action Planner is the first layer since Rule 57 was written where a model
 * describes work that will *later* become a repository change. That is exactly
 * the shape in which such a channel gets reopened by accident — someone adds a
 * `targetFile` field to make a future execution step easier to route, and the
 * rule is gone without anyone deciding to remove it.
 *
 * So these tests do not check the prompt's wording. They check that no field
 * exists, at any depth, and that nothing survives normalization that could act
 * as one.
 */

/** Every property name in a JSON Schema, at any depth. */
function propertyNames(schema: unknown, found: string[] = []): string[] {
  if (typeof schema !== "object" || schema === null) return found;

  const node = schema as Record<string, unknown>;
  const properties = node.properties;
  if (typeof properties === "object" && properties !== null) {
    for (const [name, child] of Object.entries(properties)) {
      found.push(name);
      propertyNames(child, found);
    }
  }
  if (node.items) propertyNames(node.items, found);

  return found;
}

/**
 * Substrings that would name a repository concept.
 *
 * Matched case-insensitively against every property name. Deliberately broad —
 * a false positive here costs one conversation about a field name, and a false
 * negative costs the rule.
 */
const FORBIDDEN = [
  "path",
  "file",
  "dir",
  "glob",
  "branch",
  "ref",
  "sha",
  "commit",
  "diff",
  "patch",
  "code",
  "repo",
  "merge",
  "pull",
  "capabilit",
  "permission",
  "scope",
  "execut",
];

describe("Rule 57 — the planner cannot control repository state", () => {
  it("declares no field that names a repository concept", () => {
    const names = propertyNames(ANTHROPIC_ACTION_PLAN_OUTPUT_SCHEMA);
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      for (const forbidden of FORBIDDEN) {
        expect(
          name.toLowerCase().includes(forbidden),
          `wire field "${name}" names a repository or execution concept ("${forbidden}") — Rule 57`,
        ).toBe(false);
      }
    }
  });

  it("closes every object to additional properties", () => {
    const closed = (schema: unknown): void => {
      if (typeof schema !== "object" || schema === null) return;
      const node = schema as Record<string, unknown>;
      if (node.type === "object") expect(node.additionalProperties).toBe(false);
      if (node.properties) {
        for (const child of Object.values(node.properties as Record<string, unknown>)) closed(child);
      }
      if (node.items) closed(node.items);
    };
    closed(ANTHROPIC_ACTION_PLAN_OUTPUT_SCHEMA);
  });

  /**
   * The runtime half. `additionalProperties: false` is the provider's promise;
   * this is ours, and it is the one that has to hold if the provider's does not.
   */
  it("drops repository fields a response smuggles in anyway", () => {
    const wire = fakeWirePlan();
    const contaminated = {
      ...wire,
      branch: "vibe/take-over-main",
      commitMessage: "chore: rewrite everything",
      steps: wire.steps.map((step) => ({
        ...step,
        path: "src/app/page.tsx",
        code: "export default function Page() { return null }",
        capability: "stripe_checkout_v9",
        executionSupport: "vibe_executes_now",
      })),
    };

    const normalized = normalizeAnthropicActionPlanOutput(contaminated);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    const serialized = JSON.stringify(normalized.plan);
    expect(serialized).not.toContain("vibe/take-over-main");
    expect(serialized).not.toContain("src/app/page.tsx");
    expect(serialized).not.toContain("stripe_checkout_v9");
    expect(serialized).not.toContain("chore: rewrite everything");
  });

  /**
   * §84 — a model that names a capability changes nothing.
   *
   * The registry is the only thing that can produce one, and it never sees the
   * model's suggestion because the field did not survive normalization.
   */
  it("ignores a capability the model invented", () => {
    const wire = fakeWirePlan();
    const contaminated = {
      ...wire,
      steps: wire.steps.map((step) => ({ ...step, capability: "stripe_checkout_v9" })),
    };

    const normalized = normalizeAnthropicActionPlanOutput(contaminated);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    const result = validateActionPlanOutput(normalized.plan, FAKE_PLAN_EVIDENCE_IDS, {
      repository: fakeRepositorySnapshotFor(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const step of result.result.steps) {
      expect(step.capability).not.toBe("stripe_checkout_v9");
    }
  });

  /**
   * The classifier takes structured fields and a snapshot. There is no argument
   * through which a model could influence what it decides, and this pins that:
   * the same step, classified with and without an invented capability in scope,
   * produces the same answer because the field is not part of the input type.
   */
  it("derives execution support without any model-supplied claim", () => {
    const classification = classifyStep(
      { actor: "vibe", changeKind: "product_change", evidenceIds: [] },
      { repository: fakeRepositorySnapshotFor() },
    );

    expect(classification.executionSupport).toBe("not_yet_supported");
    expect(classification.capability).toBeNull();
  });
});
