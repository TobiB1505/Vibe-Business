import { describe, expect, it } from "vitest";
import { resolveValidationDepth, stepsForDepth } from "./depth";

/**
 * PART I — what the depth policy would have decided for the runs that exist.
 *
 * ## Why this file is checked in
 *
 * Because "risk-adaptive validation" is a claim about behaviour on real
 * changes, and the only honest way to support it is against changes that
 * actually happened. Every input below was read out of Supabase on 2026-08-20
 * from the rows those runs wrote — `execution_specs.risk_class`,
 * `action_plan_steps.change_kind` / `evidence_ids`, and the path list inside
 * `prepared_changes.files`, which is Vibe's own verified record of what the
 * commit touched. Nothing here is reconstructed from a commit message, an agent
 * explanation, or memory of what the runs were about.
 *
 * No historical record is read or written by this test. The rows are the
 * *source* of the fixtures; the fixtures are then frozen here, so a later
 * schema change cannot silently rewrite what this benchmark claims.
 *
 * ## What it caught
 *
 * Both defects this file exists to prevent were found by running it, not by
 * reading the resolver:
 *
 * 1. `presentational_low_risk` required `riskClass !== "moderate"`, but
 *    `classifyExecutionRisk` only returns `low` for a non-mutating change kind
 *    — already handled one branch earlier. Every real product change is
 *    `moderate` or above, so the branch was unreachable and no run could ever
 *    have been `fast`.
 * 2. Run #8 was `deep` because it changed `e2e/auth.spec.ts` and the auth path
 *    rule matched the filename. A Playwright spec is not an authentication
 *    flow.
 *
 * The distribution below — one of each depth — is the result of fixing those.
 * It is not a target anyone tuned toward.
 */

/** Measured phase durations, from `validation_runs.steps` for these same commits. */
const MEASURED_MS = {
  install: 12_950,
  typecheck: 87_108,
  test: 86_951,
  build: 111_615,
} as const;

type HistoricalRun = {
  label: string;
  commitSha: string;
  riskClass: "low" | "moderate" | "high" | "prohibited";
  changeKind: "product_change";
  evidenceIds: readonly string[];
  changedPaths: readonly string[];
};

/** Run #6 — robots meta directives. Two layouts, nothing else. */
const RUN_6: HistoricalRun = {
  label: "run #6 — robots meta directives",
  commitSha: "c9d1b8d29298e17d1b5b1ed71bdf39806cda5ea8",
  riskClass: "moderate",
  changeKind: "product_change",
  evidenceIds: ["live.seo.robots_meta_missing"],
  changedPaths: ["src/app/app/layout.tsx", "src/app/layout.tsx"],
};

/** Run #7 — canonical URLs. Eight pages, four of which are the auth surface. */
const RUN_7: HistoricalRun = {
  label: "run #7 — canonical URLs on public pages",
  commitSha: "c31cf83a638741eecf73dd364716334d904f1652",
  riskClass: "moderate",
  changeKind: "product_change",
  evidenceIds: ["live.seo.canonical_missing"],
  changedPaths: [
    "src/app/forgot-password/page.tsx",
    "src/app/layout.tsx",
    "src/app/login/page.tsx",
    "src/app/page.tsx",
    "src/app/privacy/page.tsx",
    "src/app/reset-password/page.tsx",
    "src/app/signup/page.tsx",
    "src/app/terms/page.tsx",
  ],
};

/** Run #8 — the benchmark-fixture CTA change, plus the two specs it had to update. */
const RUN_8: HistoricalRun = {
  label: "run #8 — primary landing-page CTA",
  commitSha: "94c31654d05ef592f45ead12b6fbf4bf1890e91d",
  riskClass: "moderate",
  changeKind: "product_change",
  evidenceIds: ["live.conversion.primary_cta"],
  changedPaths: ["e2e/auth.spec.ts", "e2e/first-ten-minutes.spec.ts", "src/app/page.tsx"],
};

function depthOf(run: HistoricalRun) {
  return resolveValidationDepth({
    riskClass: run.riskClass,
    changeKind: run.changeKind,
    evidenceIds: run.evidenceIds,
    changedPaths: run.changedPaths,
  });
}

describe("PART I — historical runs against the depth policy", () => {
  it("run #6 (robots meta) is FAST: cosmetic intent, and two layout files to match", () => {
    // FAST is install + typecheck + build. It skips the unit suite only.
    const result = depthOf(RUN_6);

    expect(result.depth).toBe("fast");
    expect(result.reason).toBe("presentational_low_risk");
    expect(result.escalatedBy).toEqual([]);
    expect(result.steps).toEqual(["install", "typecheck", "build"]);
  });

  it("run #7 (canonical URLs) is DEEP: it edits the login and signup pages", () => {
    const result = depthOf(RUN_7);

    expect(result.depth).toBe("deep");
    expect(result.reason).toBe("sensitive_domain_changed");
    expect(result.escalatedBy).toEqual(["auth"]);
  });

  /**
   * Not a false escalation and not a miss. The change is an SEO metadata edit,
   * but `src/app/login/page.tsx` is the sign-in surface, and a policy that
   * skipped the build on a file rendering that page would be reading the
   * *intent* and ignoring the *artifact* — the exact failure this design is
   * meant to avoid. It costs Run #7 nothing relative to today, because today
   * every run is already validated in full.
   */
  it("run #7 escalates on the path even though every cited signal is presentational", () => {
    expect(depthOf({ ...RUN_7, evidenceIds: [] }).depth).toBe("deep");
  });

  it("run #8 (CTA copy) is STANDARD: the e2e specs it touched must be run, not feared", () => {
    const result = depthOf(RUN_8);

    expect(result.depth).toBe("standard");
    expect(result.reason).toBe("moderate_risk_change");
    // The regression: `e2e/auth.spec.ts` used to read as the auth domain.
    expect(result.escalatedBy).toEqual([]);
  });

  it("run #8 would be FAST without the spec edits — the specs are what withhold it", () => {
    expect(depthOf({ ...RUN_8, changedPaths: ["src/app/page.tsx"] }).depth).toBe("fast");
  });

  it("the three runs do not all land on one depth", () => {
    const depths = [RUN_6, RUN_7, RUN_8].map((run) => depthOf(run).depth);

    expect(new Set(depths).size).toBe(3);
  });
});

describe("PART K — the saving, measured rather than claimed", () => {
  /**
   * `validation_runs.steps` recorded these four durations for these commits.
   * The arithmetic below is therefore a projection built on measured numbers,
   * not a benchmark of the new policy — no depth-selected run has executed yet.
   * The distinction is the point: what is measured is how long each step took,
   * and what is projected is the consequence of not running one of them.
   */
  const fullPhaseMs =
    MEASURED_MS.install + MEASURED_MS.typecheck + MEASURED_MS.test + MEASURED_MS.build;

  it("only run #6 is projected to get shorter; the other two are unchanged", () => {
    const projected = [RUN_6, RUN_7, RUN_8].map((run) =>
      stepsForDepth(depthOf(run).depth).reduce((total, step) => total + MEASURED_MS[step], 0),
    );

    expect(projected[0]).toBeLessThan(fullPhaseMs);
    expect(projected[1]).toBe(fullPhaseMs);
    expect(projected[2]).toBe(fullPhaseMs);
  });

  /**
   * Revised downward after the first dogfood. The original assertion here read
   * 66%, on a `fast` that skipped the build — which turned out to be a step the
   * pass verdict and the preview artifact both depend on. The available saving
   * is the unit suite, and only the unit suite.
   */
  it("run #6's projected saving is exactly the unit suite", () => {
    const projected = stepsForDepth(depthOf(RUN_6).depth).reduce(
      (total, step) => total + MEASURED_MS[step],
      0,
    );

    expect(projected).toBe(fullPhaseMs - MEASURED_MS.test);
    // 211.7s against 298.6s of measured phase time — a 29% reduction on one run
    // of three, which is the whole of the honest claim.
    expect(Math.round((1 - projected / fullPhaseMs) * 100)).toBe(29);
  });
});
