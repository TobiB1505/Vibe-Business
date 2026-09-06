import { describe, expect, it } from "vitest";
import { MAX_USAGE_PATHS, summarizeContextUsage } from "./usage";

describe("context usage", () => {
  it("counts what the run opened against what it was offered", () => {
    const usage = summarizeContextUsage({
      candidates: ["src/app/layout.tsx", "src/app/robots.ts", "src/app/page.tsx"],
      readPaths: ["src/app/layout.tsx", "package.json", "src/app/layout.tsx"],
    });

    expect(usage).toEqual({
      candidatesOffered: 3,
      candidatesRead: 1,
      uniqueFilesRead: 2,
      repeatedFileReads: 1,
      filesReadOutsideContext: 1,
      // The two counts above, said as paths. Counting was the old answer and it
      // could report that the briefing missed without ever saying what it
      // missed — which is not enough to change a ranking with.
      unreadCandidates: ["src/app/robots.ts", "src/app/page.tsx"],
      readOutsideContext: ["package.json"],
      pathsTruncated: false,
    });
  });

  it("records a run that ignored the whole briefing as exactly that", () => {
    const usage = summarizeContextUsage({
      candidates: ["src/app/layout.tsx"],
      readPaths: ["README.md", "package.json"],
    });

    expect(usage.candidatesRead).toBe(0);
    expect(usage.filesReadOutsideContext).toBe(2);
  });

  it("compares paths exactly, so two different files never collapse into one", () => {
    const usage = summarizeContextUsage({
      candidates: ["src/App.tsx"],
      readPaths: ["src/app.tsx"],
    });

    expect(usage.candidatesRead).toBe(0);
    expect(usage.filesReadOutsideContext).toBe(1);
  });

  it("says nothing about correctness — there is no verdict field to misread", () => {
    /*
     * The list grew and the property did not. Every field is a count or a path:
     * nothing here says a change was good, and independent validation remains
     * the only thing that does. A `sufficient` or `coverage` field would be
     * exactly the sentence this test exists to keep out.
     */
    const usage = summarizeContextUsage({ candidates: [], readPaths: [] });

    expect(Object.keys(usage).sort()).toEqual([
      "candidatesOffered",
      "candidatesRead",
      "filesReadOutsideContext",
      "pathsTruncated",
      "readOutsideContext",
      "repeatedFileReads",
      "uniqueFilesRead",
      "unreadCandidates",
    ]);
  });

  it("keeps the brief's order for what went unread", () => {
    // `rankCandidates` already decided which candidate Vibe was most confident
    // about. A top-ranked file going unread is a different fact from the last
    // one going unread, and a set cannot tell them apart.
    const usage = summarizeContextUsage({
      candidates: ["first.ts", "second.ts", "third.ts"],
      readPaths: ["second.ts"],
    });

    expect(usage.unreadCandidates).toEqual(["first.ts", "third.ts"]);
  });

  it("keeps first-read order for what it was not offered", () => {
    // What the agent reached for first is the strongest evidence about what the
    // briefing should have led with.
    const usage = summarizeContextUsage({
      candidates: [],
      readPaths: ["wanted-most.ts", "then-this.ts", "wanted-most.ts"],
    });

    expect(usage.readOutsideContext).toEqual(["wanted-most.ts", "then-this.ts"]);
  });

  it("bounds each list and says when it cut one", () => {
    /*
     * Paths are repository-controlled, so a run that read four hundred files
     * would otherwise write four hundred of them into a telemetry row
     * (rule 27). The counters stay exact whatever this cuts, which is why a
     * consumer must count from them and not from the list.
     */
    const many = Array.from({ length: MAX_USAGE_PATHS + 5 }, (_, index) => `f${index}.ts`);
    const usage = summarizeContextUsage({ candidates: [], readPaths: many });

    expect(usage.readOutsideContext).toHaveLength(MAX_USAGE_PATHS);
    expect(usage.filesReadOutsideContext).toBe(MAX_USAGE_PATHS + 5);
    expect(usage.pathsTruncated).toBe(true);
  });
});
