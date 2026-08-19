import { describe, expect, it } from "vitest";
import { summarizeContextUsage } from "./usage";

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
    const usage = summarizeContextUsage({ candidates: [], readPaths: [] });

    expect(Object.keys(usage).sort()).toEqual([
      "candidatesOffered",
      "candidatesRead",
      "filesReadOutsideContext",
      "repeatedFileReads",
      "uniqueFilesRead",
    ]);
  });
});
