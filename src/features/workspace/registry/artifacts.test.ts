import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_SECTIONS, PROJECT_SUBSECTIONS } from "@/features/shell/project-shell";
import { ARTIFACT_KINDS, parseArtifactRef, type ArtifactKind } from "@/modules/nova/artifacts";
import {
  ARTIFACT_SEGMENT,
  ARTIFACT_SOURCES,
  artifactHref,
  threadArtifactHref,
  WORKSPACE_ANCHOR,
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
 *
 * The union itself, and which artifact a block opens, are asserted beside them
 * in `src/modules/nova/artifacts.test.ts`: a kind is domain vocabulary and this
 * file is about where it is drawn.
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
  it("gives every kind of the union a place to be read", () => {
    expect([...ARTIFACT_KINDS].sort()).toEqual(Object.keys(ARTIFACT_SEGMENT).sort());
    expect([...ARTIFACT_KINDS].sort()).toEqual(Object.keys(ARTIFACT_SOURCES).sort());
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

/**
 * The workspace's own address (ADR 0109 §4, Slice 7).
 *
 * Two links per artifact and they mean two different things, which is the whole
 * reason both exist: `artifactHref` is *the thing, whole, at its own address*,
 * and `threadArtifactHref` is *the thing, beside what was said about it*. A
 * founder wants both, at different moments, and neither is a fallback for the
 * other.
 */
describe("an artifact beside its conversation", () => {
  const PROJECT = "project_1";
  const THREAD = "thread_1";

  it("keeps the conversation's own address and adds what to show", () => {
    const href = threadArtifactHref(PROJECT, THREAD, { kind: "business_health" });

    expect(href).toBe(
      `/app/projects/${PROJECT}/threads/${THREAD}?artifact=business_health#workspace`,
    );
  });

  it("carries the reference for the two kinds whose address needs one", () => {
    expect(threadArtifactHref(PROJECT, THREAD, { kind: "opportunity", opportunityId: "o1" })).toBe(
      `/app/projects/${PROJECT}/threads/${THREAD}?artifact=opportunity&ref=o1#workspace`,
    );
    expect(
      threadArtifactHref(PROJECT, THREAD, { kind: "prepared_change", preparedChangeId: "c1" }),
    ).toBe(`/app/projects/${PROJECT}/threads/${THREAD}?artifact=prepared_change&ref=c1#workspace`);
  });

  /**
   * Every kind, and the property is that the founder never leaves the thread.
   * A kind whose workspace link went somewhere else would be a kind that
   * silently replaced the conversation — which is the thing a query parameter
   * was chosen over a route to prevent.
   */
  it("never leaves the thread, for any kind", () => {
    for (const kind of ARTIFACT_KINDS) {
      const artifact = parseArtifactRef(kind, "ref_1");
      expect(artifact, kind).not.toBeNull();

      const href = threadArtifactHref(PROJECT, THREAD, artifact!);
      expect(href, kind).toContain(`/threads/${THREAD}?`);
      expect(href, kind).toContain(`#${WORKSPACE_ANCHOR}`);
    }
  });

  it("is parsed back into the artifact it named", () => {
    for (const kind of ARTIFACT_KINDS) {
      const artifact = parseArtifactRef(kind, "ref_1")!;
      const query = new URL(threadArtifactHref(PROJECT, THREAD, artifact), "https://vibe.test")
        .searchParams;

      expect(
        parseArtifactRef(query.get("artifact") ?? undefined, query.get("ref") ?? undefined),
        kind,
      ).toEqual(artifact);
    }
  });
});
