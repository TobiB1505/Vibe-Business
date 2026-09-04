import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { LIVE_PRODUCT_ANALYZER_VERSION } from "@/modules/live-product-intelligence/schema";
import { ANALYZER_VERSION as REPOSITORY_ANALYZER_VERSION } from "@/modules/repository-intelligence/schema";

/**
 * The two analyzer versions, pinned to the code they claim to describe.
 *
 * ## The incident this exists for
 *
 * On 2026-09-02 a fix taught the live classifier to see a pricing surface that
 * is an anchor section rather than a route. `LIVE_PRODUCT_ANALYZER_VERSION` was
 * not bumped. `findReusableLiveSnapshot` keys reuse on that string alone, so a
 * snapshot taken eight hours earlier — which had recorded "no pricing surface"
 * about a page displaying three prices — stayed reusable. Two days later it
 * produced an audit whose highest-priority contradiction, its critical rank-1
 * blocker and the founder's whole plan all rested on it. The founder paid for
 * that audit, and the fix had already shipped.
 *
 * Nothing failed. Not `tsc`, not lint, not eight thousand tests, not the build.
 * A finding without a failing check is a note, so this is the check: the
 * detectors' normalized source is hashed and the hash is recorded beside the
 * version. Change detection logic and the hash moves; the pin fails, and it
 * fails with the two things that resolve it — bump the version, or record the
 * new hash because the change was behaviour-neutral.
 *
 * ## What it asserts
 *
 * Two things, and the second matters as much as the first:
 *
 *  1. **The recorded hash still matches.** A silent behaviour change cannot
 *     ship.
 *  2. **Every file in each module is classified.** A new detector file is
 *     neither hashed nor exempt until somebody says which it is, so the pin
 *     cannot be defeated by adding code beside it rather than inside it.
 *
 * ## What it cannot assert
 *
 * That a bump was *correct*. Recording a new hash under the same version is a
 * claim that the change cannot alter any stored snapshot's content, and this
 * file has no way to check that claim — it only forces someone to make it in
 * the open, in a diff, rather than by not thinking about it. The honest reading
 * is the one rule 66 applies to `sandbox_validation_passed`: green here means
 * the question was asked, never that the answer was right.
 *
 * ## The cost, stated plainly
 *
 * Normalization drops blank lines, indentation and whole-line comments, so
 * documentation and layout are free. Two edits still trip the pin without
 * changing behaviour, and both are deliberate:
 *
 * - **A comment trailing real code.** Stripping those would have to mangle
 *   `https://` inside a string literal, which `url.ts` and `html.ts` both
 *   contain. A normalizer that silently ate code would be worse than one that
 *   occasionally asks a question.
 * - **An expression reflowed across lines.** Collapsing harder — deleting
 *   whitespace beside punctuation, say — would also erase the difference
 *   between two string literals a detector matches on, which is a hole in the
 *   guard traded for a convenience.
 *
 * Either one costs a recorded hash and the sentence that goes with it, and
 * both happen while somebody is editing a detector, which is precisely when
 * the version deserves a thought.
 */

const ROOT = process.cwd();

/** A module whose detection rules a stored snapshot's content depends on. */
type AnalyzerPin = {
  /** What the version constant is called where a reader will look for it. */
  readonly constant: string;
  /** Its current value, imported rather than repeated. */
  readonly version: string;
  readonly dir: string;
  /**
   * The files whose logic decides what a stored snapshot says. Editing any of
   * them is a new analyzer unless the edit provably changes no output.
   */
  readonly shapesTheSnapshot: readonly string[];
  /** The rest, each with the reason it is out — never a bare exclusion list. */
  readonly doesNot: Readonly<Record<string, string>>;
  /** The recorded hash. Update it only together with the reasoning above. */
  readonly hash: string;
};

const LIVE: AnalyzerPin = {
  constant: "LIVE_PRODUCT_ANALYZER_VERSION",
  version: LIVE_PRODUCT_ANALYZER_VERSION,
  dir: "src/modules/live-product-intelligence",
  shapesTheSnapshot: [
    "analyzer.ts",
    "brand.ts",
    "budgets.ts",
    "classifier.ts",
    "crawler.ts",
    "cta.ts",
    "forms.ts",
    "html.ts",
    "pricing-text.ts",
    "rendering.ts",
    "robots.ts",
    "signals.ts",
    "sitemap.ts",
    "url.ts",
    /*
     * The safe-fetch boundary is in, and not as a formality: it decides which
     * bytes ever reach a detector. A redirect rule, a blocked address range, a
     * streaming byte limit that truncates a page — each one changes what the
     * classifier is looking at, which is the same class of change as changing
     * the classifier.
     */
    join("net", "ip.ts"),
    join("net", "node-dns.ts"),
    join("net", "node-transport.ts"),
    join("net", "ports.ts"),
    join("net", "safe-fetch.ts"),
  ],
  doesNot: {
    "schema.ts":
      "holds this constant and the row shape; a field added here is visible in the diff that adds it",
    "service.ts": "orchestration — decides when to analyze, never what a page says",
    "store.ts": "persistence, and the reuse lookup that reads this constant",
    "human-view.ts": "presentation of a stored snapshot, downstream of the snapshot itself",
    "errors.ts": "the failure taxonomy; it names an outcome rather than reinterpreting a page",
    "test-support.ts": "fixtures and fakes; nothing here runs against a customer's site",
  },
  hash: "c0ae6911a7f524e9aeb880e8d6292dd85918365ebc6283cfd6ad1bb2dff89710",
};

const REPOSITORY: AnalyzerPin = {
  constant: "ANALYZER_VERSION",
  version: REPOSITORY_ANALYZER_VERSION,
  dir: "src/modules/repository-intelligence",
  shapesTheSnapshot: [
    "analyzer.ts",
    "budgets.ts",
    "candidates.ts",
    "context.ts",
    "path-policy.ts",
    "reader.ts",
    join("detectors", "brand.ts"),
    join("detectors", "build-targets.ts"),
    join("detectors", "business-surfaces.ts"),
    join("detectors", "integrations.ts"),
    join("detectors", "monorepo.ts"),
    join("detectors", "routes.ts"),
    join("detectors", "stack.ts"),
    join("parsers", "package-json.ts"),
  ],
  doesNot: {
    "schema.ts": "holds this constant and the row shape",
    "service.ts": "orchestration — decides when to analyze, never what a repository contains",
    "store.ts": "persistence, and the reuse lookup that reads this constant",
    "human-view.ts": "presentation of a stored snapshot, downstream of the snapshot itself",
    /*
     * Cross-checks are computed at audit time from two finished snapshots and
     * are stored in neither. They belong to `EVIDENCE_PACK_V3_VERSION`, which
     * is hashed into the audit's own input identity — a different boundary,
     * and pinning it here would attach the wrong version to the wrong artifact.
     */
    "cross-check.ts":
      "an evidence-pack input, versioned by EVIDENCE_PACK_V3_VERSION rather than by a snapshot",
    "test-support.ts": "fixtures and fakes; nothing here runs against a customer's repository",
  },
  hash: "7e5f433e1c461ea1b9527ae3314fd68e8fc305faa9f4f96f4620cea9f5d110df",
};

const PINS = [LIVE, REPOSITORY];

/**
 * Source with prose and indentation removed, so a comment is free.
 *
 * Only comments that **begin a line** are dropped. An unanchored block-comment
 * strip would start matching at the slash-star string literal in `robots.ts`
 * and swallow real code as far as the next close; a trailing-slash-slash strip
 * would eat the rest of `` `https://${trimmed}` ``. Both would hash less code
 * than the file contains while looking like they hashed all of it.
 */
export function normalizeForPin(source: string): string {
  const kept: string[] = [];
  let inBlock = false;

  for (const raw of source.split("\n")) {
    const line = raw.trim();

    if (inBlock) {
      if (line.endsWith("*/")) inBlock = false;
      continue;
    }
    if (line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      if (!line.endsWith("*/")) inBlock = true;
      continue;
    }
    if (line !== "") kept.push(line);
  }

  return kept.join("\n").replace(/\s+/g, " ");
}

function hashOf(pin: AnalyzerPin): string {
  const digest = createHash("sha256");

  /* Sorted, so the recorded hash does not depend on the order of the list. */
  for (const file of [...pin.shapesTheSnapshot].sort()) {
    digest.update(file);
    digest.update(" ");
    digest.update(normalizeForPin(readFileSync(join(ROOT, pin.dir, file), "utf8")));
    digest.update(" ");
  }

  return digest.digest("hex");
}

/** Every source file in the module, test files aside. */
function sourceFilesIn(dir: string): string[] {
  const found: string[] = [];

  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
      found.push(relative(join(ROOT, dir), full));
    }
  };

  walk(join(ROOT, dir));
  return found.sort();
}

describe.each(PINS)("$constant", (pin) => {
  it("still describes the code that produces its snapshots", () => {
    expect(
      hashOf(pin),
      [
        ``,
        `The detectors behind ${pin.constant} changed, and the version did not.`,
        ``,
        `  ${pin.dir}/  —  currently "${pin.version}"`,
        ``,
        `Two ways forward, and only two:`,
        ``,
        `  1. The change alters what a snapshot can say. Bump ${pin.constant},`,
        `     explain the bump in its docblock, and record the new hash here.`,
        `     Every stored snapshot below the new version stops being reused,`,
        `     which is the point — the alternative is serving a fixed bug`,
        `     forever, which is what happened on 2026-09-02.`,
        ``,
        `  2. The change cannot alter any snapshot's content — a rename, a pure`,
        `     refactor, a trailing comment. Record the new hash on its own and`,
        `     say so in the commit body.`,
        ``,
        `There is no third option, and "it is probably fine" is option 2 without`,
        `the sentence that makes it reviewable.`,
        ``,
      ].join("\n"),
    ).toBe(pin.hash);
  });

  /* Otherwise the pin is defeated by adding a detector rather than editing one. */
  it("classifies every file in the module", () => {
    const classified = new Set([...pin.shapesTheSnapshot, ...Object.keys(pin.doesNot)]);

    expect(sourceFilesIn(pin.dir).filter((file) => !classified.has(file))).toEqual([]);
  });

  it("names no file that has since been deleted", () => {
    const present = new Set(sourceFilesIn(pin.dir));
    const named = [...pin.shapesTheSnapshot, ...Object.keys(pin.doesNot)];

    expect(named.filter((file) => !present.has(file))).toEqual([]);
  });

  it("gives a reason for every file it leaves out", () => {
    for (const [file, reason] of Object.entries(pin.doesNot)) {
      expect(reason.length, file).toBeGreaterThan(20);
    }
  });

  it("hashes detectors rather than an empty list", () => {
    expect(pin.shapesTheSnapshot.length).toBeGreaterThan(5);
  });
});

/**
 * The normalizer, proved live in both directions.
 *
 * A pin whose hash never moves is a green test that guards nothing, and a pin
 * that moves on every reflow gets its hash recorded without being read. Both
 * halves are asserted here rather than assumed.
 */
describe("what moves the hash, and what does not", () => {
  const CODE = [
    "export function classify(page: Page) {",
    "  return page.headings.some((heading) => PRICE.test(heading));",
    "}",
  ].join("\n");

  it("ignores a comment and a blank line", () => {
    const commented = [
      "/**",
      " * A whole paragraph of reasoning nobody needs to re-record a hash for.",
      " */",
      "export function classify(page: Page) {",
      "",
      "  // why this reads headings",
      "  return page.headings.some((heading) => PRICE.test(heading));",
      "}",
    ].join("\n");

    expect(normalizeForPin(commented)).toBe(normalizeForPin(CODE));
  });

  it("ignores indentation", () => {
    const indented = CODE.split("\n")
      .map((line) => `        ${line}`)
      .join("\n");

    expect(normalizeForPin(indented)).toBe(normalizeForPin(CODE));
  });

  /**
   * The documented false positive, asserted rather than left to be discovered.
   * Collapsing hard enough to make this free would also erase the difference
   * between `"sign up"` and `"sign.up"` in a detector's keyword list.
   */
  it("moves when an expression is reflowed, and that is the accepted cost", () => {
    const reflowed = CODE.replace("page.headings.some", "page.headings\n    .some");

    expect(normalizeForPin(reflowed)).not.toBe(normalizeForPin(CODE));
  });

  it("moves when a rule changes", () => {
    expect(normalizeForPin(CODE.replace("some", "every"))).not.toBe(normalizeForPin(CODE));
  });

  /* The exact shape of the incident: one operator, nothing else. */
  it("moves when a single character of logic changes", () => {
    expect(normalizeForPin("if (count > 2) return true;")).not.toBe(
      normalizeForPin("if (count >= 2) return true;"),
    );
  });

  /** The two literals a careless strip would have eaten. */
  it("keeps a URL in a string literal", () => {
    expect(normalizeForPin("const base = `https://${host}/`;")).toContain("https://");
  });

  it("keeps code that follows a slash-star string literal", () => {
    const source = ['const wildcard = "/*";', "const blocked = rules.length > 0;"].join("\n");

    expect(normalizeForPin(source)).toContain("blocked");
  });
});
