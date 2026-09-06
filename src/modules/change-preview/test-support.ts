import { FIXTURE_COMMIT_SHA } from "@/modules/validation/test-support";
import type { PreviewTarget } from "./orchestrator";

/**
 * Fixtures for preview tests (Sprint 10B-2 §28–§34; Sprint 0114).
 *
 * The sandbox double itself lives in `validation/test-support.ts` and is
 * shared: preview uses the same `SandboxProvider`, so a second fake would be a
 * second opinion about how the provider behaves, and the two would drift.
 *
 * What used to be here was a *restored filesystem* whose hashes matched a
 * manifest, so an integrity test had to break something rather than arrange for
 * the check to be vacuous. There is no restore and no manifest any more — a
 * preview clones the prepared commit — so what is left is the target itself.
 */

export const PREVIEW_SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** The files a cloned workspace "contains", keyed as the provider lays them out. */
export const CLONED_FILES = {
  "product/app/robots.ts": "export default function robots() { return {}; }\n",
  "product/package.json": JSON.stringify({ name: "product", scripts: { build: "next build" } }),
  "product/pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
} as const;

export function clonedSandboxFiles(
  overrides: Record<string, string | null> = {},
): Record<string, string> {
  const files: Record<string, string> = { ...CLONED_FILES };

  for (const [path, content] of Object.entries(overrides)) {
    if (content === null) delete files[path];
    else files[path] = content;
  }

  return files;
}

export function fakePreviewTarget(overrides: Partial<PreviewTarget> = {}): PreviewTarget {
  return {
    previewSessionId: PREVIEW_SESSION_ID,
    preparedCommitSha: FIXTURE_COMMIT_SHA,
    repositoryUrl: "https://github.com/acme/product.git",
    cloneCredential: { username: "x-access-token", password: "ghs_fixture" },
    packageManager: "pnpm",
    sourceRoot: "product",
    workspaceRoot: ".",
    frameworks: ["nextjs"],
    ...overrides,
  };
}

export { FIXTURE_COMMIT_SHA };
