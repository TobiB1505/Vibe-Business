import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The one start path, as a security boundary
 * (EXECUTION CORE-4 website gate, §7, §8, §14, §25).
 *
 * Mirrors `workspace-routes.test.ts`'s own method: these are claims about
 * *source*, checked once centrally, because "the action forgot its own check"
 * is invisible from the file tree and from every other test that exercises the
 * domain logic underneath it.
 *
 * ## Why this file exists where it does
 *
 * It is what survives of `agent-dogfood/security.test.ts`. That file guarded a
 * surface whose outermost gate was an operator allowlist — two pages that
 * called `notFound()` for any project not named in an environment variable.
 * [ADR 0092](../../../../../../docs/decisions/0092-the-agent-runs-as-the-product.md) deleted the pages and the allowlist, so the assertions about
 * *them* are gone with the thing they described.
 *
 * The assertions kept are the ones that were never about the allowlist: what a
 * browser may put in the start action's parameters, and what the action
 * re-derives for itself. They matter **more** now, not less — this action is
 * reachable by every customer, and the allowlist is no longer standing behind
 * whatever they get wrong.
 */

const ACTIONS_PATH = join(
  process.cwd(),
  "src/app/app/projects/[projectId]/agent/agent-run-actions.ts",
);
const source = readFileSync(ACTIONS_PATH, "utf8");

describe("no brittle identity check (§26)", () => {
  it("contains no hardcoded email or user-id comparison", () => {
    expect(source).not.toMatch(/email\s*===/);
    expect(source).not.toMatch(/userId\s*===\s*["']/);
    // No literal email address — the one shape a hand-rolled founder check
    // would leave behind.
    expect(source).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  });
});

describe("the client cannot supply its own authority (§7, §8)", () => {
  it("gives startAgentRunAction identity plus one boolean of intent, and nothing else", () => {
    /* Comments stripped: this guard is about the parameters a client can fill,
       and prose explaining why is not one of them. */
    const signature = (
      source.match(/export async function startAgentRunAction\(([^)]*)\)/)?.[1] ?? ""
    ).replace(/\/\*[\s\S]*?\*\//g, "");

    expect(signature).toContain("projectId: string");
    expect(signature).toContain("stepKey: string");

    /*
     * `chain: boolean` is intent, not authority, and the difference is the
     * whole point of the type. A boolean says "I pressed the other button"; the
     * server then derives which steps that means from the stored plan, inside
     * the same fresh preflight. A `chainStepKeys: string[]` would be the client
     * deciding what gets built and charged for — so the shape is asserted here
     * rather than left to review.
     */
    expect(signature).toContain("chain: boolean");
    expect(signature).not.toMatch(/chain\s*:\s*(readonly\s*)?string\[\]/);
    expect(signature).not.toContain("steps");

    // No client-suppliable mode, risk, repository, SHA, model, policy or budget.
    for (const forbidden of [
      "mode",
      "risk",
      "repository",
      "baseSha",
      "model",
      "policy",
      "budget",
      "spec",
    ]) {
      expect(signature.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("re-derives the spec fresh inside the start action rather than trusting an earlier preview (§14)", () => {
    expect(source).toContain("previewAgentStep(supabase, {");
    expect(source).toContain("startAgentExecution(supabase,");
  });

  it("scopes runtime founder-input resolution to project and user, then performs fresh admission", () => {
    expect(source).toContain("getFounderInputRequest(supabase, requestId)");
    expect(source).toContain("request.projectId !== projectId");
    expect(source).toContain('request.origin !== "execution_blocker"');
    expect(source).toContain("resolveFounderInput({");
    expect(source).toContain("projectId,");
    expect(source).toContain("userId: session.userId,");
    expect(source).toContain("previewAgentStep(supabase, {");
    expect(source).toContain("persistAgentExecutionSpec({");
    expect(source).toContain("startAgentExecution(supabase,");
    expect(source).not.toContain("requeueAnsweredOperation");
  });
});

describe("no service-role client reaches this surface", () => {
  it("takes the caller's own session-scoped client", () => {
    expect(source).not.toContain("createServiceRoleClient");
    expect(source).not.toContain("supabase-service");
    expect(source).toContain("requireSession");
  });
});
