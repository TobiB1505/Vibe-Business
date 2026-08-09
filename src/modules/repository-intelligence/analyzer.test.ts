import { describe, expect, it } from "vitest";
import { analyzeRepository } from "./analyzer";
import { DEFAULT_ANALYSIS_BUDGETS } from "./budgets";
import { ANALYZER_VERSION, REPOSITORY_INTELLIGENCE_SCHEMA_VERSION } from "./schema";
import { FakeRepositoryReader, packageJson, type FixtureFile } from "./test-support";

const REPOSITORY = { fullName: "octocat/demo", defaultBranch: "main", private: false };

function nextAppFixture(): FixtureFile[] {
  return [
    {
      path: "package.json",
      content: packageJson({
        name: "demo",
        private: true,
        dependencies: { next: "16.3.0", react: "19.2.8", "@supabase/supabase-js": "2", stripe: "16" },
        devDependencies: { typescript: "^5" },
        engines: { node: ">=20.9.0" },
        packageManager: "pnpm@11.21.0",
      }),
    },
    { path: "next.config.ts" },
    { path: "tsconfig.json" },
    { path: "vercel.json" },
    { path: "src/app/page.tsx" },
    { path: "src/app/pricing/page.tsx" },
    { path: "src/app/api/webhook/route.ts" },
    { path: "src/lib/utils.ts" },
  ];
}

async function analyze(files: FixtureFile[], options?: Parameters<typeof analyzeRepository>[1]) {
  const reader = new FakeRepositoryReader({ files });
  const result = await analyzeRepository({ reader, repository: REPOSITORY }, options);
  return { ...result, reader };
}

describe("analyzeRepository", () => {
  it("produces a versioned snapshot tied to the head commit", async () => {
    const { snapshot, commitSha } = await analyze(nextAppFixture());

    expect(snapshot.schemaVersion).toBe(REPOSITORY_INTELLIGENCE_SCHEMA_VERSION);
    expect(snapshot.source.analyzerVersion).toBe(ANALYZER_VERSION);
    expect(snapshot.source.commitSha).toBe(commitSha);
    expect(snapshot.source.branch).toBe("main");
    expect(snapshot.source.treeComplete).toBe(true);
  });

  it("detects the full stack of a typical Next.js app", async () => {
    const { snapshot } = await analyze(nextAppFixture());

    expect(snapshot.frameworks.map((framework) => framework.id)).toEqual(
      expect.arrayContaining(["nextjs", "react"]),
    );
    expect(snapshot.languages.map((language) => language.id)).toContain("typescript");
    expect(snapshot.packageManager).toBe("pnpm");
    expect(snapshot.integrationSignals.map((signal) => signal.id)).toEqual(
      expect.arrayContaining(["supabase", "stripe", "vercel"]),
    );
    expect(snapshot.routes.mode).toBe("app_router");
    expect(snapshot.routes.routes.map((route) => route.path)).toEqual(
      expect.arrayContaining(["/", "/pricing", "/api/webhook"]),
    );
  });

  it("reports complete when nothing was truncated", async () => {
    const { snapshot } = await analyze(nextAppFixture());
    expect(snapshot.completeness.status).toBe("complete");
    expect(snapshot.completeness.reasons).toEqual([]);
  });

  it("only downloads dependency manifests, never configs or source", async () => {
    const { reader } = await analyze(nextAppFixture());
    expect(reader.fetchedPaths).toEqual(["package.json"]);
  });

  it("records metrics for cost observability", async () => {
    const { snapshot } = await analyze(nextAppFixture());

    expect(snapshot.metrics.filesFetched).toBe(1);
    expect(snapshot.metrics.bytesFetched).toBeGreaterThan(0);
    expect(snapshot.metrics.treeEntriesConsidered).toBeGreaterThan(0);
    expect(snapshot.metrics.candidatesSelected).toBeGreaterThan(0);
  });

  it("never fetches sensitive files even when present", async () => {
    const files = [
      ...nextAppFixture(),
      { path: ".env", content: "SECRET=super-secret-value" },
      { path: ".env.local", content: "SECRET=another" },
      { path: "credentials.json", content: '{"key":"secret"}' },
    ];

    const { reader, snapshot } = await analyze(files);

    expect(reader.fetchedPaths).not.toContain(".env");
    expect(reader.fetchedPaths).not.toContain(".env.local");
    expect(reader.fetchedPaths).not.toContain("credentials.json");
    expect(JSON.stringify(snapshot)).not.toContain("super-secret-value");
  });

  it("never persists raw file content in the snapshot", async () => {
    const { snapshot } = await analyze(nextAppFixture());
    const serialized = JSON.stringify(snapshot);

    // The package.json was fetched and parsed, but neither its body nor
    // any dependency version range should survive into the snapshot.
    expect(serialized).not.toContain('"dependencies":{');
    expect(serialized).not.toContain("16.3.0");
    expect(serialized).not.toContain("19.2.8");
  });

  it("marks the snapshot partial and records a reason for a truncated tree", async () => {
    const reader = new FakeRepositoryReader({ files: nextAppFixture(), truncated: true });
    const { snapshot } = await analyzeRepository({ reader, repository: REPOSITORY });

    expect(snapshot.source.treeComplete).toBe(false);
    expect(snapshot.completeness.status).toBe("partial");
    expect(snapshot.completeness.reasons).toContain("tree_truncated");
  });

  it("still detects the stack despite a truncated tree", async () => {
    const reader = new FakeRepositoryReader({ files: nextAppFixture(), truncated: true });
    const { snapshot } = await analyzeRepository({ reader, repository: REPOSITORY });

    expect(snapshot.frameworks.map((framework) => framework.id)).toContain("nextjs");
  });

  it("records file_budget_reached when more manifests exist than the budget allows", async () => {
    const files: FixtureFile[] = [
      { path: "package.json", content: packageJson({ dependencies: { next: "16" } }) },
      { path: "apps/web/package.json", content: packageJson({}) },
      { path: "apps/api/package.json", content: packageJson({}) },
    ];

    const { snapshot } = await analyze(files, {
      budgets: { ...DEFAULT_ANALYSIS_BUDGETS, maxFileFetches: 1 },
    });

    expect(snapshot.completeness.status).toBe("partial");
    expect(snapshot.completeness.reasons).toContain("file_budget_reached");
  });

  it("records tree_entry_budget_reached for an oversized tree", async () => {
    const files: FixtureFile[] = Array.from({ length: 30 }, (_, index) => ({
      path: `src/module-${index}/index.ts`,
    }));

    const { snapshot } = await analyze(files, {
      budgets: { ...DEFAULT_ANALYSIS_BUDGETS, maxTreeEntries: 10 },
    });

    expect(snapshot.completeness.reasons).toContain("tree_entry_budget_reached");
  });

  it("stops fetching once the byte budget is exhausted", async () => {
    const large = packageJson({ dependencies: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`dep-${i}`, "1.0.0"])) });
    const files: FixtureFile[] = [
      { path: "package.json", content: large },
      { path: "apps/web/package.json", content: large },
      { path: "apps/api/package.json", content: large },
    ];

    const { snapshot, reader } = await analyze(files, {
      budgets: { ...DEFAULT_ANALYSIS_BUDGETS, maxTotalBytes: Buffer.byteLength(large, "utf8") },
    });

    expect(reader.fetchedPaths.length).toBeLessThan(3);
    expect(snapshot.completeness.reasons).toContain("byte_budget_reached");
  });

  it("handles an empty repository without throwing", async () => {
    const { snapshot } = await analyze([]);

    expect(snapshot.frameworks).toEqual([]);
    expect(snapshot.languages).toEqual([]);
    expect(snapshot.routes.mode).toBe("none");
    expect(snapshot.projectStructure.sourceFileCount).toBe(0);
  });

  it("warns instead of failing when a manifest cannot be parsed", async () => {
    const { snapshot } = await analyze([{ path: "package.json", content: "{ not valid json" }]);

    expect(snapshot.warnings.map((warning) => warning.code)).toContain("manifest_unparseable");
    expect(snapshot.packageManager).toBe("unknown");
  });

  it("detects a monorepo and its apps", async () => {
    const { snapshot } = await analyze([
      { path: "pnpm-workspace.yaml" },
      { path: "package.json", content: packageJson({ workspaces: ["apps/*"] }) },
      { path: "apps/web/package.json", content: packageJson({ dependencies: { next: "16" } }) },
      { path: "apps/api/package.json", content: packageJson({ dependencies: { express: "4" } }) },
    ]);

    expect(snapshot.projectStructure.monorepo.detected).toBe(true);
    expect(snapshot.projectStructure.monorepo.apps).toEqual(["apps/api", "apps/web"]);
  });

  it("excludes generated output from the source file count", async () => {
    const { snapshot } = await analyze([
      { path: "src/app/page.tsx" },
      { path: "node_modules/react/index.js" },
      { path: ".next/static/chunk.js" },
    ]);

    expect(snapshot.projectStructure.sourceFileCount).toBe(1);
  });

  it("gives every claimed detection supporting evidence", async () => {
    const { snapshot } = await analyze(nextAppFixture());

    for (const detection of [...snapshot.frameworks, ...snapshot.integrationSignals]) {
      expect(detection.evidence.length).toBeGreaterThan(0);
      for (const item of detection.evidence) {
        expect(item.path.length).toBeGreaterThan(0);
      }
    }
  });
});
