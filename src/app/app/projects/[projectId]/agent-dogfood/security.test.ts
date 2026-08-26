import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Core-4 website surface as a security boundary
 * (EXECUTION CORE-4 website gate, §7, §8, §14, §25, §26, §27).
 *
 * Mirrors `workspace-routes.test.ts`'s own method: these are claims about
 * *source*, checked once centrally, because "the route forgot its own check"
 * is invisible from the file tree and from every other test that exercises
 * the domain logic underneath it.
 */

const ROUTE_DIR = join(process.cwd(), "src/app/app/projects/[projectId]/agent-dogfood");

function read(relativePath: string): string {
  return readFileSync(join(ROUTE_DIR, relativePath), "utf8");
}

describe("both pages gate on the real allowlist before rendering anything (§26, §27)", () => {
  /**
   * Two spellings are accepted, and only two.
   *
   * `isDogfoodEligibleProject` is the gate itself. `resolveDogfoodPlanRoutes`
   * is the index page's single server call, and its **first statement** is that
   * same gate — asserted below rather than assumed, and exercised behaviourally
   * in `website-preflight.test.ts`. Allowing the second name is what let the
   * index page stop resolving the plan inline; allowing anything else would
   * turn this test into a formality.
   */
  const ACCEPTED_GATES = ["isDogfoodEligibleProject", "resolveDogfoodPlanRoutes"];

  it("calls requireProjectAccess and reaches the dogfood eligibility check", () => {
    for (const file of ["page.tsx", "[stepKey]/page.tsx"]) {
      const source = read(file);
      expect(source, `${file} does not call requireProjectAccess`).toContain("requireProjectAccess");
      expect(
        ACCEPTED_GATES.some((gate) => source.includes(gate)),
        `${file} reaches no known allowlist gate`,
      ).toBe(true);
      expect(source, `${file} does not 404 an ineligible project`).toContain("notFound()");
    }
  });

  it("the index page's server call gates before it reads anything", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/coding-agent/website-preflight.ts"),
      "utf8",
    );
    const body = source.slice(source.indexOf("export async function resolveDogfoodPlanRoutes("));

    // The allowlist check appears before the first database read in the body.
    const gateAt = body.indexOf("isDogfoodEligibleProject");
    const firstReadAt = body.indexOf("await");
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(firstReadAt);
  });
});

describe("no brittle identity check (§26)", () => {
  it("contains no hardcoded email or user-id comparison anywhere in the surface", () => {
    for (const file of [
      "page.tsx",
      "[stepKey]/page.tsx",
      "[stepKey]/actions.ts",
      "[stepKey]/run-panel.tsx",
      "[stepKey]/status-view.tsx",
    ]) {
      const source = read(file);
      expect(source).not.toMatch(/email\s*===/);
      expect(source).not.toMatch(/userId\s*===\s*["']/);
      // No literal email address anywhere in the surface — the one shape a
      // hand-rolled founder check would leave behind.
      expect(source).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    }
  });
});

describe("the client cannot supply its own authority (§7, §8)", () => {
  it("gives startDogfoodRunAction no parameter beyond project and step identity", () => {
    const source = read("[stepKey]/actions.ts");
    const signature = source.match(/export async function startDogfoodRunAction\(([^)]*)\)/)?.[1] ?? "";

    expect(signature).toContain("projectId: string");
    expect(signature).toContain("stepKey: string");
    // No client-suppliable mode, risk, repository, SHA, model, policy or budget.
    for (const forbidden of ["mode", "risk", "repository", "baseSha", "model", "policy", "budget", "spec"]) {
      expect(signature.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("re-derives the spec fresh inside the start action rather than trusting an earlier preview (§14)", () => {
    const source = read("[stepKey]/actions.ts");
    expect(source).toContain("previewDogfoodStep(supabase, {");
    expect(source).toContain("startAgentExecution(supabase,");
  });

  it("scopes runtime founder-input resolution to project and user, then performs fresh admission", () => {
    const source = read("[stepKey]/actions.ts");
    expect(source).toContain("getFounderInputRequest(supabase, requestId)");
    expect(source).toContain("request.projectId !== projectId");
    expect(source).toContain('request.origin !== "execution_blocker"');
    expect(source).toContain("resolveFounderInput({");
    expect(source).toContain("projectId,");
    expect(source).toContain("userId: session.userId,");
    expect(source).toContain("previewDogfoodStep(supabase, {");
    expect(source).toContain("persistAgentExecutionSpec({");
    expect(source).toContain("startAgentExecution(supabase,");
    expect(source).not.toContain("requeueAnsweredOperation");
  });
});

describe("no service-role client and no forbidden starter reaches this surface", () => {
  it("keeps the service-role client out of every file", () => {
    for (const file of [
      "page.tsx",
      "[stepKey]/page.tsx",
      "[stepKey]/actions.ts",
      "[stepKey]/run-panel.tsx",
      "[stepKey]/status-view.tsx",
    ]) {
      const source = read(file);
      expect(source).not.toContain("createServiceRoleClient");
      expect(source).not.toContain("supabase-service");
    }
  });
});

describe("no raw internal enum reaches JSX directly (mirrors action-plan-panel.tsx's own rule)", () => {
  it("routes execution mode, risk, reason and refusal codes through a view/label map", () => {
    for (const file of ["page.tsx", "[stepKey]/page.tsx"]) {
      const source = read(file);
      // Every place a resolver/preflight enum is interpolated must be indexed
      // through one of these label records, never printed bare.
      if (source.includes("resolution.mode")) {
        expect(source).toMatch(/EXECUTION_MODE_LABELS\[/);
      }
      if (source.includes("resolution.riskClass")) {
        expect(source).toMatch(/EXECUTION_RISK_LABELS\[/);
      }
      if (source.includes("resolution.reason")) {
        expect(source).toMatch(/EXECUTION_REASON_LABELS\[/);
      }
    }
  });
});
