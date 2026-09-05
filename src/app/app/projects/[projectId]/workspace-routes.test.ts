import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROJECT_SECTIONS,
  WORKSPACE_SECTION_HEADINGS,
  projectSectionHref,
} from "@/components/layout/project-shell";

/**
 * The workspace routes as a set (Sprint UI-2 Part 2; renamed by CORE-5).
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
 *     used to be one file to check. It is now nine, and a new route added later
 *     is a tenth that no existing test would notice.
 */

const ROUTE_DIR = join(process.cwd(), "src/app/app/projects/[projectId]");

function layoutSource(): string {
  return readFileSync(join(ROUTE_DIR, "layout.tsx"), "utf8");
}

/**
 * Every `page.tsx` under the project route, at any depth, including the index.
 *
 * ## Why this recurses
 *
 * It used to walk exactly one directory level, which was true of the route tree
 * when it was written and stopped being true twice over. The route that proved
 * it — `agent-dogfood/[stepKey]` — has since been deleted (ADR 0092), and the
 * recursion stays because a nested route is not a special case; it is the shape
 * a route tree takes as soon as one section owns a child.
 *
 * The failure mode this closes is the quiet one: a route that is *not* walked
 * passes every rule in this file, because a rule applied to a list that does
 * not contain the file cannot fail. `name` is the path relative to the route
 * directory, so the lookups further down address a nested route the same way
 * they address a top-level one.
 */
function routeFiles(directory: string = ROUTE_DIR, prefix = ""): { name: string; source: string }[] {
  const files: { name: string; source: string }[] = [];

  const page = join(directory, "page.tsx");
  if (existsSync(page)) {
    files.push({ name: `${prefix}page.tsx`, source: readFileSync(page, "utf8") });
  }

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    files.push(...routeFiles(join(directory, entry.name), `${prefix}${entry.name}/`));
  }

  return files;
}

describe("the walk itself", () => {
  /**
   * A rule applied to a list is only as good as the list. Every assertion below
   * iterates `routeFiles()`, so a walk that silently returned three files would
   * make this whole suite pass while checking almost nothing — the same failure
   * UI-6 found in four action-allowlist tests and closed by making the
   * extractor throw rather than return empty.
   */
  it("finds the index, and finds nested routes", () => {
    const names = routeFiles().map((file) => file.name);

    expect(names).toContain("page.tsx");
    // Recursion, asserted without naming one route: a single-level walk would
    // find no path with a separator in it.
    expect(names.some((name) => name.includes("/"))).toBe(true);
    expect(names.length).toBeGreaterThanOrEqual(PROJECT_SECTIONS.length);
  });
});

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

  it("keeps Home at the project's own URL", () => {
    expect(projectSectionHref("abc", "home")).toBe("/app/projects/abc");
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

  it("does not build the prepared workspace outside the Agent route", () => {
    // This is the expensive read: signed review-image URLs, preview origins and
    // the GitHub merge preflight. Before the split every section paid it.
    for (const file of routeFiles()) {
      if (file.name === "agent/page.tsx") continue;
      expect(file.source, `${file.name} builds the prepared workspace`).not.toContain(
        "getPreparedChangeWorkspace(",
      );
    }
  });

  /**
   * The Agent route's slow half is behind a `<Suspense>` boundary (VB-023).
   *
   * ## Why the check is on the *body*, not on the file
   *
   * Because a page that imports `Suspense`, renders a boundary, and still
   * awaits the workspace read before its `return` streams nothing at all — and
   * that page looks completely correct from a distance. What matters is which
   * side of the render the expensive read sits on, so that is what is read
   * here: everything before the component returns.
   *
   * The boundary's actual streaming behaviour is observed in a browser, in
   * `e2e/agent-streaming.spec.ts`. This is the half that browser cannot reach,
   * because the real route needs a session the browser suite does not have.
   */
  it("does not await the prepared workspace before the Agent route renders", () => {
    const agent = source("agent/page.tsx");

    const body = agent.slice(
      agent.indexOf("export default async function ProjectAgentPage"),
      agent.indexOf("  return (", agent.indexOf("export default async function ProjectAgentPage")),
    );

    expect(body).not.toBe("");
    expect(body, "the Agent page awaits the workspace read before rendering").not.toContain(
      "getPreparedChangeWorkspace",
    );
    expect(agent, "the Agent page has no Suspense boundary").toContain("<Suspense");
  });

  /*
   * Home was the Business Health read model until ADR 0085 made the index
   * Nova. The invariant the old assertion was protecting still holds and is
   * what is checked here: Home renders one composed read and does not pull the
   * prepared-change workspace, which is the Agent's and is expensive.
   */
  it("keeps Home on the single Nova read", () => {
    expect(source("page.tsx")).toContain("NovaHome");
    expect(source("page.tsx")).not.toContain("ProjectBusinessHealth");
    expect(source("page.tsx")).not.toContain("listPreparedChangeSummaries");
    expect(source("page.tsx")).not.toContain("getPreparedChangeWorkspace");
  });

  it("keeps Home's reads to what Home draws", () => {
    // Not a route file, so it is read directly: this is the module the index
    // delegates its whole read to, and the bounds belong to it.
    const nova = readFileSync(join(ROUTE_DIR, "nova/nova-home-data.ts"), "utf8");

    // Calls rather than mentions: the module names the reads it deliberately
    // does not make, and a substring check would match its own reasoning.
    expect(nova).toContain("getHeaderCreditBalance(");

    // The overview repairs on read and belongs on Billing alone.
    expect(nova).not.toContain("getBillingOverview(");

    // Home shows a score, not a chart. Sixty readings would be rows fetched to
    // be thrown away on the most-visited route in the product.
    expect(nova).not.toContain("getProjectAuditReadings(");

    // The prepared-change workspace is the Agent's expensive read.
    expect(nova).not.toContain("getPreparedChangeWorkspace(");
  });

  it("keeps the audit read off routes that do not show a score", () => {
    for (const name of [
      "settings/activity/page.tsx",
      "product/deep-scan/page.tsx",
      "agent/page.tsx",
    ]) {
      expect(source(name), name).not.toContain("getLatestSuccessfulAudit");
    }
  });

  it("keeps Activity to its own read", () => {
    const activity = source("settings/activity/page.tsx");
    expect(activity).toContain("listAuditEventsForProject");
    expect(activity).not.toContain("getPreparedChangeWorkspace");
    expect(activity).not.toContain("getProjectImpact");
    expect(activity).not.toContain("getLatestOpportunities");
  });

  it("carries the Deep Scan duration ceiling on the Deep Scan route only", () => {
    // 120s exists for the browser session's own budget. Applying it to every
    // route would make the whole workspace a long-running function.
    expect(source("product/deep-scan/page.tsx")).toContain("maxDuration");
    for (const file of routeFiles()) {
      if (file.name === "product/deep-scan/page.tsx") continue;
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

/**
 * A section and the skeleton standing in for it say the same thing (PERF-015).
 *
 * The founder sees the skeleton first and the page second, so a disagreement
 * between them is a visible copy swap at the moment their screen arrives.
 * Three had drifted before the heading moved into one registry.
 *
 * The rule is not "the strings match" — that check passes for as long as
 * somebody remembers to update both files. It is that neither file is allowed
 * to carry the string at all.
 */
describe("workspace headings", () => {
  function workspaceFiles(): { name: string; source: string }[] {
    const files: { name: string; source: string }[] = [];

    const walk = (directory: string, prefix: string) => {
      for (const leaf of ["page.tsx", "loading.tsx", "content.tsx"]) {
        const path = join(directory, leaf);
        if (existsSync(path)) {
          files.push({ name: `${prefix}${leaf}`, source: readFileSync(path, "utf8") });
        }
      }
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(directory, entry.name), `${prefix}${entry.name}/`);
      }
    };

    walk(ROUTE_DIR, "");
    return files;
  }

  it("takes the title and description from the id, never from a prop", () => {
    const offenders = workspaceFiles()
      .filter((file) => file.source.includes("<WorkspaceSection"))
      .filter((file) => /<WorkspaceSection\b[^>]*?\b(title|description)=/.test(file.source))
      .map((file) => file.name);

    expect(
      offenders,
      "a heading passed as a prop is a heading two files can spell differently",
    ).toEqual([]);
  });

  it("renders a heading the registry knows", () => {
    const ids = new Set(Object.keys(WORKSPACE_SECTION_HEADINGS));

    for (const file of workspaceFiles()) {
      for (const [, id] of file.source.matchAll(/<WorkspaceSection\s+id="([^"]+)"/g)) {
        expect(ids.has(id), `${file.name} renders an unknown section id: ${id}`).toBe(true);
      }
    }
  });

  it("gives every section a title and a description", () => {
    for (const [id, heading] of Object.entries(WORKSPACE_SECTION_HEADINGS)) {
      expect(heading.title.length, id).toBeGreaterThan(0);
      expect(heading.description.length, id).toBeGreaterThan(20);
    }
  });
});
