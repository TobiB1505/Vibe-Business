import { describe, expect, it } from "vitest";
import { resolveStepExecution } from "./resolver";
import { acceptProposedChange } from "./proposed-change";
import { buildExecutionSpec } from "./spec";
import { resolveExecutionValidation } from "./validation-requirements";
import {
  FIXTURE_PLAN,
  fakePlanContext,
  fakePlanStep,
  fakeRepositoryBinding,
  fakeResolveInput,
  fakeSnapshot,
  fakeWriteScope,
} from "./test-support";

/**
 * The PreparedChange bridge (EXECUTION CORE-3 §31, §32).
 *
 * Nothing produces a file set yet. These tests fix the acceptance criteria a
 * future agent's output must meet, so Core-4 inherits them rather than writing
 * them under deadline.
 */

function spec() {
  const step = fakePlanStep();
  const resolution = resolveStepExecution(
    fakeResolveInput({ step, plan: fakePlanContext([step]) }),
  );

  return buildExecutionSpec({
    resolution,
    step,
    plan: { ...FIXTURE_PLAN, assumptions: [...FIXTURE_PLAN.assumptions] },
    projectId: "project-1",
    repository: fakeRepositoryBinding(),
    approvedDecisions: [],
    validation: resolveExecutionValidation(fakeSnapshot()),
    budget: null,
    credit: { quoteId: null, maxAuthorizedCredits: null },
    writeScope: fakeWriteScope(),
    createdAt: "2026-08-18T12:00:00.000Z",
  });
}

describe("proposed change acceptance (§32)", () => {
  it("accepts a bounded change to application source", () => {
    const result = acceptProposedChange(spec(), [
      { path: "src/app/login/page.tsx", content: "export default function Page() {}\n" },
    ]);

    expect(result.accepted).toBe(true);
  });

  it("refuses an empty change", () => {
    const result = acceptProposedChange(spec(), []);

    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.rejections).toEqual(["no_files_produced"]);
  });

  it("refuses a change that writes a CI workflow", () => {
    const result = acceptProposedChange(spec(), [
      { path: "src/app/page.tsx", content: "ok" },
      { path: ".github/workflows/deploy.yml", content: "on: push" },
    ]);

    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.rejections).toContain("forbidden_path");
  });

  it("refuses a change that writes credential material to a legal path (§11)", () => {
    // A path check alone would pass this: `src/config.ts` is ordinary source.
    // Vibe counts, and Vibe reads — the agent's own account of what it wrote is
    // never the authority (§31).
    const result = acceptProposedChange(spec(), [
      {
        path: "src/config.ts",
        content: 'export const key = "sk_live_51HxYzAbCdEfGhIjKlMnO";\n',
      },
    ]);

    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.rejections).toContain("secret_material_introduced");
  });

  it("reports every reason a change was refused rather than the first", () => {
    const result = acceptProposedChange(spec(), [
      { path: ".env.production", content: "STRIPE=sk_live_51HxYzAbCdEfGhIjKlMnO" },
    ]);

    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.rejections).toContain("forbidden_path");
    expect(result.rejections).toContain("secret_material_introduced");
  });

  it("refuses a change larger than the compiled write scope", () => {
    const files = Array.from({ length: 20 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      content: "x",
    }));

    const result = acceptProposedChange(spec(), files);

    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.rejections).toContain("too_many_files");
  });
});
