import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The robots *meta* directive every page renders (Next's `metadata.robots`),
 * as distinct from `robots.ts`'s robots.txt file — the two are separate
 * signals and both are part of the same plan.
 *
 * Read from source rather than imported: `src/app/app/layout.tsx` calls
 * `requireSession()` at module scope through its default export, which needs
 * a real request context to resolve. The `metadata` export itself is a plain
 * object regardless, so pinning its literal text is enough to catch the
 * regression this exists for — either directive quietly reverting, or
 * disappearing when one of these two files is next touched.
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const ROOT_LAYOUT = read("src/app/layout.tsx");
const APP_LAYOUT = read("src/app/app/layout.tsx");

describe("robots meta directives", () => {
  it("makes public pages indexable by default from the root layout", () => {
    expect(ROOT_LAYOUT).toMatch(/robots:\s*\{\s*index:\s*true,\s*follow:\s*true\s*\}/);
  });

  it("makes the whole signed-in area non-indexable from its own layout", () => {
    expect(APP_LAYOUT).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  });

  it("declares the signed-in override as page metadata, not a runtime check", () => {
    expect(APP_LAYOUT).toContain("export const metadata");
  });
});
