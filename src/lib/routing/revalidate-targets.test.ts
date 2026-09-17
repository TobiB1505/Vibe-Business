import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { retiredAddressRedirects } from "./retired-addresses";

/**
 * A `revalidatePath` target that no longer resolves revalidates nothing.
 *
 * ## The defect that earned this file
 *
 * `founder-name-actions.ts` revalidated `/app/profile`, and had done since
 * before [ADR 0104](docs/decisions/0104-the-account-level-is-settings.md) moved
 * the account pages under `/app/settings`. `/app/profile` has been a redirect
 * ever since, and a redirect source has no cached render to invalidate — so a
 * founder who changed their name kept seeing the old one until something else
 * happened to refresh the page. Nothing failed. Lint did not, `tsc` did not,
 * and nine thousand tests did not, because a string that looks like a path is
 * a valid string.
 *
 * ## What this asserts, and what it cannot
 *
 * It asserts that every **literal** target either resolves to a route file on
 * disk, or is a project path built by `projectPath`, or is one of the two
 * layout-scoped roots. It cannot check a target built from a variable at
 * runtime — `projectPath(projectId)` is checked by its own owner, and a target
 * assembled some third way would pass here and still be wrong. That is the
 * limit of a source assertion and it is stated rather than implied.
 */

const ROOT = process.cwd();
const APP = join(ROOT, "src", "app");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every literal string handed to `revalidatePath`, across the whole of `src`. */
function literalTargets(): { file: string; target: string }[] {
  const found: { file: string; target: string }[] = [];
  for (const path of sourceFiles(join(ROOT, "src"))) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/revalidatePath\(\s*"([^"]+)"/g)) {
      found.push({
        file: path
          .slice(ROOT.length + 1)
          .split(sep)
          .join("/"),
        target: match[1]!,
      });
    }
  }
  return found;
}

/** Does `/app/settings/profile` name a route file under `src/app`? */
function routeExists(target: string): boolean {
  const segments = target.replace(/^\//, "").split("/").filter(Boolean);

  function walk(dir: string, rest: string[]): boolean {
    if (rest.length === 0) {
      return readdirSync(dir).includes("page.tsx") || readdirSync(dir).includes("route.ts");
    }
    const [head, ...tail] = rest;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      // A route group is invisible in the URL; a dynamic segment eats one.
      if (name.startsWith("(") && name.endsWith(")")) {
        if (walk(join(dir, name), rest)) return true;
        continue;
      }
      if (name === head && walk(join(dir, name), tail)) return true;
      if (name.startsWith("[") && walk(join(dir, name), tail)) return true;
    }
    return false;
  }

  return walk(APP, segments);
}

const TARGETS = literalTargets();

describe("every revalidated path is a path that renders", () => {
  it("finds the targets it is supposed to be checking", () => {
    // A regex that stopped matching would make the assertion below vacuous.
    expect(TARGETS.length).toBeGreaterThan(0);
    expect(TARGETS.map((t) => t.target)).toContain("/app");
  });

  it("names a route file for every literal target", () => {
    const dangling = TARGETS.filter(({ target }) => !routeExists(target));
    expect(
      dangling.map(({ file, target }) => `${file} revalidates ${target}`),
      "A revalidatePath target with no route file behind it revalidates nothing, " +
        "and fails silently — which is how /app/profile survived ADR 0104.",
    ).toEqual([]);
  });

  it("never revalidates an address that only redirects", () => {
    const retired = new Set(retiredAddressRedirects().map((rule) => rule.source));

    const redirecting = TARGETS.filter(({ target }) => retired.has(target));
    expect(
      redirecting.map(({ file, target }) => `${file} revalidates ${target}`),
      "A redirect source has no cached render to invalidate. Name the address " +
        "it redirects to instead.",
    ).toEqual([]);
  });
});
