import { describe, expect, it } from "vitest";
import { detectFrameworks, detectLanguages, detectPackageManager, detectRuntime } from "./stack";
import { contextFrom, packageJson } from "../test-support";

function ids(detections: { id: string }[]): string[] {
  return detections.map((detection) => detection.id);
}

describe("detectLanguages", () => {
  it("detects TypeScript from tsconfig plus source files", () => {
    const context = contextFrom([
      { path: "tsconfig.json" },
      { path: "src/app/page.tsx" },
      { path: "src/lib/utils.ts" },
      { path: "src/lib/other.ts" },
    ]);

    const typescript = detectLanguages(context).find((language) => language.id === "typescript");
    expect(typescript).toBeDefined();
    expect(typescript?.confidence).toBe("high");
    expect(typescript?.evidence.some((item) => item.path === "tsconfig.json")).toBe(true);
  });

  it("detects Python from a manifest", () => {
    const context = contextFrom([{ path: "requirements.txt", content: "fastapi\n" }, { path: "main.py" }]);
    expect(ids(detectLanguages(context))).toContain("python");
  });

  it("does not report a language with no evidence at all", () => {
    const context = contextFrom([{ path: "README.md" }]);
    expect(ids(detectLanguages(context))).toEqual([]);
  });

  it("gives low confidence to a language with only a couple of stray files", () => {
    const context = contextFrom([{ path: "scripts/build.js" }]);
    const javascript = detectLanguages(context).find((language) => language.id === "javascript");
    expect(javascript?.confidence).toBe("low");
  });

  it("ignores files inside generated directories when counting", () => {
    const context = contextFrom([
      { path: "node_modules/react/index.js" },
      { path: ".next/static/chunk.js" },
    ]);
    expect(ids(detectLanguages(context))).toEqual([]);
  });
});

describe("detectFrameworks", () => {
  it("detects Next.js with high confidence from dependency plus config", () => {
    const context = contextFrom([
      { path: "package.json", content: packageJson({ dependencies: { next: "16.3.0", react: "19.2.8" } }) },
      { path: "next.config.ts" },
    ]);

    const next = detectFrameworks(context).find((framework) => framework.id === "nextjs");
    expect(next?.confidence).toBe("high");
    expect(next?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "manifest_dependency", detail: "next" }),
        expect.objectContaining({ kind: "config_file", path: "next.config.ts" }),
      ]),
    );
  });

  it("detects a dependency-only framework with medium confidence", () => {
    const context = contextFrom([
      { path: "package.json", content: packageJson({ dependencies: { react: "19.2.8" } }) },
    ]);

    expect(detectFrameworks(context).find((framework) => framework.id === "react")?.confidence).toBe("medium");
  });

  it("detects Vite + React", () => {
    const context = contextFrom([
      { path: "package.json", content: packageJson({ dependencies: { react: "18" }, devDependencies: { vite: "5" } }) },
      { path: "vite.config.ts" },
    ]);

    expect(ids(detectFrameworks(context))).toEqual(expect.arrayContaining(["vite", "react"]));
  });

  it("detects FastAPI from a Python manifest", () => {
    const context = contextFrom([{ path: "requirements.txt", content: "fastapi==0.111\nuvicorn\n" }]);
    expect(ids(detectFrameworks(context))).toContain("fastapi");
  });

  it("detects Django from pyproject", () => {
    const context = contextFrom([
      { path: "pyproject.toml", content: '[tool.poetry.dependencies]\ndjango = "^5.0"\n' },
    ]);
    expect(ids(detectFrameworks(context))).toContain("django");
  });

  it("detects a mixed frontend/backend repository", () => {
    const context = contextFrom([
      { path: "package.json", content: packageJson({ dependencies: { next: "16" } }) },
      { path: "next.config.ts" },
      { path: "api/requirements.txt", content: "fastapi\n" },
    ]);

    expect(ids(detectFrameworks(context))).toEqual(expect.arrayContaining(["nextjs", "fastapi"]));
  });

  it("returns nothing for an unrecognised repository", () => {
    const context = contextFrom([{ path: "README.md" }, { path: "notes.txt" }]);
    expect(detectFrameworks(context)).toEqual([]);
  });

  it("does not infer a framework from prose alone", () => {
    // A README claiming React, with a package.json that has no React.
    const context = contextFrom([
      { path: "README.md", content: "# Built with React and Next.js" },
      { path: "package.json", content: packageJson({ dependencies: { express: "4" } }) },
    ]);

    const detected = ids(detectFrameworks(context));
    expect(detected).toContain("express");
    expect(detected).not.toContain("react");
    expect(detected).not.toContain("nextjs");
  });
});

describe("detectPackageManager", () => {
  it("prefers the explicit packageManager field", () => {
    const context = contextFrom([
      { path: "package.json", content: packageJson({ packageManager: "pnpm@11.21.0" }) },
      { path: "yarn.lock" },
    ]);
    expect(detectPackageManager(context)).toBe("pnpm");
  });

  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
    ["bun.lockb", "bun"],
  ])("falls back to the %s lockfile", (lockfile, expected) => {
    const context = contextFrom([{ path: "package.json", content: packageJson({}) }, { path: lockfile }]);
    expect(detectPackageManager(context)).toBe(expected);
  });

  it("reports unknown when there is no signal", () => {
    expect(detectPackageManager(contextFrom([{ path: "README.md" }]))).toBe("unknown");
  });
});

describe("detectRuntime", () => {
  it("reports the declared Node engine range", () => {
    const context = contextFrom([
      { path: "package.json", content: packageJson({ engines: { node: ">=20.9.0" } }) },
    ]);

    const node = detectRuntime(context).find((runtime) => runtime.id === "node");
    expect(node?.name).toContain(">=20.9.0");
    expect(node?.confidence).toBe("high");
  });

  it("detects Docker from a Dockerfile", () => {
    const context = contextFrom([{ path: "Dockerfile" }]);
    expect(ids(detectRuntime(context))).toContain("docker");
  });
});
