import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every reference to an ADR resolves, and names the ADR it resolves to.
 *
 * ## The morning this was written
 *
 * `main` took ADR 0083 for the estimator decision while a branch held 0083–0086
 * for four Nova decisions. The branch renumbered to 0084–0087, and the merge
 * shipped the **renames** without the edits that follow a rename — because the
 * commit staged the `git mv`s and not the working tree. So `main` briefly
 * carried `0084-nova-voice-is-measured-not-argued.md` whose own first line said
 * `# 0083`, and `voice/store.ts` linking to
 * `0085-nova-presentation-is-claimed-stored-and-attempted-once.md`, a file that
 * no longer existed — while `0085` did exist and was a different decision.
 *
 * Nothing failed. `tsc`, `eslint`, 8,435 tests, the migration suite and the
 * build were all green, and all of them ran against the working tree, where the
 * edits were. `documentation-currency.test.ts` checks that current-state
 * documents are true; it does not check that a pointer points at what it says.
 *
 * It was the third numbering collision in one branch, so this is the check
 * rather than a fourth resolution to be careful.
 *
 * ## What it asserts
 *
 * Three things, all of which the incident broke:
 *
 *  1. **An ADR's first line names its own number.** A rename moves a file; it
 *     does not move the heading inside it.
 *  2. **A link's label matches the ADR it points at.** `[0085](0086-…)` is the
 *     shape a renumber leaves behind, and it reads as authoritative.
 *  3. **The target exists.** A link to a renamed ADR either 404s or, worse,
 *     resolves to a different decision that has since taken the number.
 *
 * Scoped to `docs/decisions/` on purpose. Sprint records link sprints, whose
 * numbers legitimately differ from the ADR they name in the same sentence.
 */

const ROOT = process.cwd();
const DECISIONS = join(ROOT, "docs/decisions");

/** `# 0084 - title` and the older `# ADR 0010 — title` are both legitimate. */
const HEADING = /^#\s*(?:ADR\s*)?(\d{4})\b/;

/** Any markdown link whose target looks like a numbered decision file. */
const NUMBERED_LINK = /\[(?:ADR\s*)?(\d{4})\]\(([^)\s]*?(\d{4})-[a-z0-9-]+\.md)\)/g;

/**
 * Where a link actually points, trying each way this repository writes one.
 *
 * Three are in use and all three are legitimate: relative to the file that
 * wrote it (`../../../docs/decisions/0086-….md` from a module), relative to the
 * repository root (`docs/decisions/0041-….md` in a docblock), and a bare
 * sibling filename inside `docs/decisions/` itself. Returns the first that
 * exists, or null when none does.
 */
function resolveTarget(from: string, target: string): string | null {
  const candidates = [
    resolve(from, "..", target),
    join(ROOT, target),
    join(DECISIONS, target),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Whether a link is about a decision at all.
 *
 * A sprint record linking `0118-what-two-tools-can-hold.md` names a **sprint**,
 * and sprint numbers are their own sequence — so a bare filename only counts as
 * a decision when it is written from inside `docs/decisions/`, or when the path
 * says `docs/decisions/` outright.
 */
function isDecisionLink(from: string, target: string): boolean {
  return target.includes("docs/decisions/") || from.startsWith(DECISIONS);
}

function adrFiles(): string[] {
  return readdirSync(DECISIONS)
    .filter((name) => /^\d{4}-[a-z0-9-]+\.md$/.test(name))
    .sort();
}

/** Every file that could carry a reference, tests and node_modules aside. */
function referencingFiles(): string[] {
  const found: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(md|ts|tsx|sql)$/.test(entry.name)) found.push(full);
    }
  };

  for (const dir of ["docs", "src", "supabase"]) walk(join(ROOT, dir));
  for (const name of ["ARCHITECTURE.md", "CLAUDE.md", "PRODUCT.md", "README.md"]) {
    const full = join(ROOT, name);
    if (existsSync(full)) found.push(full);
  }

  return found;
}

describe("an ADR names its own number", () => {
  it.each(adrFiles())("%s", (name) => {
    const first = readFileSync(join(DECISIONS, name), "utf8").split("\n")[0];
    const heading = HEADING.exec(first);

    expect(heading, `${name}: first line is not a numbered heading — ${first.slice(0, 60)}`).not.toBeNull();
    expect(heading?.[1], `${name}: heading and filename disagree`).toBe(name.slice(0, 4));
  });
});

/**
 * The two halves of a broken pointer, gathered in one pass so a failure lists
 * every one rather than the first.
 */
describe("every link to a decision resolves, and says which one", () => {
  const mislabelled: string[] = [];
  const missing: string[] = [];

  for (const file of referencingFiles()) {
    const text = readFileSync(file, "utf8");
    const where = relative(ROOT, file);

    for (const match of text.matchAll(NUMBERED_LINK)) {
      const [, label, target, targetNumber] = match;
      if (!isDecisionLink(file, target)) continue;

      if (label !== targetNumber) {
        mislabelled.push(`${where}: [${label}] points at ${target}`);
      }

      if (resolveTarget(file, target) === null) {
        missing.push(`${where}: no such decision — ${target}`);
      }
    }
  }

  it("labels each link with the number it points at", () => {
    expect(mislabelled).toEqual([]);
  });

  it("points every link at a decision that exists", () => {
    expect(missing).toEqual([]);
  });
});
