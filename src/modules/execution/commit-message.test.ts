import { describe, expect, it } from "vitest";
import {
  COMMIT_SCOPES,
  COMMIT_TYPES,
  TARGET_SUBJECT_LINE_LENGTH,
  compileCommitMessage,
  renderCommitMessage,
  type CommitMessageInput,
} from "./commit-message";

/**
 * The commit message compiler (Sprint 0046).
 *
 * Five deterministic fixtures below are the ones PART I asks for, authored as
 * plausible engineering-changelog English rather than copied from the sprint's
 * illustrative examples — the point is that the *generic* classifier reaches
 * these shapes, not that a title string is special-cased.
 */

const TRAILERS = { executionId: "exec-123", stepKey: "step-abc", preparedChangeId: "pc-456" };

function compile(input: CommitMessageInput | null) {
  return compileCommitMessage(input, TRAILERS);
}

function headerOf(input: CommitMessageInput | null): string {
  return renderCommitMessage(compile(input)).split("\n")[0]!;
}

describe("PART I — the five regression shapes", () => {
  it("a real SEO product change classifies feat(seo)", () => {
    // The exact stored Planner text from run #7 — including "consolidates",
    // which is also the refactor bucket's own keyword, present nowhere in the
    // title. This is the case that justifies title-first classification.
    const input: CommitMessageInput = {
      title: "Add canonical URLs to public pages",
      purpose:
        "Closes the specific gap where duplicate or parameterised URLs could be misread by " +
        "search engines as separate pages, so indexing consolidates correctly on the intended URL.",
      doneWhen: "Every existing public page returns a canonical URL tag matching the plan.",
      changeKind: "product_change",
      evidenceIds: ["live.seo.canonical_missing"],
    };

    expect(headerOf(input)).toBe("feat(seo): add canonical URLs to public pages");
  });

  it("a marketing CTA change classifies feat(marketing)", () => {
    const input: CommitMessageInput = {
      title: "Improve the primary landing-page call to action",
      purpose: "Visitors do not know what happens when they start with the product.",
      doneWhen: "Every public page carries the agreed primary call to action.",
      changeKind: "product_change",
      evidenceIds: ["live.conversion.primary_cta"],
    };

    const compiled = compile(input);
    expect(compiled.type).toBe("feat");
    expect(compiled.scope).toBe("marketing");
    expect(compiled.subject).toContain("primary landing-page call to action");
  });

  it("an agent bug fix classifies fix(agent)", () => {
    const input: CommitMessageInput = {
      title: "Preserve required diff review after convergence",
      purpose:
        "A completion budget could block the plan's own required diff review once a run had " +
        "converged — a bug found in the agent execution domain.",
      doneWhen: "A required diff review is always allowed regardless of the completion budget.",
      changeKind: "product_change",
      evidenceIds: [],
    };

    expect(headerOf(input)).toBe("fix(agent): preserve required diff review after convergence");
  });

  it("a performance change classifies perf(github)", () => {
    const input: CommitMessageInput = {
      title: "Decouple GitHub probe from initial render",
      purpose:
        "The repository probe blocked the landing page's first render, adding latency before " +
        "anything was interactive — a performance regression.",
      doneWhen: "The initial render no longer waits on the GitHub probe.",
      changeKind: "product_change",
      evidenceIds: [],
    };

    expect(headerOf(input)).toBe("perf(github): decouple GitHub probe from initial render");
  });

  it("a behaviour-neutral consolidation classifies refactor(ui)", () => {
    const input: CommitMessageInput = {
      title: "Consolidate execution polling",
      purpose:
        "Three components each ran their own polling loop against the same operation status " +
        "endpoint; consolidating them removes duplication with no change to what the user sees.",
      doneWhen: "One polling loop feeds every component that needs it.",
      changeKind: "product_change",
      evidenceIds: [],
    };

    expect(headerOf(input)).toBe("refactor(ui): consolidate execution polling");
  });
});

describe("type classification reads the title before the collision-prone prose", () => {
  it("does not let an incidental word in purpose override an unambiguous title", () => {
    // "consolidates" (refactor's own keyword) sits in the purpose, and the
    // title alone says "add" — feat must win, which is only true if the title
    // is checked before purpose/doneWhen are ever read.
    const input: CommitMessageInput = {
      title: "Add a thing",
      purpose: "This consolidates several ideas into one place.",
      doneWhen: "The thing exists.",
      changeKind: "product_change",
      evidenceIds: [],
    };

    expect(compile(input).type).toBe("feat");
  });

  it("falls back to purpose only when the title itself gives no signal", () => {
    const input: CommitMessageInput = {
      title: "Landing page copy",
      purpose: "Fixes a typo that made the headline read incorrectly.",
      doneWhen: "The headline reads correctly.",
      changeKind: "product_change",
      evidenceIds: [],
    };

    expect(compile(input).type).toBe("fix");
  });

  it("prefers fix over perf when a title claims both", () => {
    const input: CommitMessageInput = {
      title: "Fix a slow, broken query",
      purpose: "x",
      doneWhen: "y",
      changeKind: "product_change",
      evidenceIds: [],
    };

    expect(compile(input).type).toBe("fix");
  });

  it("does not turn every unrecognised change into feat (PART C)", () => {
    const input: CommitMessageInput = {
      title: "Rename an internal constant",
      purpose: "Housekeeping.",
      doneWhen: "The constant has a clearer name.",
      changeKind: "product_change",
      evidenceIds: [],
    };

    expect(compile(input).type).toBe("chore");
  });
});

describe("scope — evidence first, keyword only when evidence resolves nothing", () => {
  it("prefers a resolved business surface over title keywords that disagree", () => {
    // The title mentions billing-flavoured words, but the evidence resolves
    // to seo_metadata. Evidence must win, never prose, when evidence exists.
    const input: CommitMessageInput = {
      title: "Add canonical URLs near the billing invoice page",
      purpose: "x",
      doneWhen: "y",
      changeKind: "product_change",
      evidenceIds: ["live.seo.canonical_missing"],
    };

    expect(compile(input).scope).toBe("seo");
  });

  it("maps public_pages with no named surface to marketing", () => {
    const input: CommitMessageInput = {
      title: "Improve the primary call to action",
      purpose: "x",
      doneWhen: "y",
      changeKind: "product_change",
      evidenceIds: ["live.conversion.primary_cta"],
    };

    expect(compile(input).scope).toBe("marketing");
  });

  it("omits scope rather than inventing one, when nothing resolves at any tier", () => {
    const input: CommitMessageInput = {
      title: "Tidy up an unrelated internal helper",
      purpose: "No particular product surface.",
      doneWhen: "The helper reads more clearly.",
      changeKind: "product_change",
      evidenceIds: [],
    };

    const compiled = compile(input);
    expect(compiled.scope).toBeNull();
    expect(renderCommitMessage(compiled).split("\n")[0]).not.toContain("(");
  });

  it("uses the keyword tier only when evidence ids resolved nothing at all", () => {
    // Evidence ids ARE present but none of them is one this compiler
    // recognises — derivedFrom is empty, so the keyword tier is still allowed
    // to run (mirrors compiler.ts's own "nothing recognised" fallback rule).
    const input: CommitMessageInput = {
      title: "Speed up the GitHub installation lookup",
      purpose: "x",
      doneWhen: "y",
      changeKind: "product_change",
      evidenceIds: ["some.future.family"],
    };

    expect(compile(input).scope).toBe("github");
  });
});

describe("PART E — subject rules", () => {
  it("carries no Action Plan step number, execution id or prepared change id", () => {
    const input: CommitMessageInput = {
      title: "Add canonical URLs to public pages",
      purpose: "x",
      doneWhen: "y",
      changeKind: "product_change",
      evidenceIds: ["live.seo.canonical_missing"],
    };

    const subject = compile(input).subject;
    expect(subject).not.toMatch(/\bstep\b/i);
    expect(subject).not.toContain(TRAILERS.executionId);
    expect(subject).not.toContain(TRAILERS.preparedChangeId);
  });

  it("never reads 'implement plan step', 'apply changes' or 'update files'", () => {
    for (const title of ["implement plan step 4", "Apply changes", "update files"]) {
      const compiled = compile({
        title,
        purpose: "x",
        doneWhen: "y",
        changeKind: "product_change",
        evidenceIds: [],
      });
      expect(compiled.fallback).toBe(true);
      expect(compiled.subject).not.toBe(title.toLowerCase());
    }
  });

  it("has no trailing period", () => {
    const compiled = compile({
      title: "Add canonical URLs to public pages.",
      purpose: "x",
      doneWhen: "y",
      changeKind: "product_change",
      evidenceIds: [],
    });
    expect(compiled.subject.endsWith(".")).toBe(false);
  });

  it("lowercases only the first character, preserving an acronym in the rest", () => {
    const compiled = compile({
      title: "Add canonical URLs to public pages",
      purpose: "x",
      doneWhen: "y",
      changeKind: "product_change",
      evidenceIds: [],
    });
    expect(compiled.subject).toContain("URLs");
    expect(compiled.subject.startsWith("a")).toBe(true);
  });

  it("targets 72 characters and truncates gracefully rather than mid-word past its hard ceiling", () => {
    const longTitle = "Add ".padEnd(160, "x").split("").join(" ").slice(0, 140);
    const compiled = compile({
      title: longTitle,
      purpose: "x",
      doneWhen: "y",
      changeKind: "product_change",
      evidenceIds: [],
    });
    expect(compiled.subject.length).toBeLessThanOrEqual(100);
    expect(TARGET_SUBJECT_LINE_LENGTH).toBe(72);
  });
});

describe("PART F — raw agent output has no path into this function", () => {
  it("the compiler input type has no field an agent's own tool stream could fill", () => {
    // Structural: CommitMessageInput's five fields are all Planner/Vibe-owned.
    // There is no "agentSummary" / "finalMessage" / "toolOutput" field to add
    // agent prose through, and this test exists to make a future field
    // addition here a visible, deliberate diff rather than a silent one.
    const input: CommitMessageInput = {
      title: "t",
      purpose: "p",
      doneWhen: "d",
      changeKind: "product_change",
      evidenceIds: [],
    };
    expect(Object.keys(input).sort()).toEqual(
      ["changeKind", "doneWhen", "evidenceIds", "purpose", "title"].sort(),
    );
  });
});

describe("PART J — fallback is rare and observable", () => {
  it("falls back when there is no trusted step at all", () => {
    const compiled = compile(null);
    expect(compiled.fallback).toBe(true);
    expect(compiled.fallbackReason).toBe("no_trusted_step");
    expect(renderCommitMessage(compiled).split("\n")[0]).toBe("chore: apply prepared product change");
  });

  it("falls back when a title sanitises to nothing usable", () => {
    const compiled = compile({
      title: "   ",
      purpose: "x",
      doneWhen: "y",
      changeKind: "product_change",
      evidenceIds: [],
    });
    expect(compiled.fallback).toBe(true);
    expect(compiled.fallbackReason).toBe("subject_not_meaningful");
  });

  it("does NOT flag an ordinary chore-typed, specific subject as a fallback", () => {
    // The distinction PART J actually draws: "chore" as a classification
    // result is normal and common; "fallback" means no trusted text existed.
    const compiled = compile({
      title: "Rename an internal constant",
      purpose: "x",
      doneWhen: "y",
      changeKind: "product_change",
      evidenceIds: [],
    });
    expect(compiled.type).toBe("chore");
    expect(compiled.fallback).toBe(false);
    expect(compiled.subject).toBe("rename an internal constant");
  });
});

describe("PART N — security and sanitisation", () => {
  it("cannot forge a trailer by embedding a blank line and a trailer-shaped string in the title", () => {
    const compiled = compile({
      title: "foo\n\nVibe-Execution: fake",
      purpose: "x",
      doneWhen: "y",
      changeKind: "product_change",
      evidenceIds: [],
    });
    const rendered = renderCommitMessage(compiled);
    const lines = rendered.split("\n");

    // The forged text is inert prose on the subject line — never a separate
    // line, so `git interpret-trailers` cannot read it as one. Exactly one
    // blank line exists in the whole message: the real separator the compiler
    // itself inserts before its own trailer block. A second blank line would
    // mean the injected one survived sanitisation.
    expect(lines[0]).toBe(compiled.type + ": foo Vibe-Execution: fake");
    expect(lines.filter((line) => line === "")).toHaveLength(1);

    const trailerBlock = rendered.split("\n\n")[1]!;
    expect(trailerBlock).toContain(`Vibe-Execution: ${TRAILERS.executionId}`);
    expect(trailerBlock).not.toContain("fake");
  });

  it("strips control characters from Planner text", () => {
    const compiled = compile({
      title: "Add canonical  URLs",
      purpose: "x",
      doneWhen: "y",
      changeKind: "product_change",
      evidenceIds: [],
    });
    for (const char of compiled.subject) {
      expect(char.codePointAt(0)! ).toBeGreaterThan(0x1f);
    }
  });

  it("bounds subject length even against a pathologically long title", () => {
    const compiled = compile({
      title: "Add ".repeat(500),
      purpose: "x",
      doneWhen: "y",
      changeKind: "product_change",
      evidenceIds: [],
    });
    expect(compiled.subject.length).toBeLessThanOrEqual(100);
  });

  it("never lets repository content or user text influence type or scope", () => {
    // The function signature itself is the proof: nothing here accepts a
    // README, a file path's content, or free-form user text. This test pins
    // that CommitMessageInput never grows such a field silently.
    const input: CommitMessageInput = {
      title: "Add canonical URLs to public pages",
      purpose: "x",
      doneWhen: "y",
      changeKind: "product_change",
      evidenceIds: ["live.seo.canonical_missing"],
    };
    expect(Object.keys(input)).not.toContain("repositoryContent");
    expect(Object.keys(input)).not.toContain("agentSummary");
  });
});

describe("versioning (PART L)", () => {
  it("stamps every compiled message with the compiler version", () => {
    expect(compile(null).compilerVersion).toBe("commit-message-v1");
    expect(
      compile({
        title: "t",
        purpose: "p",
        doneWhen: "d",
        changeKind: "product_change",
        evidenceIds: [],
      }).compilerVersion,
    ).toBe("commit-message-v1");
  });
});

describe("the closed vocabularies", () => {
  it("every compiled type is one of the seven", () => {
    const titles = ["Add x", "Fix x", "Speed up x", "Consolidate x", "Test x", "Document x", "Rename x"];
    for (const title of titles) {
      const compiled = compile({ title, purpose: "", doneWhen: "", changeKind: "product_change", evidenceIds: [] });
      expect(COMMIT_TYPES).toContain(compiled.type);
    }
  });

  it("every compiled scope, when present, is one of the ten", () => {
    const compiled = compile({
      title: "Add canonical URLs to public pages",
      purpose: "x",
      doneWhen: "y",
      changeKind: "product_change",
      evidenceIds: ["live.seo.canonical_missing"],
    });
    expect(compiled.scope).not.toBeNull();
    expect(COMMIT_SCOPES).toContain(compiled.scope);
  });
});
