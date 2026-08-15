import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The dashboard's cost contract (Sprint UI-3).
 *
 * `/app` renders every project the user owns. That makes it the one screen
 * where an expensive per-project read turns into an N+1 the moment someone
 * adds a second project — and the failure is invisible with one project, which
 * is how it would ship.
 *
 * These assert the boundary at the source, the same way the workspace routes'
 * contract does. They are cheap, they run everywhere, and they fail on the
 * commit that introduces the problem rather than on the customer who has six
 * projects.
 */

const APP_DIR = join(process.cwd(), "src/app/app");
const MODULES = join(process.cwd(), "src/modules");

function source(path: string): string {
  return readFileSync(path, "utf8");
}

const page = source(join(APP_DIR, "page.tsx"));
const readModel = source(join(MODULES, "projects/dashboard.ts"));
const attention = source(join(MODULES, "projects/attention.ts"));

describe("the dashboard is summary-only", () => {
  /**
   * Every one of these is correct and cheap for a single project, and a
   * disaster in a loop over all of them.
   */
  const FORBIDDEN = [
    "getPreparedChangeWorkspace",
    "getProjectImpact",
    "getProjectWorkspaceCounts",
    "buildDeepScanViewModel",
    "getDeepScanAccessStatus",
    "getPreviewCard",
    "getPreviewStatus",
    "getReviewCard",
    "getReviewImages",
    "getApprovalCard",
    "getMergeCard",
    "resolveMergeTarget",
    "getOutcomeCard",
    "getBusinessImpactCard",
    "getLatestSuccessfulAudit",
    "getLatestOpportunities",
    "buildValidationSummary",
  ];

  it("calls no per-project detail read from the page", () => {
    for (const forbidden of FORBIDDEN) {
      expect(page, `page.tsx calls ${forbidden}`).not.toContain(`${forbidden}(`);
    }
  });

  it("calls no per-project detail read from the read model either", () => {
    // Moving the loop one file down would satisfy the assertion above while
    // changing nothing about the cost.
    for (const forbidden of FORBIDDEN) {
      expect(readModel, `dashboard.ts calls ${forbidden}`).not.toContain(`${forbidden}(`);
    }
  });

  it("never reaches for a provider, a sandbox or GitHub", () => {
    for (const src of [page, readModel]) {
      expect(src).not.toContain("createVercelSandboxProvider");
      expect(src).not.toContain("createGithubMergePort");
      expect(src).not.toContain("checkInstallationStillAccessible");
      expect(src).not.toContain("VercelWorkflowExecutor");
    }
  });

  it("keeps the service-role client out", () => {
    // It bypasses RLS. A dashboard reading across every project is the last
    // place that should hold a key which ignores ownership.
    for (const src of [page, readModel]) {
      expect(src).not.toContain("createServiceRoleClient");
      expect(src).not.toContain("supabase-service");
    }
  });

  it("reads the score from its column, not from the audit document", () => {
    // The stored audit is a large JSONB document with dimensions, evidence and
    // findings. A dashboard needs one integer.
    expect(readModel).toContain("overall_score");
    expect(readModel).not.toContain("result->");
    expect(readModel).not.toContain('select("id, project_id, status, input_hash');
  });
});

describe("the dashboard does not scale its queries with its projects", () => {
  it("filters by a project id list rather than one project at a time", () => {
    expect(readModel).toContain('.in("project_id"');
  });

  it("has no await inside a loop over projects", () => {
    // The N+1 shape, asserted structurally: an `await` inside `for (const
    // … of projects)` is the exact thing this module exists to avoid.
    const loops = readModel.match(/for\s*\(const[^)]*\)\s*\{[\s\S]*?\n  \}/g) ?? [];
    for (const loop of loops) {
      expect(loop, "a loop in dashboard.ts awaits").not.toContain("await ");
    }
  });

  it("bounds the activity read", () => {
    // The rule is that the read is bounded at all, not that the bound is a
    // literal — it is expressed as a multiple of the display limit, which is
    // the more honest way to write it.
    expect(readModel).toMatch(/\.limit\([^)]+\)/);
    expect(readModel).not.toMatch(/from\("audit_events"\)[\s\S]{0,400}?;\s*$/m);
  });

  it("never reads an unbounded event history", () => {
    // An append-only log grows forever. A dashboard query without a ceiling is
    // fine on day one and a full-table scan by month six.
    const activityQuery = readModel.slice(
      readModel.indexOf('from("audit_events")'),
      readModel.indexOf('from("audit_events")') + 500,
    );
    expect(activityQuery).toContain(".limit(");
  });
});

describe("attention is presentation, not a new engine", () => {
  it("is a pure module with no data access at all", () => {
    for (const forbidden of ["supabase", "from(", "await ", "fetch(", "server-only"]) {
      expect(attention, `attention.ts contains ${forbidden}`).not.toContain(forbidden);
    }
  });

  /**
   * Asserted against imports rather than the whole file: the prose in this
   * module legitimately discusses prompts and models when explaining what it
   * deliberately does not do, and a substring match over comments would fail
   * on its own documentation.
   */
  it("imports nothing but its own types", () => {
    const imports = attention.match(/^import[\s\S]*?from\s+"[^"]+";$/gm) ?? [];
    const sources = imports.map((line) => line.match(/from\s+"([^"]+)"/)?.[1] ?? "");

    expect(sources.length).toBeGreaterThan(0);
    for (const from of sources) {
      expect(from, `attention.ts imports ${from}`).toBe("./dashboard");
    }
  });

  it("calls no provider, model or inference helper", () => {
    for (const forbidden of ["generateStructured(", "countInputTokens(", "AIProvider", "anthropic"]) {
      expect(attention, `attention.ts references ${forbidden}`).not.toContain(forbidden);
    }
  });
});
