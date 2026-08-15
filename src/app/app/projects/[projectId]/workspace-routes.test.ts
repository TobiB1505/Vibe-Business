import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_SECTIONS, projectSectionHref } from "@/components/layout/project-shell";

/**
 * The workspace routes as a set (Sprint UI-2 Part 2).
 *
 * ## Why these are asserted centrally
 *
 * Splitting one page into seven created seven places for a rule to be broken.
 * The per-panel suites still assert what each screen may *offer*; this asserts
 * what every route must *do* — and, more importantly, what none of them may do.
 *
 * Two rules in particular do not survive a split on their own:
 *
 *  1. **Authorization.** An App Router layout does not gate the routes beneath
 *     it; a page renders whether or not its layout would have refused. A route
 *     that forgot its own check is reachable by direct URL, and nothing about
 *     the file tree would look wrong.
 *  2. **Rendering starts nothing.** Sprints 12A and 12B established that
 *     opening a project must never start a verification or a measurement. That
 *     used to be one file to check. It is now seven, and a new route added
 *     later is an eighth that no existing test would notice.
 */

const ROUTE_DIR = join(process.cwd(), "src/app/app/projects/[projectId]");

function layoutSource(): string {
  return readFileSync(join(ROUTE_DIR, "layout.tsx"), "utf8");
}

/** Every `page.tsx` under the project route, including the index. */
function routeFiles(): { name: string; source: string }[] {
  const files = [{ name: "page.tsx", source: readFileSync(join(ROUTE_DIR, "page.tsx"), "utf8") }];

  for (const entry of readdirSync(ROUTE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(ROUTE_DIR, entry.name, "page.tsx");
    if (existsSync(candidate)) {
      files.push({ name: `${entry.name}/page.tsx`, source: readFileSync(candidate, "utf8") });
    }
  }

  return files;
}

describe("every workspace section is reachable", () => {
  it("has a route file for each navigation entry", () => {
    for (const section of PROJECT_SECTIONS) {
      const path = section.segment
        ? join(ROUTE_DIR, section.segment, "page.tsx")
        : join(ROUTE_DIR, "page.tsx");
      expect(existsSync(path), `${section.label} has no route at ${path}`).toBe(true);
    }
  });

  it("builds hrefs that match the route files on disk", () => {
    // A nav entry pointing at a segment that does not exist is a 404 the
    // navigation offers on every page of the workspace.
    for (const section of PROJECT_SECTIONS) {
      const href = projectSectionHref("PROJECT", section.id);
      const segment = href.replace("/app/projects/PROJECT", "").replace(/^\//, "");
      const path = segment ? join(ROUTE_DIR, segment, "page.tsx") : join(ROUTE_DIR, "page.tsx");
      expect(existsSync(path), `${href} has no page`).toBe(true);
    }
  });

  it("keeps Overview at the project's own URL", () => {
    expect(projectSectionHref("abc", "overview")).toBe("/app/projects/abc");
  });

  it("gives every other section a distinct child URL", () => {
    const hrefs = PROJECT_SECTIONS.map((section) => projectSectionHref("abc", section.id));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("every workspace route authorizes itself", () => {
  it("calls the access gate rather than trusting the layout", () => {
    // The layout resolving ownership does not protect these: layout and page
    // render independently in the App Router.
    for (const file of routeFiles()) {
      expect(file.source, `${file.name} does not call requireProjectAccess`).toContain(
        "requireProjectAccess",
      );
    }
  });

  it("never reads a user id from route params or search params", () => {
    // The session is the only acceptable source. A user id taken from the URL
    // is an authorization bypass wearing a parameter's clothes.
    for (const file of routeFiles()) {
      expect(file.source, file.name).not.toMatch(/params\s*:\s*Promise<\{[^}]*userId/);
      expect(file.source, file.name).not.toMatch(/searchParams[^;]*userId/);
    }
  });
});

describe("rendering a workspace route starts nothing", () => {
  /**
   * Functions that spend money, contact a third party, or write. None may be
   * reached from a page render — every one of them belongs behind an explicit
   * user action.
   */
  const FORBIDDEN = [
    "startOutcomeVerification",
    "startBusinessMeasurement",
    "ensureMeasurementPlan",
    "startDeepScan",
    "startValidation",
    "startPreview",
    "startReview",
    "createApproval",
    "startMerge",
    "mergeApprovedChange",
  ];

  it("calls no starter from any route", () => {
    for (const file of routeFiles()) {
      for (const forbidden of FORBIDDEN) {
        expect(file.source, `${file.name} calls ${forbidden}`).not.toContain(`${forbidden}(`);
      }
    }
  });

  it("keeps the service-role client out of every route", () => {
    // It bypasses RLS and is restricted to durable execution (rule 53). A page
    // reaching for it would read across ownership boundaries by construction.
    for (const file of routeFiles()) {
      expect(file.source, file.name).not.toContain("createServiceRoleClient");
      expect(file.source, file.name).not.toContain("supabase-service");
    }
  });
});

describe("routes load only what they render", () => {
  function source(name: string): string {
    return routeFiles().find((file) => file.name === name)?.source ?? "";
  }

  it("does not build the prepared workspace outside the Prepared route", () => {
    // This is the expensive read: signed review-image URLs, preview origins and
    // the GitHub merge preflight. Before the split every section paid it.
    for (const file of routeFiles()) {
      if (file.name === "prepared/page.tsx") continue;
      expect(file.source, `${file.name} builds the prepared workspace`).not.toContain(
        "getPreparedChangeWorkspace(",
      );
    }
  });

  it("uses the cheap summary read where Overview only needs a count", () => {
    expect(source("page.tsx")).toContain("listPreparedChangeSummaries");
    expect(source("page.tsx")).not.toContain("getPreparedChangeWorkspace");
  });

  it("keeps the audit read off routes that do not show a score", () => {
    for (const name of ["activity/page.tsx", "deep-scan/page.tsx", "prepared/page.tsx"]) {
      expect(source(name), name).not.toContain("getLatestSuccessfulAudit");
    }
  });

  it("keeps Activity to its own read", () => {
    const activity = source("activity/page.tsx");
    expect(activity).toContain("listAuditEventsForProject");
    expect(activity).not.toContain("getPreparedChangeWorkspace");
    expect(activity).not.toContain("getProjectImpact");
    expect(activity).not.toContain("getLatestOpportunities");
  });

  it("carries the Deep Scan duration ceiling on the Deep Scan route only", () => {
    // 120s exists for the browser session's own budget. Applying it to every
    // route would make the whole workspace a long-running function.
    expect(source("deep-scan/page.tsx")).toContain("maxDuration");
    for (const file of routeFiles()) {
      if (file.name === "deep-scan/page.tsx") continue;
      expect(file.source, `${file.name} declares maxDuration`).not.toContain("maxDuration");
    }
  });
});

describe("the shared layout stays cheap (UI-2.5 performance contract)", () => {
  const layout = layoutSource();

  /**
   * The layout runs on every one of the seven routes, so anything it loads is
   * multiplied by seven. UI-2 removed the navigation badges rather than put an
   * opportunity read and a prepared read here; UI-2.5 brought them back as
   * count-only queries. This is the boundary that keeps the second from
   * turning back into the first.
   */
  it("loads nothing but project context and counts", () => {
    const FORBIDDEN = [
      "getPreparedChangeWorkspace",
      "listPreparedChangeSummaries",
      "getLatestOpportunities",
      "getLatestSuccessfulAudit",
      "getProjectImpact",
      "getLatestValidation",
      "getPreviewCard",
      "getReviewCard",
      "getReviewImages",
      "getApprovalCard",
      "getMergeCard",
      "getOutcomeCard",
      "getBusinessImpactCard",
      "listAuditEventsForProject",
    ];

    for (const forbidden of FORBIDDEN) {
      expect(layout, `layout calls ${forbidden}`).not.toContain(`${forbidden}(`);
    }
  });

  it("uses the count-only read model for its badges", () => {
    expect(layout).toContain("getProjectWorkspaceCounts");
  });

  it("never signs a review image or asks a provider for anything", () => {
    for (const forbidden of ["createVercelSandboxProvider", "createGithubMergePort", "getPreviewStatus"]) {
      expect(layout, `layout reaches for ${forbidden}`).not.toContain(forbidden);
    }
  });
});
