import { describe, expect, it } from "vitest";
import { fakeAgentSpec } from "@/modules/coding-agent/test-support";
import {
  FIXTURE_BASE_SHA,
  FIXTURE_OTHER_SHA,
  fakePlanStep,
} from "@/modules/execution-contract/test-support";
import { compileExecutionBrief, selectSurfaces, taskTerms } from "./compiler";
import { BRIEF_BUDGET, MAX_BRIEF_PATH } from "./brief";
import { fakeBriefSnapshot, fakeRoute } from "./test-support";

/**
 * The Execution Context compiler.
 *
 * Grouped by the property being proven rather than by function, because the
 * properties are what the sprint promised: nothing repository-derived survives a
 * moved commit, nothing is hardcoded, nothing is unbounded, and nothing that
 * arrives from a repository can present itself as an instruction.
 */

/** A step that is unmistakably about crawler indexing, in a founder's words. */
function robotsSpec() {
  return fakeAgentSpec({
    step: fakePlanStep({
      title: "Stop search engines indexing the private dashboard",
      purpose: "Search crawlers are indexing signed-in pages, which leaks customer names.",
      completionCriteria: "A robots directive exists and the dashboard is marked noindex.",
    }),
  });
}

function robotsSnapshot(commitSha = FIXTURE_BASE_SHA) {
  return fakeBriefSnapshot({
    commitSha,
    frameworkEvidence: ["package.json"],
    routes: [
      fakeRoute({ path: "/" }),
      fakeRoute({ path: "/pricing" }),
      fakeRoute({ path: "/dashboard" }),
      fakeRoute({ path: "/", kind: "layout", sourcePath: "src/app/layout.tsx" }),
      fakeRoute({ path: "/dashboard", kind: "layout", sourcePath: "src/app/dashboard/layout.tsx" }),
      fakeRoute({ path: "/api/webhook", kind: "api", sourcePath: "src/app/api/webhook/route.ts" }),
    ],
    surfaces: [
      { id: "robots", name: "robots.txt", detected: false },
      { id: "seo_metadata", name: "SEO metadata", detected: true, evidencePaths: ["src/app/layout.tsx"] },
      { id: "pricing_page", name: "Pricing page", detected: true, evidencePaths: ["src/app/pricing/page.tsx"] },
    ],
    topLevelDirectories: ["src", "public", "supabase", "docs"],
  });
}

function compile(commitSha = FIXTURE_BASE_SHA) {
  return compileExecutionBrief({
    spec: robotsSpec(),
    snapshot: robotsSnapshot(commitSha),
    productProfile: null,
    liveOrigin: "https://acme.example",
  });
}

describe("freshness gate", () => {
  it("presents repository facts only when the snapshot names the pinned commit", () => {
    const brief = compile();

    expect(brief.freshness.state).toBe("fresh");
    expect(brief.facts.some((fact) => fact.source === "repository_scan")).toBe(true);
    expect(brief.fileCandidates.length).toBeGreaterThan(0);
  });

  it("withholds every repository-derived fact and path when the snapshot is a different commit", () => {
    const brief = compile(FIXTURE_OTHER_SHA);

    expect(brief.freshness.state).toBe("stale");
    expect(brief.freshness.snapshotSha).toBe(FIXTURE_OTHER_SHA);
    expect(brief.freshness.executionSha).toBe(FIXTURE_BASE_SHA);

    expect(brief.facts.some((fact) => fact.source === "repository_scan")).toBe(false);
    expect(brief.fileCandidates).toEqual([]);
    expect(brief.likelyIrrelevantAreas).toEqual([]);
  });

  it("still carries what the immutable spec pinned, so a stale brief is never worse than none", () => {
    const brief = compile(FIXTURE_OTHER_SHA);

    expect(brief.facts.map((fact) => fact.subject)).toContain("package_manager");
    expect(brief.facts.every((fact) => fact.evidence.length === 0)).toBe(true);
  });

  it("reports `unknown` rather than `stale` when there is no snapshot at all", () => {
    const brief = compileExecutionBrief({
      spec: robotsSpec(),
      snapshot: null,
      productProfile: null,
      liveOrigin: null,
    });

    expect(brief.freshness.state).toBe("unknown");
    expect(brief.freshness.snapshotSha).toBeNull();
  });
});

describe("selection", () => {
  it("reads the step's own words, never a task name in the code", () => {
    const terms = taskTerms(robotsSpec());

    expect(terms.has("crawlers")).toBe(true);
    expect(terms.has("indexing")).toBe(true);
    // Stopwords are dropped so a selector cannot be dragged around by filler.
    expect(terms.has("the")).toBe(false);
  });

  it("picks the surfaces a step is about and leaves the rest out", () => {
    const selected = selectSurfaces(taskTerms(robotsSpec()));

    expect(selected).toContain("robots");
    expect(selected).not.toContain("payments");
  });

  it("selects a different surface for a different step, with no code change", () => {
    const selected = selectSurfaces(
      taskTerms(
        fakeAgentSpec({
          step: fakePlanStep({
            title: "Publish the pricing page",
            purpose: "Visitors cannot see what a plan costs before signing up.",
            completionCriteria: "Every tier and its price is visible without an account.",
          }),
        }),
      ),
    );

    expect(selected).toContain("pricing_page");
    expect(selected).not.toContain("robots");
  });

  it("states an absent surface as absent, which is the useful fact for a step that creates one", () => {
    const brief = compile();
    const surface = brief.facts.find((fact) => fact.subject === "business_surface");

    expect(surface?.value).toContain("not found");
    expect(surface?.evidence).toEqual([]);
  });
});

describe("file candidates", () => {
  it("derives them from the analyzer's own paths rather than from a table", () => {
    const paths = compile().fileCandidates.map((candidate) => candidate.path);

    // Evidence for a selected, detected surface, and the root layout, which is
    // where a site-wide concern lives in a repository laid out like this one.
    expect(paths).toContain("src/app/layout.tsx");
    // A route whose URL shares a word with the step.
    expect(paths).toContain("src/app/dashboard/page.tsx");
  });

  it("does not offer files for surfaces the step is not about", () => {
    const paths = compile().fileCandidates.map((candidate) => candidate.path);

    expect(paths).not.toContain("src/app/pricing/page.tsx");
  });

  it("names each path once, however many reasons point at it", () => {
    const paths = compile().fileCandidates.map((candidate) => candidate.path);

    expect(new Set(paths).size).toBe(paths.length);
  });

  it("drops an over-long path rather than truncating it into a wrong one", () => {
    const long = `src/app/${"a".repeat(MAX_BRIEF_PATH)}/page.tsx`;
    const brief = compileExecutionBrief({
      spec: robotsSpec(),
      snapshot: fakeBriefSnapshot({
        routes: [fakeRoute({ path: "/dashboard", sourcePath: long })],
        surfaces: [{ id: "robots", name: "robots.txt", detected: false }],
      }),
      productProfile: null,
      liveOrigin: null,
    });

    expect(brief.fileCandidates.every((candidate) => candidate.path.length <= MAX_BRIEF_PATH)).toBe(
      true,
    );
    expect(brief.fileCandidates.some((candidate) => candidate.path.startsWith("src/app/aaa"))).toBe(
      false,
    );
  });

  it("refuses a path that escapes the repository, whatever produced it", () => {
    const brief = compileExecutionBrief({
      spec: robotsSpec(),
      snapshot: fakeBriefSnapshot({
        routes: [fakeRoute({ path: "/dashboard", sourcePath: "../../etc/passwd" })],
        surfaces: [
          { id: "robots", name: "robots.txt", detected: true, evidencePaths: ["/etc/shadow"] },
        ],
      }),
      productProfile: null,
      liveOrigin: null,
    });

    expect(brief.fileCandidates).toEqual([]);
  });
});

describe("bounds", () => {
  it("caps candidates and says how many it left out", () => {
    const routes = Array.from({ length: 40 }, (_, index) =>
      fakeRoute({ path: `/dashboard-${index}` }),
    );

    const brief = compileExecutionBrief({
      spec: robotsSpec(),
      snapshot: fakeBriefSnapshot({
        routes,
        surfaces: [{ id: "robots", name: "robots.txt", detected: false }],
      }),
      productProfile: null,
      liveOrigin: null,
    });

    expect(brief.fileCandidates.length).toBe(BRIEF_BUDGET.maxCandidates);
    expect(brief.truncated.candidatesOmitted).toBe(routes.length - BRIEF_BUDGET.maxCandidates);
  });

  it("bounds every value, so no repository string arrives at full length", () => {
    const brief = compile();

    for (const fact of brief.facts) {
      expect(fact.value.length).toBeLessThanOrEqual(201);
      expect(fact.value).not.toContain("\n");
    }
  });
});

describe("live product", () => {
  it("never claims a deployed origin matches the commit, because nothing records that", () => {
    const brief = compile();

    expect(brief.live.origin).toBe("https://acme.example");
    expect(brief.live.relationToRepository).toBe("unknown");
  });
});

describe("determinism", () => {
  it("compiles byte-identical briefs from identical inputs", () => {
    expect(JSON.stringify(compile())).toBe(JSON.stringify(compile()));
  });
});
