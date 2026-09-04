import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALL_CONSOLE_COLUMNS, FORBIDDEN_COLUMNS, selection } from "./columns";

const HERE = dirname(fileURLToPath(import.meta.url));

function moduleSources(): { file: string; source: string }[] {
  return readdirSync(HERE)
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
    .map((name) => ({ file: name, source: readFileSync(join(HERE, name), "utf8") }));
}

/**
 * The console has no tenant boundary underneath it ([ADR 0084](../../../docs/decisions/0084-the-internal-operator-console.md) §4).
 *
 * Every other read in this application is caught by RLS if it asks for too
 * much. This one is not, so what it may ask for is asserted here rather than
 * reviewed each time somebody adds a column to a table it reads.
 */
describe("the console reads columns, never everything", () => {
  it("never selects a wildcard", () => {
    const offenders = moduleSources()
      .filter(({ source }) => /\.select\(\s*["'`]\s*\*/.test(source))
      .map(({ file }) => file);

    expect(
      offenders,
      'select("*") inherits whatever column is added next, and this surface has ' +
        "no tenant boundary to catch it afterwards. Name the columns in columns.ts.",
    ).toEqual([]);
  });

  it("passes every selection through the allowlist rather than a literal", () => {
    /*
     * A hand-written column string in a query would satisfy the wildcard check
     * above and still bypass the list, so the shape of the call is asserted
     * too: `.select(selection(SOMETHING))` and nothing else.
     */
    const offenders = moduleSources().flatMap(({ file, source }) =>
      source
        .split("\n")
        .filter((line) => line.includes(".select("))
        .map((line) => line.trim())
        // Everything between the first "(" after .select and the line's last ")".
        .map((line) => line.slice(line.indexOf(".select(") + 8, line.lastIndexOf(")")))
        .filter((argument) => !/^selection\([A-Za-z_]+\)$/.test(argument.trim()))
        .map((argument) => `${file}: .select(${argument})`),
    );

    expect(offenders).toEqual([]);
  });

  it("names no column that carries customer content", () => {
    const offenders = ALL_CONSOLE_COLUMNS.filter((column) =>
      FORBIDDEN_COLUMNS.some(
        (forbidden) => column === forbidden || column.endsWith(`_${forbidden}`),
      ),
    );

    expect(
      offenders,
      "a column carrying repository paths, commands, prose or an address must not " +
        "reach the console — see columns.ts for what each would have leaked",
    ).toEqual([]);
  });

  it("keeps the agent's command and path out, which is the whole point of the list", () => {
    // agent_tool_events has exactly two columns carrying a customer's
    // repository. Asserting them by name means a future widening of the list
    // fails here rather than shipping.
    expect(ALL_CONSOLE_COLUMNS).not.toContain("command");
    expect(ALL_CONSOLE_COLUMNS).not.toContain("path");
  });

  it("renders a selection PostgREST accepts", () => {
    expect(selection(["a", "b"])).toBe("a, b");
  });
});
