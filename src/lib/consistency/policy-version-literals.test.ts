import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { RETAIL_PRICE_POLICIES } from "@/modules/credits/retail";
import { EXECUTION_BUDGET_POLICIES } from "@/modules/execution-contract/budget";

/**
 * A policy version is named by the registry that defines it, and nowhere else.
 *
 * ## The defect this closes, found in production
 *
 * `settleOperationBilling` resolved its policy version as
 * `params.policyVersion ?? "retail-v1"`. None of its three production callers
 * passed one, so every charge carried that literal whatever had priced it —
 * correct while `retail-v1` was the only policy, and false from the instant
 * `launch-v1` took effect. **Eleven production charges named a card that could
 * not explain their own amount**, and the amounts were right the whole time, so
 * nothing failed and nothing looked wrong.
 *
 * A test that checked the *amount* would not have caught it. A test that
 * checked the *stamp* against the policy in force would need a clock and a
 * database. This checks neither: it says a version string is a fact the
 * registry owns, and a copy of it somewhere else is a second source of truth
 * that will eventually disagree with the first.
 *
 * ## What counts as a violation, and what does not
 *
 * Comments are stripped before the scan. `credits/operation-billing.ts` and
 * `operations/billing.ts` both discuss `"retail-v1"` at length in docblocks
 * describing exactly this defect, and that prose is the opposite of the
 * problem — a literal in code is a hardcoded decision, a literal in a comment
 * is a record of one.
 *
 * Tests are excluded for the same reason they are excluded from most
 * structural rules here: a test that pins `launch-v1`'s price has to be able to
 * write `launch-v1`.
 *
 * ## Why the version list is imported rather than typed out
 *
 * So the rule grows with the registries. A `launch-v2` added to
 * `RETAIL_PRICE_POLICIES` is covered by this test the moment it exists, with no
 * second place to remember.
 */

const SRC = join(process.cwd(), "src");

/**
 * Where each version may legitimately appear, by the file that defines it.
 *
 * Any other file naming one is either a hardcoded decision that should be
 * resolved from the registry, or an entry below with an argument.
 */
const DEFINING_FILES: Readonly<Record<string, string>> = {
  retail: "src/modules/credits/retail.ts",
  budget: "src/modules/execution-contract/budget.ts",
};

/**
 * Sites that name a version and are allowed to, with the reason.
 *
 * Empty on purpose. It exists because the next real exception should have to
 * be written down rather than added to a regex — the same shape
 * `supabase/service-boundary.test.ts` and `read-bounds.test.ts` use, where the
 * allowlist *is* the review record. Adding an entry is a decision; a version
 * literal that arrives without one fails the build.
 */
const PERMITTED: readonly { file: string; version: string; why: string }[] = [];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    // Tests and dev probes may name a version: one pins behaviour, the other
    // prints it for a person.
    if (/\.(test|probe|concurrency)\.tsx?$/.test(entry)) continue;
    found.push(full);
  }
  return found;
}

/**
 * The file with its comments removed.
 *
 * Deliberately not a parser. Block comments and line comments are stripped in
 * that order; a `//` inside a string literal would be over-stripped, which can
 * only ever *hide* a violation from this test, never invent one. A rule that
 * fails loudly on a false positive would be worse.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const VERSIONS: readonly { version: string; definingFile: string }[] = [
  ...RETAIL_PRICE_POLICIES.map((policy) => ({
    version: policy.version,
    definingFile: DEFINING_FILES.retail,
  })),
  ...EXECUTION_BUDGET_POLICIES.map((policy) => ({
    version: policy.version,
    definingFile: DEFINING_FILES.budget,
  })),
];

const violations = sourceFiles(SRC).flatMap((path) => {
  const file = relative(process.cwd(), path);
  const body = code(readFileSync(path, "utf8"));

  return VERSIONS.filter(({ version, definingFile }) => {
    if (file === definingFile) return false;
    if (PERMITTED.some((entry) => entry.file === file && entry.version === version)) return false;
    return body.includes(`"${version}"`) || body.includes(`'${version}'`);
  }).map(({ version, definingFile }) => `${file}: names "${version}", which ${definingFile} owns`);
});

describe("a policy version is a fact its registry owns", () => {
  it("ships at least one version to check, so an empty registry cannot pass this vacuously", () => {
    expect(VERSIONS.length).toBeGreaterThan(0);
    expect(VERSIONS.map((entry) => entry.version)).toContain("launch-v1");
  });

  it("finds no version literal outside the file that defines it", () => {
    expect(violations).toEqual([]);
  });

  it("would catch the defect it was written for", () => {
    // The exact shape that mis-stamped eleven charges, proved to fail rather
    // than assumed to. Without this, a rule that silently matched nothing
    // would pass forever.
    const body = code('const v = params.policyVersion ?? "retail-v1";');
    expect(VERSIONS.some((entry) => body.includes(`"${entry.version}"`))).toBe(true);
  });

  it("does not fire on a version discussed in a comment", () => {
    const body = code('/** `"retail-v1"` came to be its fallback. */\nconst x = 1;');
    expect(VERSIONS.some((entry) => body.includes(`"${entry.version}"`))).toBe(false);
  });
});
