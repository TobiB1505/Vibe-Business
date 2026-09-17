import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_SECTIONS, PROJECT_SUBSECTIONS } from "@/components/layout/project-shell";
import { BLOCK_FOR_MOMENT, BLOCK_FOR_OPERATION, type BlockKind } from "@/modules/nova/blocks";
import {
  ARTIFACT_FOR_BLOCK,
  ARTIFACT_KINDS,
  ARTIFACT_SEGMENT,
  ARTIFACT_SOURCES,
  artifactHref,
  type ArtifactKind,
} from "./artifacts";

/**
 * The registry describes a workspace that exists ([ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md) §4).
 *
 * Three claims, and every one of them is a claim about *other files*, which is
 * why none of them can be made by the compiler alone:
 *
 * 1. **Every kind has an address**, and the address is a section a founder can
 *    already reach. A registry is free to invent a URL; nothing would notice
 *    until a founder clicked it.
 * 2. **Every kind has a read and a view.** The registry names them as text so
 *    it can stay data — importing them would pull ten features' server graphs
 *    into any build that wanted one address. Text that is never checked is a
 *    comment, so it is checked here.
 * 3. **Every block kind has been decided.** Total over `BlockKind`, the same
 *    shape and the same reason as `BLOCK_FOR_MOMENT` itself.
 *
 * Nothing is rendered and nothing is read from a database, which is the
 * property `modules/nova/blocks.ts` argues for and this file inherits.
 */

const ROOT = process.cwd();

const SEGMENTS = new Set([
  ...PROJECT_SECTIONS.map((section) => section.segment),
  ...PROJECT_SUBSECTIONS.map((section) => section.segment),
]);

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("the artifact registry", () => {
  it("lists every kind of the union, once", () => {
    expect([...ARTIFACT_KINDS].sort()).toEqual(Object.keys(ARTIFACT_SEGMENT).sort());
    expect(new Set(ARTIFACT_KINDS).size).toBe(ARTIFACT_KINDS.length);
  });

  it.each(ARTIFACT_KINDS)("%s is read at a section a founder can reach", (kind) => {
    expect(SEGMENTS).toContain(ARTIFACT_SEGMENT[kind]);
  });

  it.each(ARTIFACT_KINDS)("%s names a read model that exists", (kind) => {
    const [module, symbol] = ARTIFACT_SOURCES[kind].read;
    expect(existsSync(join(ROOT, module)), module).toBe(true);
    expect(source(module)).toMatch(
      new RegExp(`export (async function|function|const) ${symbol}\\b`),
    );
  });

  it.each(ARTIFACT_KINDS)("%s names at least one view that exists", (kind) => {
    const views = ARTIFACT_SOURCES[kind].views;
    expect(views.length).toBeGreaterThan(0);

    for (const [module, symbol] of views) {
      expect(existsSync(join(ROOT, module)), module).toBe(true);
      expect(source(module)).toMatch(
        new RegExp(`export (async function|function|const) ${symbol}\\b`),
      );
    }
  });

  /**
   * The registry holds no view of its own (ADR 0109 §4).
   *
   * "One view, two frames, and no copies" is the whole argument for a registry
   * rather than a renderer, and a `.tsx` file appearing in this directory is
   * what breaking it would look like. The host draws a frame; the pixels come
   * from the feature that owns the object.
   */
  it("draws nothing itself", () => {
    const frame = source("src/features/workspace/host/artifact-open.ts");
    expect(frame).not.toContain("<");
    expect(source("src/features/workspace/registry/artifacts.ts")).not.toContain("react");
  });

  /**
   * Opening an artifact is a read at an address, and nothing else.
   *
   * The registry sits one step from every priced operation in the product —
   * it names the Move, the audit, the agent run — and a directory that resolved
   * an artifact by *starting* the thing that produces it would spend a
   * founder's Credits by rendering a screen. Rule 60 says blocked work explains
   * what needs refreshing and the founder starts it; rule 47 counts every paid
   * call. Both survive by this directory holding no command at all.
   */
  it.each([
    "src/features/workspace/registry/artifacts.ts",
    "src/features/workspace/host/artifact-open.ts",
  ])("%s starts nothing and reads nothing", (file) => {
    const text = source(file);

    expect(text).not.toContain('"use server"');
    expect(text).not.toMatch(/\bstart[A-Z]\w*Operation\b/);
    expect(text).not.toContain("createClient");
    expect(text).not.toContain("createServiceClient");
    expect(text).not.toContain("Action(");
  });
});

describe("what a block opens", () => {
  it("decides every block kind, and names only kinds that exist", () => {
    const kinds = new Set<string>(ARTIFACT_KINDS);

    for (const [block, artifact] of Object.entries(ARTIFACT_FOR_BLOCK)) {
      if (artifact !== null) expect(kinds, block).toContain(artifact);
    }
  });

  /**
   * Every block the product can actually draw is decided here.
   *
   * The compiler already makes the record total over `BlockKind`. What it
   * cannot say is that the union and the two tables that produce it still
   * agree — so this asks the producers: every block a moment raises and every
   * block a run in flight raises is a row here. `blocks.ts` exports no list of
   * its kinds, and inventing one beside the union would be the copy these
   * records exist to avoid; the values of the two total tables *are* the list.
   */
  it("covers every block the product can draw", () => {
    const reachable = new Set<BlockKind>([
      ...Object.values(BLOCK_FOR_MOMENT),
      ...Object.values(BLOCK_FOR_OPERATION),
    ]);

    for (const block of reachable) {
      expect(Object.keys(ARTIFACT_FOR_BLOCK), block).toContain(block);
    }
    expect(reachable.size).toBeGreaterThan(1);
  });

  /**
   * A run is an event, not an object.
   *
   * `progress` draws the named stages of something still happening and `none`
   * draws nothing at all. Neither has a page that shows more than the thread
   * does, so a link on either would take a founder away from the only surface
   * telling them anything. Written down because "it has no artifact yet" and
   * "it has no artifact" look identical in a table.
   */
  it("gives a run in flight no address", () => {
    expect(ARTIFACT_FOR_BLOCK.progress).toBeNull();
    expect(ARTIFACT_FOR_BLOCK.none).toBeNull();
  });
});

describe("an artifact's address", () => {
  const PROJECT = "project_registry";
  const BASE = `/app/projects/${PROJECT}`;

  it.each(
    ARTIFACT_KINDS.filter(
      (kind): kind is Exclude<ArtifactKind, "opportunity" | "prepared_change"> =>
        kind !== "opportunity" && kind !== "prepared_change",
    ),
  )("%s is the section itself", (kind) => {
    expect(artifactHref(PROJECT, { kind })).toBe(`${BASE}/${ARTIFACT_SEGMENT[kind]}`);
  });

  /**
   * The two that carry an id build it through the module that owns the
   * parameter, never here. ADR 0058 owns `?plan=` and `?change=`, and
   * `project-urls.ts` owns the prepared-change anchor — a second construction
   * of either is the three-owner defect Slice 3 removed.
   */
  it("opens the Action Plan on one Move", () => {
    expect(artifactHref(PROJECT, { kind: "opportunity", opportunityId: "1-pricing" })).toBe(
      `${BASE}/plan?plan=1-pricing#planned-work`,
    );
  });

  it("opens the Agent on one prepared change", () => {
    expect(artifactHref(PROJECT, { kind: "prepared_change", preparedChangeId: "change_7" })).toBe(
      `${BASE}/agent?change=change_7#prepared-change-change_7`,
    );
  });

  it("escapes an id rather than letting it shape the URL", () => {
    const href = artifactHref(PROJECT, { kind: "opportunity", opportunityId: "a&b=c" });
    expect(href).toContain("plan=a%26b%3Dc");
  });
});
