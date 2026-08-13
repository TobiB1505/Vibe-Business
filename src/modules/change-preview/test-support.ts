import { createHash } from "node:crypto";
import { FIXTURE_COMMIT_SHA } from "@/modules/validation/test-support";
import type { PreviewTarget } from "./orchestrator";

/**
 * Fixtures for preview tests (Sprint 10B-2 §28–§34).
 *
 * The sandbox double itself lives in `validation/test-support.ts` and is
 * shared: preview uses the same `SandboxProvider`, so a second fake would be a
 * second opinion about how the provider behaves, and the two would drift.
 *
 * What is here is preview-shaped: a target whose hashes actually match a
 * filesystem, so that a mismatch test has to *break* something rather than
 * arrange for the check to be vacuous.
 */

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export const PREVIEW_SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
export const PREVIEW_SNAPSHOT_ID = "snap_validated_1";

/** File contents the restored snapshot "contains", keyed as the provider lays them out. */
export const RESTORED_FILES = {
  "product/app/robots.ts": "export default function robots() { return {}; }\n",
  "product/package.json": JSON.stringify({ name: "product", scripts: { build: "next build" } }),
  "product/pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
} as const;

/**
 * A restored filesystem that matches its manifest exactly.
 *
 * Tests break exactly one thing from here. That is the same discipline the
 * Sprint 9 preflight tests use, and it matters more here: a fixture whose
 * hashes never matched would let an integrity check that does nothing pass
 * every test.
 */
export function restoredSandboxFiles(
  overrides: Record<string, string | null> = {},
): Record<string, string> {
  const files: Record<string, string> = { ...RESTORED_FILES };

  for (const [path, content] of Object.entries(overrides)) {
    if (content === null) delete files[path];
    else files[path] = content;
  }

  return files;
}

export function fakePreviewTarget(overrides: Partial<PreviewTarget> = {}): PreviewTarget {
  return {
    previewSessionId: PREVIEW_SESSION_ID,
    snapshotId: PREVIEW_SNAPSHOT_ID,
    sourceRoot: "product",
    workspaceRoot: ".",
    preparedFiles: [
      { path: "app/robots.ts", contentHash: sha256(RESTORED_FILES["product/app/robots.ts"]) },
    ],
    buildIdentityFiles: [
      { path: "package.json", contentHash: sha256(RESTORED_FILES["product/package.json"]) },
      { path: "pnpm-lock.yaml", contentHash: sha256(RESTORED_FILES["product/pnpm-lock.yaml"]) },
    ],
    ...overrides,
  };
}

export { FIXTURE_COMMIT_SHA };
