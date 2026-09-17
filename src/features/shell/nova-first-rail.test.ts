import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PROJECT_SECTIONS, type ProjectSectionGroup } from "./project-shell";

/**
 * The rail stopped offering seven equal doors (ADR 0109 §1, Slice 7).
 *
 * ## What this exists to catch
 *
 * A founder arriving at a product used to meet Nova, Business Health, My
 * Product, Action Plan, Agent, Experiments and Project Settings as seven rows
 * of one list. Every one of them is a real destination and none of them is
 * wrong; what is wrong is that they were *equal*, so the first thing the
 * product asked a founder to do was choose. The restructure's whole claim is
 * that they do not have to: there is a conversation, and there are the things
 * it is about.
 *
 * That claim is a property of a table and of two arrays, which is why it can be
 * asserted here rather than only in a browser. The browser half —
 * `nova-first-shell.spec.ts` — asks the questions this cannot: which group is
 * higher on the screen, and whether the whole thing still fits a laptop.
 */

const SHELL = readFileSync("src/features/shell/project-shell.tsx", "utf8");
const SLOT = readFileSync("src/app/app/@rail/project-rail.tsx", "utf8");

/** Comments name the groups too; a test that counted prose would pass on one. */
function code(source: string): string {
  return source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("every section belongs to exactly one group", () => {
  it("assigns a group to all of them", () => {
    for (const section of PROJECT_SECTIONS) {
      expect(section.group, `${section.id} has no group`).toBeTruthy();
    }
  });

  it("puts Nova alone in the conversation group", () => {
    const nova = PROJECT_SECTIONS.filter((section) => section.group === "nova");
    expect(nova.map((section) => section.id)).toEqual(["home"]);
  });

  /**
   * The five, and the fact that the *set* has a name is the point. "Workspace"
   * is what Nova talks about, and a founder reading the rail is told that
   * rather than being handed five more doors beside hers.
   */
  it("puts the five capabilities in the workspace", () => {
    const workspace = PROJECT_SECTIONS.filter((section) => section.group === "workspace");
    expect(workspace.map((section) => section.id)).toEqual([
      "business-health",
      "my-product",
      "action-plan",
      "agent",
      "experiments",
    ]);
  });

  it("leaves Project Settings out of both", () => {
    const settings = PROJECT_SECTIONS.find((section) => section.id === "settings");
    expect(settings?.group).toBe("product");
  });

  /** A fourth group would be a fourth thing the rail has to decide how to draw. */
  it("uses no group the rail cannot render", () => {
    const drawn: ProjectSectionGroup[] = ["nova", "workspace", "product"];
    for (const section of PROJECT_SECTIONS) {
      expect(drawn, `${section.id} is in an unknown group`).toContain(section.group);
    }
  });
});

describe("the rail draws the conversation first", () => {
  /**
   * Source order, because the rail is a column and a column's source order *is*
   * its visual order. The browser spec measures the result; this catches the
   * two arrays being passed the wrong way round, which would still render and
   * would still fit a laptop.
   */
  it("renders the conversation above the workspace", () => {
    const rail = code(SHELL.slice(SHELL.indexOf("export function ProjectRail")));
    expect(rail.indexOf("novaItems")).toBeLessThan(rail.indexOf("workspaceItems"));
  });

  it("names the workspace as a group rather than listing five more doors", () => {
    expect(code(SHELL)).toContain(">Workspace<");
  });

  it("offers starting a conversation, and only as a button", () => {
    const rail = code(SHELL.slice(SHELL.indexOf("export function ProjectRail")));
    expect(rail).toContain("NewThreadButton");
    // A `<Link>` would be prefetched, and a prefetched write opens a thread
    // nobody pressed. `new-thread-button.tsx` says the same thing at length.
    expect(rail).not.toMatch(/href=\{threadsPath\([^)]*\)\}\s*prefetch/);
  });

  it("gives the conversation an address the section table does not own", () => {
    // `threads` is a row, not a section: a conversation is a list of rows with
    // their own addresses, and `projectSectionHref` would resolve it to the
    // list rather than to any thread.
    expect(PROJECT_SECTIONS.map((section) => section.id)).not.toContain("threads");
    expect(code(SLOT)).toContain("threadsPath(project.id)");
  });
});

describe("the workspace is quieter than the conversation, and no less reachable", () => {
  it("renders the workspace with the quiet tone and the conversation without", () => {
    const rail = code(SHELL.slice(SHELL.indexOf("export function ProjectRail")));
    expect(rail).toMatch(/items=\{workspaceItems\}\s+tone="quiet"/);
    expect(rail).not.toMatch(/items=\{novaItems\}[^>]*tone="quiet"/);
  });

  /**
   * Demotion is presentation and never reach. All five are still one click
   * away, still carry their counts and still carry the Agent's live status —
   * the alternative, a disclosure, trades seven equal doors for one nobody
   * opens.
   */
  it("keeps every workspace section a row of its own", () => {
    expect(code(SLOT)).toContain('section.group === "workspace"');
    expect(code(SLOT)).not.toMatch(/workspaceItems\.slice\(/);
  });
});
