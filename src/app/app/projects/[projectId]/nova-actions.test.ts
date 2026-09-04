import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { NOVA_ACTION_IDS, NOVA_ACTION_META } from "@/modules/nova/actions";

/**
 * That every Nova control names something that exists.
 *
 * The strong half of this is not here: `NOVA_ACTIONS` is a total
 * `Record<NovaActionId, …>` holding real function references, so an id with no
 * binding, or a binding to an action that was renamed or deleted, fails the
 * *build*. What is left for a test is the part the compiler cannot see — that
 * the binding agrees with the catalog about what kind of control it is, and
 * that two specific actions which look interchangeable were not swapped.
 *
 * Read as source rather than imported, because importing it would pull nine
 * `"use server"` modules and their whole dependency graph into a unit test in
 * order to assert things about a table.
 */

const SOURCE = readFileSync(
  join(process.cwd(), "src/app/app/projects/[projectId]/nova-actions.ts"),
  "utf8",
);

/** The file with its comments removed — they name the actions deliberately not bound. */
const BINDINGS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

describe("every control is bound", () => {
  it("names every action id", () => {
    for (const id of NOVA_ACTION_IDS) {
      expect(BINDINGS, id).toContain(`"${id}":`);
    }
  });

  it("binds a server action for every id the catalog calls one", () => {
    for (const id of NOVA_ACTION_IDS) {
      if (NOVA_ACTION_META[id].control !== "server_action") continue;
      expect(BINDINGS, id).toMatch(
        new RegExp(`"${id.replace(".", "\\.")}":\\s*\\{\\s*control:\\s*"server_action"`),
      );
    }
  });

  /**
   * Bound since Stage 4 merged. While it was `unbound` this asserted the
   * opposite, and the pair of tests either side of the layer boundary is what
   * turned the branch landing into a failing build rather than a stale
   * sentence in a catalog.
   */
  it("binds the workspace choice to the action Stage 4 brought", () => {
    expect(BINDINGS).toContain("chooseWorkspaceRootAction");

    /*
     * Scoped to the table, not the file: `NovaActionBinding` still declares an
     * `unbound` variant, deliberately, because the situation it names recurs.
     * What must not exist is an entry using it.
     */
    const table = BINDINGS.slice(BINDINGS.indexOf("export const NOVA_ACTIONS"));
    expect(table.slice(0, table.indexOf("\n};"))).not.toContain('control: "unbound"');
  });
});

describe("the two actions that must not be confused", () => {
  /**
   * `resolveAgentInterruptAction` records the answer and stops.
   * `resolveAgentFounderInputAction` records it and then starts a fresh run —
   * a 150-to-350-Credit charge. They take identical arguments and their names
   * differ by two words, so the wrong one binds silently and turns a control
   * the catalog calls free into a paid restart (rule 60).
   */
  it("answers the agent's question without restarting the run", () => {
    expect(BINDINGS).toContain("resolveAgentInterruptAction");
    expect(BINDINGS).not.toContain("resolveAgentFounderInputAction");
  });

  /**
   * `validateChangeAction` reuses a previous pass; `rerunChangeValidationAction`
   * does not. A control that says "check it again" and reuses the answer it is
   * being asked to recompute would be lying in one word.
   */
  it("re-runs validation rather than reusing a pass", () => {
    expect(BINDINGS).toContain("rerunChangeValidationAction");
    expect(BINDINGS).not.toMatch(/\bvalidateChangeAction\b/);
  });
});

describe("the addresses", () => {
  /**
   * Asserted as source because these are URL contracts: the shape is the
   * agreement, and `one-loop.test.ts` pins the rest of the product's the same
   * way. Nothing here permits anything — an address is not authority
   * (`action-plans/source.ts:275-284`).
   */
  it("addresses a change through the agent surface, by its exact id", () => {
    expect(BINDINGS).toContain("preparedChangeHref(agentChangeHref(agent, preparedChangeId)");
    expect(BINDINGS).toContain('projectSectionHref(projectId, "agent")');
  });

  it("addresses a Move through the plan surface", () => {
    expect(BINDINGS).toContain(
      'planMoveHref(projectSectionHref(projectId, "action-plan"), opportunityId)',
    );
  });

  it("builds no URL by hand", () => {
    /* One place builds these, so a link and its anchor cannot drift apart. */
    expect(BINDINGS).not.toMatch(/`\/app\/projects\//);
  });
});
