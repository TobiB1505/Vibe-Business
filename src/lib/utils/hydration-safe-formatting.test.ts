import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No Client Component formats a date through `Intl` (PERF-021).
 *
 * ## Why this is a repository-wide rule and not a review note
 *
 * `format-datetime.ts` was written because `toLocaleString()` produces a
 * different string on the server than in the browser, React discards the
 * subtree it finds a mismatch in, and it logged an uncaught error on the
 * Review panel — inside the merge path. That was fixed once, and two panels
 * had since gone back to asking the question independently: the Agent's file
 * activity and the coding-agent live feed, both rendering the reader's own
 * timezone into HTML the server had already written in UTC.
 *
 * The rule is the whole family, not just the zone-less calls. `Intl` with an
 * explicit locale and `timeZone` is close, and still depends on the ICU data
 * compiled into each runtime; the helpers are arithmetic on the UTC getters,
 * which cannot drift.
 *
 * `toLocaleLowerCase` and `toLocaleUpperCase` are deliberately not matched:
 * they are string case, not formatting, and the list filters use them on
 * purpose.
 */

const SRC = join(process.cwd(), "src");
const FORBIDDEN = /\.toLocale(?:Date|Time|)String\s*\(/;

function clientComponents(dir: string = SRC, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      clientComponents(path, found);
      continue;
    }
    if (![".ts", ".tsx"].includes(extname(entry.name))) continue;
    if (entry.name.includes(".test.")) continue;

    const source = readFileSync(path, "utf8");
    if (/^["']use client["'];/m.test(source)) found.push(path);
  }
  return found;
}

describe("client-side formatting", () => {
  it("finds the client components, so the rule below is applied to something", () => {
    expect(clientComponents().length).toBeGreaterThan(20);
  });

  it("never formats a date or number through the runtime's locale", () => {
    const offenders = clientComponents()
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return source
          .split("\n")
          .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
          .some((line) => FORBIDDEN.test(line));
      })
      .map((path) => relative(SRC, path));

    expect(
      offenders,
      "a locale-formatted value renders differently on the server than in the browser",
    ).toEqual([]);
  });
});
