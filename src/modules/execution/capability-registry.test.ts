import { describe, expect, it } from "vitest";
import {
  findCausalClaims,
  findPromissoryClaims,
} from "@/modules/business-measurement/causality";
import { businessRationaleFor } from "./business-rationale";
import {
  allCapabilityDefinitions,
  capabilityCompleteness,
  capabilityDefinition,
  isCurrentCapability,
  withinWriteBudget,
} from "./capability-registry";
import { outcomeProfileForCapability } from "./outcome-contract";
import { CURRENT_SEO_FOUNDATIONS_CAPABILITY, EXECUTION_CAPABILITIES } from "./schema";

/**
 * The completeness contract (Sprint 13A §59, §64).
 *
 * These tests are the reason the registry exists. A capability's definition
 * lives across eight modules keyed by the same union, and nothing forces them
 * to agree — so a capability could ship with a generator and no rationale, or
 * with an outcome profile that verifies files its generator never writes.
 *
 * Both failures execute successfully and then explain themselves wrongly, which
 * is worse than crashing. These assertions run over **every** capability that
 * exists, so they cover the next one somebody adds rather than only the ones
 * written today.
 */

describe("every capability is complete", () => {
  it.each([...EXECUTION_CAPABILITIES])("%s has everything execution requires", (capability) => {
    expect(capabilityCompleteness(capability)).toEqual({ complete: true });
  });

  it("reports precisely what is missing rather than a boolean", () => {
    // The diagnostic matters: "incomplete" sends someone hunting through eight
    // modules, "missing businessRationale" does not.
    const result = capabilityCompleteness(EXECUTION_CAPABILITIES[0]);
    expect(result).toHaveProperty("complete");
    if (!result.complete) expect(Array.isArray(result.missing)).toBe(true);
  });
});

describe("identity", () => {
  it("gives every capability a unique id", () => {
    const ids = allCapabilityDefinitions().map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every capability a version, so historical artifacts stay readable", () => {
    // A PreparedChange from v1 must keep meaning what it meant when it was
    // written, even after v2 changed what the generator emits (§40).
    for (const definition of allCapabilityDefinitions()) {
      expect(definition.version).toBeTruthy();
    }
  });

  it("marks exactly one capability current, and keeps the rest resolvable", () => {
    const current = allCapabilityDefinitions().filter((definition) => definition.status === "current");

    expect(current).toHaveLength(1);
    expect(current[0].id).toBe(CURRENT_SEO_FOUNDATIONS_CAPABILITY);
    // Historical capabilities are not deleted: real customer artifacts were
    // produced by them.
    expect(isCurrentCapability("nextjs_seo_foundations_v1")).toBe(false);
    expect(capabilityDefinition("nextjs_seo_foundations_v1").version).toBeTruthy();
  });
});

describe("every capability can explain itself", () => {
  it.each([...EXECUTION_CAPABILITIES])("%s has a rationale with a limitation", (capability) => {
    const rationale = businessRationaleFor(capability);

    expect(rationale).not.toBeNull();
    // A rationale without its limitation is a promise.
    expect(rationale!.limitations.trim().length).toBeGreaterThan(0);
  });

  it.each([...EXECUTION_CAPABILITIES])("%s claims no causality", (capability) => {
    const rationale = businessRationaleFor(capability)!;
    const copy = [
      rationale.problem,
      rationale.changeSummary,
      rationale.whyItMatters,
      rationale.expectedOutcome,
      rationale.limitations,
    ].join(" ");

    expect(findCausalClaims(copy)).toEqual([]);
    // And promises nothing either. A rationale is written before anything has
    // happened, so a forward-looking promise is the failure mode it is actually
    // prone to — "this increases organic traffic" passes the causal checker
    // cleanly, which a deliberate regression found rather than reasoning did.
    expect(findPromissoryClaims(copy)).toEqual([]);
    // A rationale carrying a number would be indistinguishable from a result.
    expect(copy).not.toMatch(/\d+\s*%/);
  });
});

describe("every capability can be checked afterwards", () => {
  it.each([...EXECUTION_CAPABILITIES])("%s has a product outcome profile", (capability) => {
    // A change whose success cannot be verified is a change nobody can be held
    // to. Measurement profiles are deliberately *not* required — business
    // measurement is optional evidence that may never arrive.
    expect(outcomeProfileForCapability(capability)).not.toBeNull();
  });
});

describe("write budgets bound the diff before anything is written", () => {
  it.each([...EXECUTION_CAPABILITIES])("%s declares a positive budget", (capability) => {
    expect(capabilityDefinition(capability).maxChangedFiles).toBeGreaterThan(0);
  });

  it("accepts output within budget", () => {
    expect(withinWriteBudget("nextjs_seo_foundations_v2", 2)).toEqual({ ok: true });
    expect(withinWriteBudget("nextjs_seo_foundations_v2", 1)).toEqual({ ok: true });
  });

  it("refuses output over budget, and says by how much", () => {
    // A deterministic generator emitting nine files is a defect whatever their
    // names, and a diff that size stops being reviewable — which is the
    // property the whole human-approval gate rests on.
    expect(withinWriteBudget("nextjs_seo_foundations_v2", 9)).toEqual({
      ok: false,
      budget: 2,
      attempted: 9,
    });
  });

  it("keeps the budget out of the generator's reach", () => {
    // The number lives in the registry, not in the code that would be
    // exceeding it — a capability cannot raise its own ceiling at runtime.
    const definition = capabilityDefinition("nextjs_seo_foundations_v2");
    expect(definition.maxChangedFiles).toBe(2);
    expect(definition.basenames).toEqual(["robots.ts", "sitemap.ts"]);
  });

  it("matches the budget to the write allowlist", () => {
    // A budget larger than the allowlist would be dead headroom; smaller would
    // make a legitimate generator unshippable. They describe the same scope
    // from two directions and must agree.
    for (const definition of allCapabilityDefinitions()) {
      expect(definition.maxChangedFiles).toBe(definition.basenames.length);
    }
  });
});
