import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCausalClaims } from "@/modules/business-measurement/causality";
import { businessRationaleFor } from "@/modules/execution/business-rationale";

/**
 * The post-change experience after the 12C cleanup (§13).
 *
 * The product rule this encodes: **a completed change explains itself without
 * an analytics connection existing anywhere.** Measurement is infrastructure;
 * it must not dominate, gate, or interrupt the normal flow.
 */

const DIR = join(process.cwd(), "src/app/app/projects/[projectId]");

function source(file: string): string {
  return readFileSync(join(DIR, file), "utf8");
}

describe("a completed change needs no analytics connection", () => {
  it("renders rationale from the capability alone", () => {
    // No connection, no measurement, no model — a lookup on the capability.
    const rationale = businessRationaleFor("nextjs_seo_foundations_v2");

    expect(rationale).not.toBeNull();
    expect(rationale!.changeSummary).toBeTruthy();
    expect(rationale!.whyItMatters).toBeTruthy();
  });

  it("has no Search Console or analytics call-to-action anywhere on the page", () => {
    // Sprint 12C is parked. Nothing may prompt a user to connect a provider
    // that does not exist, least of all in the middle of the execution flow.
    for (const file of [
      "change-rationale.tsx",
      "business-impact-panel.tsx",
      "outcome-panel.tsx",
      "agent/change-gates.tsx",
    ]) {
      const src = source(file);
      for (const forbidden of ["Search Console", "searchConsole", "Connect analytics", "OAuth"]) {
        expect(src, `${file} references a parked connector`).not.toContain(forbidden);
      }
    }
  });

  it("never invokes Search Console code from the product flow", () => {
    // The parked modules live only in the branch history. Nothing in the
    // rendered product may import them.
    for (const file of ["business-impact-panel.tsx", "change-rationale.tsx"]) {
      expect(source(file)).not.toMatch(/metric-sources\/search-console/);
    }
  });
});

describe("the rationale section", () => {
  const src = source("change-rationale.tsx");

  it("leads with what changed and why, not with what is missing", () => {
    expect(src).toContain("What Vibe changed");
    expect(src).toContain("Why this matters");
  });

  it("always renders the limitation, unconditionally", () => {
    // A rationale without its limitation is a promise. The limitation must not
    // sit behind a conditional or a toggle.
    expect(src).toContain("rationale.limitations");
    expect(src).not.toMatch(/\{[^}]*&&[^}]*rationale\.limitations/);
  });

  it("renders nothing at all when a capability has no rationale", () => {
    // Better than a generic sentence that would be true of any change.
    expect(src).toMatch(/if \(!rationale\) return null/);
  });

  it("states no measured outcome", () => {
    const rationale = businessRationaleFor("nextjs_seo_foundations_v2")!;
    const copy = [
      rationale.problem,
      rationale.changeSummary,
      rationale.whyItMatters,
      rationale.expectedOutcome,
      rationale.limitations,
    ].join(" ");

    // The rationale is the weakest claim in the product and must read like it.
    expect(findCausalClaims(copy)).toEqual([]);
    expect(copy).not.toMatch(/\d+\s*%/);
  });
});

describe("the three concepts stay separate (§7)", () => {
  it("keeps rationale, product outcome and business measurement in different components", () => {
    // Collapsing them is the standard way products lie: "this change improved
    // your SEO" reads as a measurement and is usually a rationale.
    // Checked against imports rather than prose: the doc comment legitimately
    // explains how the three relate, and a test that failed on the word would
    // be policing comments instead of coupling.
    const imports = source("change-rationale.tsx")
      .split("\n")
      .filter((line) => line.trimStart().startsWith("import"))
      .join("\n");

    // The rationale component takes a rationale and nothing else. It cannot
    // render a verification result or a metric even by mistake.
    expect(imports).toContain("business-rationale");
    expect(imports).not.toContain("outcome-verification");
    expect(imports).not.toContain("business-measurement");
  });

  it("orders them what changed → why → verified", () => {
    const section = source("agent/change-gates.tsx");

    expect(section.indexOf("<ChangeRationale")).toBeLessThan(section.indexOf("<OutcomePanel"));
    expect(section.indexOf("<OutcomePanel")).toBeLessThan(section.indexOf("<BusinessImpactPanel"));
  });
});
