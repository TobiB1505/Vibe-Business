import { describe, expect, it } from "vitest";
import { detectMonorepo } from "./monorepo";
import { contextFrom, packageJson } from "../test-support";

describe("detectMonorepo", () => {
  it("detects pnpm workspaces with apps and packages", () => {
    const result = detectMonorepo(
      contextFrom([
        { path: "pnpm-workspace.yaml" },
        { path: "apps/web/package.json", content: packageJson({ name: "web" }) },
        { path: "apps/api/package.json", content: packageJson({ name: "api" }) },
        { path: "packages/ui/package.json", content: packageJson({ name: "ui" }) },
      ]),
    );

    expect(result.detected).toBe(true);
    expect(result.tool).toBe("pnpm workspaces");
    expect(result.apps).toEqual(["apps/api", "apps/web"]);
    expect(result.packages).toEqual(["packages/ui"]);
    expect(result.ambiguous).toBe(false);
  });

  it("detects npm/yarn workspaces from the package.json field", () => {
    const result = detectMonorepo(
      contextFrom([
        { path: "package.json", content: packageJson({ workspaces: ["apps/*"] }) },
        { path: "apps/web/package.json", content: packageJson({ name: "web" }) },
      ]),
    );

    expect(result.tool).toBe("npm/yarn workspaces");
    expect(result.apps).toEqual(["apps/web"]);
  });

  it("detects Turborepo", () => {
    const result = detectMonorepo(
      contextFrom([{ path: "turbo.json" }, { path: "apps/web/package.json", content: packageJson({}) }]),
    );
    expect(result.tool).toBe("Turborepo");
  });

  it("detects Nx", () => {
    const result = detectMonorepo(
      contextFrom([{ path: "nx.json" }, { path: "apps/web/package.json", content: packageJson({}) }]),
    );
    expect(result.tool).toBe("Nx");
  });

  it("recognises a conventional apps layout without workspace tooling", () => {
    const result = detectMonorepo(
      contextFrom([{ path: "apps/web/package.json", content: packageJson({}) }]),
    );

    expect(result.detected).toBe(true);
    expect(result.tool).toBeNull();
    expect(result.apps).toEqual(["apps/web"]);
  });

  it("records ambiguity when multiple packages exist but no apps directory resolves", () => {
    const result = detectMonorepo(
      contextFrom([
        { path: "pnpm-workspace.yaml" },
        { path: "package.json", content: packageJson({}) },
        { path: "tools/cli/package.json", content: packageJson({}) },
      ]),
    );

    expect(result.detected).toBe(true);
    expect(result.ambiguous).toBe(true);
    expect(result.apps).toEqual([]);
  });

  // Regression: pnpm-workspace.yaml is also used in ordinary
  // single-package repositories just to carry pnpm settings, so its
  // presence alone must not produce a monorepo.
  it("does not report a monorepo for a config file without corroborating structure", () => {
    const result = detectMonorepo(
      contextFrom([
        { path: "pnpm-workspace.yaml" },
        { path: "package.json", content: packageJson({}) },
        { path: "src/app/page.tsx" },
      ]),
    );

    expect(result.detected).toBe(false);
    expect(result.ambiguous).toBe(false);
  });

  it("reports no monorepo for a single-package repository", () => {
    const result = detectMonorepo(
      contextFrom([{ path: "package.json", content: packageJson({}) }, { path: "src/app/page.tsx" }]),
    );

    expect(result.detected).toBe(false);
    expect(result.apps).toEqual([]);
    expect(result.ambiguous).toBe(false);
  });

  it("ignores generated directories when resolving apps", () => {
    const result = detectMonorepo(
      contextFrom([
        { path: "pnpm-workspace.yaml" },
        { path: "apps/web/.next/static/chunk.js" },
        { path: "apps/web/package.json", content: packageJson({}) },
      ]),
    );

    expect(result.apps).toEqual(["apps/web"]);
  });
});
