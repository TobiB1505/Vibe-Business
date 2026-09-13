import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The provider boundary, read as text (ADR 0109, Proposed).
 *
 * `adapter.test.ts` proves a structured request is sent without tools.
 * These prove the stronger, structural claim the design rests on: the
 * shipped contract has no field a tool could arrive through, the tool-calling
 * contract is a separate interface a caller must name, and the SDK is still
 * imported from exactly one directory.
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** The text of one exported type or interface, from its declaration to the closing brace. */
function declaration(source: string, name: string): string {
  const start = source.indexOf(`export type ${name} =`);
  const interfaceStart = source.indexOf(`export interface ${name} `);
  const from = start === -1 ? interfaceStart : start;
  expect(from, `${name} is declared`).toBeGreaterThan(-1);
  const end =
    source.indexOf("\n};", from) === -1
      ? source.indexOf("\n}", from)
      : source.indexOf("\n};", from);
  return source.slice(from, end);
}

describe("the structured contract stays tool-free", () => {
  const provider = read("src/modules/ai/provider.ts");

  it("gives StructuredRequest no field for tools or a transcript", () => {
    const structured = declaration(provider, "StructuredRequest");
    expect(structured).not.toMatch(/\btools\b/);
    expect(structured).not.toMatch(/\bmessages\b/);
    expect(structured).toContain("userContent: string");
  });

  it("keeps AIProvider to its two methods", () => {
    const iface = declaration(provider, "AIProvider");
    expect(iface).toContain("countInputTokens(");
    expect(iface).toContain("generateStructured(");
    expect(iface).not.toContain("generateWithTools");
    expect(iface).not.toContain("ToolCallingRequest");
  });

  it("declares the tool-calling contract as its own interface", () => {
    const iface = declaration(provider, "AIToolCallingProvider");
    expect(iface).toContain("generateWithTools(");
    expect(iface).toContain("countToolCallingInputTokens(");
    // Not an extension of AIProvider: holding one never implies the other.
    expect(iface).not.toContain("extends AIProvider");
  });
});

describe("the SDK boundary is unchanged", () => {
  it("imports @anthropic-ai/sdk only under src/modules/ai/anthropic/", () => {
    const offenders = execSync(
      `grep -rlE 'from "@anthropic-ai/sdk"' src --include=*.ts --include=*.tsx || true`,
      { encoding: "utf8" },
    )
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((path) => !path.startsWith("src/modules/ai/anthropic/"))
      .filter((path) => !path.endsWith(".test.ts"));
    expect(offenders).toEqual([]);
  });

  it("keeps the pilot's loops free of the SDK and of the adapter", () => {
    for (const file of ["seam-a.ts", "seam-b.ts", "dispatch.ts", "tools.ts", "prompt.ts"]) {
      const source = read(`src/modules/business-agent/pilot/${file}`);
      expect(source, file).not.toContain("@anthropic-ai/sdk");
      expect(source, file).not.toContain("@/modules/ai/anthropic");
    }
  });
});
