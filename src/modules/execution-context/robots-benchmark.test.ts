import { describe, expect, it } from "vitest";
import { fakeAgentLimits, fakeAgentSpec } from "@/modules/coding-agent/test-support";
import { compileAgentInstruction } from "@/modules/coding-agent/prompt";
import { fakePlanStep } from "@/modules/execution-contract/test-support";
import { compileExecutionBrief } from "./compiler";
import { renderExecutionBrief } from "./render";
import { fakeBriefSnapshot, fakeRoute } from "./test-support";

/**
 * The benchmark (EXECUTION CONTEXT INTELLIGENCE, PART P).
 *
 * ## What this is
 *
 * One deterministic reconstruction of the task real run #4 will be given — a
 * crawler-indexing step against a repository shaped like the one run #3 worked
 * in — so that "the agent starts from what Vibe knows" is a thing this suite
 * asserts rather than a thing a paid run has to demonstrate.
 *
 * ## What it deliberately does not assert
 *
 * That the agent behaves differently. No test can prove that: it is a property
 * of a model, measured by running one. What is asserted here is everything
 * Vibe controls — that the briefing contains the paths run #3 spent fourteen
 * reads finding, that it stays small, that it is fenced, and that it never
 * becomes an instruction. Whether that changes the run is what the recorded
 * counts in `agent_execution_runs` will answer, against run #3's own numbers.
 */

const ROBOTS_STEP = fakePlanStep({
  title: "Keep search engines out of the signed-in app",
  purpose:
    "Crawlers are indexing dashboard pages, so customer names appear in public search results.",
  completionCriteria:
    "A robots directive exists at the site root and the signed-in area is marked noindex.",
});

/** A repository laid out the way Vibe Business itself is. */
const SNAPSHOT = fakeBriefSnapshot({
  frameworkEvidence: ["package.json"],
  routes: [
    fakeRoute({ path: "/", kind: "layout", sourcePath: "src/app/layout.tsx" }),
    fakeRoute({ path: "/app", kind: "layout", sourcePath: "src/app/app/layout.tsx" }),
    fakeRoute({ path: "/" }),
    fakeRoute({ path: "/pricing" }),
    fakeRoute({ path: "/app/dashboard", sourcePath: "src/app/app/dashboard/page.tsx" }),
    fakeRoute({ path: "/api/github/webhook", kind: "api", sourcePath: "src/app/api/github/webhook/route.ts" }),
  ],
  surfaces: [
    { id: "robots", name: "robots.txt", detected: false },
    {
      id: "seo_metadata",
      name: "SEO metadata",
      detected: true,
      evidencePaths: ["src/app/layout.tsx"],
    },
    {
      id: "dashboard_app",
      name: "Signed-in application",
      detected: true,
      evidencePaths: ["src/app/app/layout.tsx"],
    },
  ],
  topLevelDirectories: ["src", "public", "supabase", "docs", "scripts"],
});

function benchmarkBrief() {
  return compileExecutionBrief({
    spec: fakeAgentSpec({ step: ROBOTS_STEP }),
    snapshot: SNAPSHOT,
    productProfile: null,
    liveOrigin: null,
  });
}

describe("robots benchmark", () => {
  it("names the layouts run #3 spent fourteen file reads finding", () => {
    const paths = benchmarkBrief().fileCandidates.map((candidate) => candidate.path);

    expect(paths).toContain("src/app/layout.tsx");
    expect(paths).toContain("src/app/app/layout.tsx");
  });

  it("tells the agent where a new route file goes without naming one", () => {
    const router = benchmarkBrief().facts.find((fact) => fact.subject === "router");

    expect(router?.value).toContain("src/app");
    // Derived from the observed route sources, never from a robots→path table.
    expect(router?.value).not.toContain("robots");
  });

  it("says the surface does not exist yet, which is the whole job of the step", () => {
    const surface = benchmarkBrief().facts.find(
      (fact) => fact.subject === "business_surface" && fact.value.includes("robots"),
    );

    expect(surface?.value).toContain("not found");
  });

  it("costs a fraction of a single file read to send", () => {
    const rendered = renderExecutionBrief(benchmarkBrief());

    // Run #3 read fourteen files. One `src/app/layout.tsx` alone was 1,333 bytes.
    expect(rendered.bytes).toBeLessThan(2048);
    expect(rendered.candidatesRendered).toBeGreaterThan(0);
  });

  it("reaches the model only inside a labelled untrusted fence", () => {
    const instruction = compileAgentInstruction({
      spec: fakeAgentSpec({ step: ROBOTS_STEP }),
      limits: fakeAgentLimits(),
      availableChecks: ["typecheck", "test"],
      brief: benchmarkBrief(),
    });

    expect(instruction.briefed).toBe(true);
    expect(instruction.userMessage).toContain('<untrusted source="vibe-repository-briefing">');

    // Rule 42: not one character of it may reach the system prompt.
    expect(instruction.system).not.toContain("src/app/layout.tsx");
    expect(instruction.system).not.toContain("Next.js");
  });

  it("changes the instruction from `go and look` to `verify what matters`", () => {
    const spec = fakeAgentSpec({ step: ROBOTS_STEP });
    const limits = fakeAgentLimits();

    const unbriefed = compileAgentInstruction({ spec, limits, availableChecks: ["typecheck"] });
    const briefed = compileAgentInstruction({
      spec,
      limits,
      availableChecks: ["typecheck"],
      brief: benchmarkBrief(),
    });

    expect(unbriefed.system).toContain("Read before you write");
    expect(briefed.system).toContain("Verify what matters");
    expect(briefed.system).toContain("do not re-survey");
  });

  it("falls back to the v1 instruction when the briefing describes a different commit", () => {
    const stale = compileExecutionBrief({
      spec: fakeAgentSpec({ step: ROBOTS_STEP }),
      snapshot: fakeBriefSnapshot({ commitSha: "0".repeat(40) }),
      productProfile: null,
      liveOrigin: null,
    });

    const instruction = compileAgentInstruction({
      spec: fakeAgentSpec({ step: ROBOTS_STEP }),
      limits: fakeAgentLimits(),
      availableChecks: ["typecheck"],
      brief: stale,
    });

    // Spec-pinned facts survive the gate, so the brief is not empty — but it
    // carries nothing that would let an agent skip reading the repository.
    expect(instruction.system).toContain("Read before you write");
    expect(instruction.userMessage).not.toContain("src/app/layout.tsx");
  });
});
