import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkedValues } from "@/modules/operations/migration-test-support";
import { LIVE_SITE_STATUSES, ONBOARDING_STATES } from "./state";

const ROOT = process.cwd();
const ONBOARDING_APP = join(ROOT, "src/app/app/onboarding");
const MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/20260817090000_project_onboarding.sql"),
  "utf8",
);
const ACTIONS = readFileSync(join(ONBOARDING_APP, "[projectId]/actions.ts"), "utf8");
const PAGE = readFileSync(join(ONBOARDING_APP, "[projectId]/page.tsx"), "utf8");
const APP_HOME = readFileSync(join(ROOT, "src/app/app/page.tsx"), "utf8");
const ONBOARDING_SHELL = readFileSync(
  join(ONBOARDING_APP, "onboarding-shell.tsx"),
  "utf8",
);
const PROJECT_ONBOARDING_PAGE = readFileSync(
  join(ONBOARDING_APP, "[projectId]/page.tsx"),
  "utf8",
);
const REPOSITORY_ACTION = readFileSync(
  join(ROOT, "src/app/app/connect/github/repositories/actions.ts"),
  "utf8",
);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.match(/\.tsx?$/) ? [path] : [];
  });
}

describe("project onboarding persistence", () => {
  it("keeps the TypeScript lifecycle aligned with the database checks", () => {
    expect(checkedValues("project_onboarding", "state").sort()).toEqual(
      [...ONBOARDING_STATES].sort(),
    );
    expect(checkedValues("project_onboarding", "live_site_status").sort()).toEqual(
      [...LIVE_SITE_STATUSES].sort(),
    );
  });

  it("is project scoped, RLS protected and backfills mature projects", () => {
    expect(MIGRATION).toContain("project_id uuid primary key");
    expect(MIGRATION).toContain("enable row level security");
    expect(MIGRATION).toContain('policy "select own project_onboarding"');
    expect(MIGRATION).toContain("business_readiness_audits");
    expect(MIGRATION).toContain("'complete'");
    expect(MIGRATION).not.toContain("users.onboarding");
  });

  it("uses no browser storage as lifecycle authority", () => {
    for (const file of sourceFiles(ONBOARDING_APP)) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("localStorage");
      expect(source, file).not.toContain("sessionStorage");
    }
  });
});

describe("onboarding orchestrates canonical domains", () => {
  it("routes first login, resume and repository selection into onboarding", () => {
    expect(APP_HOME).toContain('projects.length === 0) redirect("/app/onboarding")');
    expect(APP_HOME).toContain("getOnboardingRouting");
    expect(REPOSITORY_ACTION).toContain("createProjectOnboarding");
    expect(REPOSITORY_ACTION).toContain("/app/onboarding/${result.projectId}");
  });

  /**
   * The flow may take over, and then it must let go.
   *
   * Found by dogfooding: the redirect fired on any unfinished project, so a
   * founder with working projects who started a second one could never reach
   * the workspace again — and the shell's own link to `/app` bounced straight
   * back, which made the exit look present and be a loop.
   *
   * Asserted here rather than only in `routing.test.ts` because the defect was
   * never in the query. It was in the route deciding to redirect on it.
   */
  it("stops redirecting into onboarding once any project has finished setup", () => {
    expect(APP_HOME).toContain("!routing.hasCompleted");
    expect(APP_HOME).toContain("routing.hasCompleted ? routing.resumableProjectId : null");
    expect(APP_HOME).toContain("Continue setup");
  });

  it("offers a way out of the shell exactly when leaving leads somewhere", () => {
    expect(ONBOARDING_SHELL).toContain("canLeave");
    expect(ONBOARDING_SHELL).toContain("Back to your projects");
    expect(PROJECT_ONBOARDING_PAGE).toContain("hasCompletedAnyOnboarding");
  });

  it("reuses source, Product Profile, Audit and Opportunity services", () => {
    for (const contract of [
      "inspectRepository(",
      "inspectLiveProduct(",
      "startProductUnderstandingOperation(",
      "confirmProfile(",
      "startBusinessAuditOperation(",
      "startOpportunityOperation(",
    ]) {
      expect(ACTIONS).toContain(contract);
    }
    expect(ACTIONS).not.toContain("generateStructured(");
    expect(ACTIONS).not.toContain("onboarding_product_description");
    expect(ACTIONS).not.toContain("onboarding_business_context");
  });

  it("guards completion with reconciled server state", () => {
    const completion = ACTIONS.slice(ACTIONS.indexOf("completeOnboardingAction"));
    expect(completion).toContain("getProjectOnboarding");
    expect(completion).toContain('onboarding.state !== "first_move"');
    expect(completion).toContain("onboarding.firstMoveViewedAt === null");
  });

  it("renders only real opportunity data and an honest no-move fallback", () => {
    expect(PAGE).toContain("onboarding.opportunities?.set.opportunities[0]");
    expect(PAGE).toContain("No actual Next Move is available yet");
    expect(PAGE).not.toContain("moves prepared");
    expect(PAGE).not.toContain("Apply change");
  });
});
