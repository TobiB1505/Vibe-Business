import { describe, expect, it } from "vitest";
import { selectCandidates } from "./candidates";
import { DEFAULT_ANALYSIS_BUDGETS } from "./budgets";
import type { TreeEntry } from "./reader";

function blob(path: string, size = 100): TreeEntry {
  return { path, type: "blob", size };
}

function discoveredPaths(entries: TreeEntry[], budgets = DEFAULT_ANALYSIS_BUDGETS): string[] {
  return selectCandidates(entries, budgets).discovered.map((candidate) => candidate.path);
}

function fetchPaths(entries: TreeEntry[], budgets = DEFAULT_ANALYSIS_BUDGETS): string[] {
  return selectCandidates(entries, budgets).toFetch.map((candidate) => candidate.path);
}

describe("selectCandidates — discovery", () => {
  it("discovers high-value manifests and configs", () => {
    const discovered = discoveredPaths([
      blob("package.json"),
      blob("next.config.ts"),
      blob("tsconfig.json"),
      blob("README.md"),
      blob("src/app/page.tsx"),
    ]);

    expect(discovered).toEqual(
      expect.arrayContaining(["package.json", "next.config.ts", "tsconfig.json", "README.md"]),
    );
  });

  it("does not discover ordinary source files", () => {
    expect(discoveredPaths([blob("src/app/page.tsx"), blob("src/lib/utils.ts")])).toEqual([]);
  });

  it("never discovers sensitive files", () => {
    expect(
      discoveredPaths([blob(".env"), blob(".env.local"), blob("credentials.json"), blob("certs/key.pem")]),
    ).toEqual([]);
  });

  it("never discovers binary files", () => {
    expect(discoveredPaths([blob("public/logo.png"), blob("fonts/Inter.woff2")])).toEqual([]);
  });

  it("never discovers files inside generated directories", () => {
    expect(
      discoveredPaths([
        blob("node_modules/react/package.json"),
        blob(".next/build-manifest.json"),
        blob("dist/package.json"),
      ]),
    ).toEqual([]);
  });

  it("skips paths deeper than the depth budget", () => {
    const deepPath = `${"a/".repeat(DEFAULT_ANALYSIS_BUDGETS.maxPathDepth + 1)}package.json`;
    expect(discoveredPaths([blob(deepPath)])).toEqual([]);
  });

  it("ignores tree entries, considering only blobs", () => {
    expect(discoveredPaths([{ path: "package.json", type: "tree" }])).toEqual([]);
  });

  it("ranks root manifests ahead of the same filename nested deeper", () => {
    expect(discoveredPaths([blob("apps/web/package.json"), blob("package.json")])[0]).toBe("package.json");
  });

  it("matches config files across supported extensions", () => {
    expect(discoveredPaths([blob("vite.config.js"), blob("astro.config.mjs"), blob("svelte.config.js")])).toEqual(
      expect.arrayContaining(["vite.config.js", "astro.config.mjs", "svelte.config.js"]),
    );
  });

  it("discovers ecosystem manifests beyond JavaScript", () => {
    expect(discoveredPaths([blob("pyproject.toml"), blob("go.mod"), blob("Cargo.toml"), blob("Gemfile")])).toEqual(
      expect.arrayContaining(["pyproject.toml", "go.mod", "Cargo.toml", "Gemfile"]),
    );
  });

  it("discovers known exact paths such as supabase/config.toml", () => {
    expect(discoveredPaths([blob("supabase/config.toml")])).toContain("supabase/config.toml");
  });
});

describe("selectCandidates — fetch selection", () => {
  it("fetches dependency manifests only", () => {
    const toFetch = fetchPaths([
      blob("package.json"),
      blob("next.config.ts"),
      blob("tsconfig.json"),
      blob("README.md"),
      blob("Dockerfile"),
    ]);

    expect(toFetch).toEqual(["package.json"]);
  });

  it("does not fetch existence-only signals even though they are discovered", () => {
    const result = selectCandidates([blob("next.config.ts"), blob("vercel.json")], DEFAULT_ANALYSIS_BUDGETS);

    expect(result.discovered.map((candidate) => candidate.path)).toEqual(
      expect.arrayContaining(["next.config.ts", "vercel.json"]),
    );
    expect(result.toFetch).toEqual([]);
  });

  it("discovers but does not fetch a manifest larger than the per-file byte budget", () => {
    const oversized = blob("package.json", DEFAULT_ANALYSIS_BUDGETS.maxBytesPerFile + 1);
    const result = selectCandidates([oversized], DEFAULT_ANALYSIS_BUDGETS);

    expect(result.discovered.map((candidate) => candidate.path)).toEqual(["package.json"]);
    expect(result.toFetch).toEqual([]);
  });

  it("respects the file-fetch budget and reports truncation", () => {
    const budgets = { ...DEFAULT_ANALYSIS_BUDGETS, maxFileFetches: 2 };
    const result = selectCandidates(
      [
        blob("package.json"),
        blob("apps/web/package.json"),
        blob("apps/api/package.json"),
        blob("packages/ui/package.json"),
      ],
      budgets,
    );

    expect(result.toFetch).toHaveLength(2);
    expect(result.truncatedByBudget).toBe(true);
  });

  it("does not report truncation when everything fits", () => {
    expect(selectCandidates([blob("package.json")], DEFAULT_ANALYSIS_BUDGETS).truncatedByBudget).toBe(false);
  });

  it("prefers the root manifest when the budget forces a choice", () => {
    const budgets = { ...DEFAULT_ANALYSIS_BUDGETS, maxFileFetches: 1 };
    const result = selectCandidates([blob("apps/web/package.json"), blob("package.json")], budgets);

    expect(result.toFetch.map((candidate) => candidate.path)).toEqual(["package.json"]);
  });
});
