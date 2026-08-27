import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCausalClaims } from "@/modules/business-measurement/causality";

/**
 * The origin section (UI-5 dogfood).
 *
 * ## The sentence this file protects
 *
 * *A request is not a result.* The origin block shows the Move a change was
 * prepared to address — model-written, before the change existed — and every
 * assertion below is a way of that distinction being lost: the heading drifting
 * to "What Vibe changed", the disclaimer picking up a condition, or the block
 * appearing beside a written rationale as if the two were the same claim.
 *
 * ## Why it exists at all
 *
 * The first real prepared change to reach this card was agent-produced, and
 * `businessRationaleFor("agentic_execution_v1")` is null — so the card rendered
 * a status line and then a branch name, with nothing in between. That is the
 * screen UI-5 was written to replace, reappearing for the change type the
 * product is moving toward.
 */

const DIR = join(process.cwd(), "src/app/app/projects/[projectId]");

function source(file: string): string {
  return readFileSync(join(DIR, file), "utf8");
}

/** Comments quote the phrases the copy assertions forbid — strip them first. */
function renderedCopy(file: string): string {
  return source(file)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

describe("the origin says what was asked for, never what was achieved", () => {
  const src = source("change-origin.tsx");
  const copy = renderedCopy("change-origin.tsx");

  it("does not call a request a change", () => {
    // "What Vibe changed" belongs to the rationale, which is written from what
    // a capability deterministically emits. Reusing it here would put a
    // model's description of a problem under a heading claiming it describes
    // what happened.
    expect(copy).not.toContain("What Vibe changed");
    expect(copy).toContain("What this change was for");
  });

  it("always renders the disclaimer, unconditionally", () => {
    // Without it the two paragraphs read as a finding. Same rule, and same
    // reason, as `rationale.limitations`.
    expect(copy).toContain("It does not describe what the change did");
    expect(src).not.toMatch(/\{[^}]*&&[^}]*does not describe what the change did/);
  });

  it("renders nothing at all when there is no Move to show", () => {
    expect(src).toMatch(/if \(!origin\) return null/);
  });

  it("makes no claim of its own", () => {
    // Only the static copy is checked. The Move's own text is model output the
    // user has already read on Next moves, and rewriting it here would make
    // two views of one paragraph disagree.
    expect(findCausalClaims(copy)).toEqual([]);
    expect(copy).not.toMatch(/\d+\s*%/);

    for (const forbidden of ["Deployed", "is live", "shipped", "revenue", "growth"]) {
      expect(copy.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("takes an origin and nothing else", () => {
    // It cannot render a verification result, a metric or a merge state even
    // by mistake — the same containment the rationale component has.
    const imports = src
      .split("\n")
      .filter((line) => line.trimStart().startsWith("import"))
      .join("\n");

    expect(imports).toContain("change-origin");
    expect(imports).not.toContain("outcome-verification");
    expect(imports).not.toContain("business-measurement");
    expect(imports).not.toContain("merge");
  });
});

describe("the card shows one answer to why, not two", () => {
  const section = source("prepared-changes-section.tsx");

  it("renders the origin only when no written rationale exists", () => {
    expect(section).toContain("{!change.rationale && (");
    expect(section).toContain("<ChangeOrigin");
  });

  /**
   * The way back is not a second answer to "why" (UI-S3 §4).
   *
   * A change with a written rationale renders no origin block, which left it
   * the one kind that named its Move nowhere. It now gets a one-line link —
   * and the guard is that this stays a link: the two are mutually exclusive on
   * `change.rationale`, so a card can never carry both accounts at once.
   */
  it("offers the Move as a link where the rationale replaced the origin", () => {
    expect(section).toContain("{change.rationale && change.origin && change.opportunityId && (");
    expect(section).toContain("<MoveBacklink");
    expect(section).toContain("planMoveHref(planHref, change.opportunityId)");
  });

  it("links to the Move rather than restating it", () => {
    const backlink = source("change-origin.tsx");
    const component = backlink.slice(backlink.indexOf("export function MoveBacklink"));
    // The title and a link. No problem, no whyNow, no second paragraph.
    expect(component).toContain("{title}");
    expect(component).not.toContain("problem");
    expect(component).not.toContain("whyNow");
  });

  it("keeps it in the meaning slot, above the git identity", () => {
    // Both answer "what is this and why" and belong in the same place: first,
    // where the branch name used to be.
    expect(section.indexOf("<ChangeOrigin")).toBeGreaterThan(section.indexOf("<ChangeRationale"));
    expect(section.indexOf("<ChangeOrigin")).toBeLessThan(section.indexOf("{change.branchName}"));
  });
});
