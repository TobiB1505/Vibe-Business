import { describe, expect, it } from "vitest";
import { EMPTY_SURFACE_REQUIREMENT } from "./surface";
import { renderExecutionBrief } from "./render";
import { BRIEF_BUDGET, type ContextFact, type ExecutionBrief, type FileCandidate } from "./brief";

function fact(overrides: Partial<ContextFact> = {}): ContextFact {
  return {
    subject: "framework",
    value: "Next.js",
    source: "repository_scan",
    confidence: "high",
    evidence: [{ path: "package.json", revision: "abc123" }],
    ...overrides,
  };
}

function candidate(overrides: Partial<FileCandidate> = {}): FileCandidate {
  return {
    path: "src/app/layout.tsx",
    reason: "layout",
    confidence: "medium",
    note: "layout for /",
    ...overrides,
  };
}

function brief(overrides: Partial<ExecutionBrief> = {}): ExecutionBrief {
  return {
    briefVersion: "execution-brief.v1",
    task: "Stop crawlers indexing the dashboard",
    businessIntent: "Signed-in pages are being indexed.",
    doneWhen: "The dashboard is marked noindex.",
    facts: [fact()],
    fileCandidates: [candidate()],
    likelyIrrelevantAreas: ["supabase", "docs"],
    live: { origin: null, relationToRepository: "unknown" },
    freshness: {
      state: "fresh",
      snapshotSha: "abc123",
      executionSha: "abc123",
      snapshotId: "snap-1",
    },
    truncated: { factsOmitted: 0, candidatesOmitted: 0 },
    // Observability only — the renderer must never put any of this in the
    // prompt, which is asserted below rather than assumed.
    repositoryScale: {
      treeEntries: 1420,
      filesAnalyzed: 37,
      bytesAnalyzed: 412_000,
      routesDetected: 26,
      surfacesDetected: 4,
      candidatesAvailable: 19,
    },
    surface: {
      requirement: EMPTY_SURFACE_REQUIREMENT,
      publicPagesResolved: 0,
      publicPagesIncluded: 0,
      authenticatedPagesResolved: 0,
      authenticatedPagesIncluded: 0,
    },
    ...overrides,
  };
}

describe("rendering", () => {
  it("states the commit the facts were established at", () => {
    const rendered = renderExecutionBrief(brief());

    expect(rendered.text).toContain("abc123");
    expect(rendered.factsRendered).toBe(1);
    expect(rendered.candidatesRendered).toBe(1);
  });

  /**
   * `repositoryScale` is observability, and observability that leaks into the
   * prompt is paid for by the token (Sprint 0053). The brief has a hard byte
   * budget precisely because every field on it costs money if rendered, so the
   * separation is asserted rather than trusted to a reviewer noticing.
   */
  it("never renders the repository-scale counters into the prompt", () => {
    const rendered = renderExecutionBrief(brief());

    for (const value of ["1420", "412000", "412,000", "candidatesAvailable"]) {
      expect(rendered.text).not.toContain(value);
    }
  });

  it("carries provenance on every fact, so nothing reads as an assertion by Vibe", () => {
    const rendered = renderExecutionBrief(brief());

    expect(rendered.text).toContain("[repo scan, high]");
    expect(rendered.text).toContain("seen in package.json");
  });

  it("keeps the stale warning even though nothing else survives it", () => {
    const rendered = renderExecutionBrief(
      brief({
        facts: [],
        fileCandidates: [],
        likelyIrrelevantAreas: [],
        freshness: {
          state: "stale",
          snapshotSha: "old",
          executionSha: "new",
          snapshotId: "snap-1",
        },
      }),
    );

    expect(rendered.text).toContain("different commit");
    expect(rendered.factsRendered).toBe(0);
  });

  it("never exceeds the byte ceiling, whatever it is handed", () => {
    const rendered = renderExecutionBrief(
      brief({
        facts: Array.from({ length: 20 }, (_, index) =>
          fact({ value: `${"framework-".repeat(18)}${index}` }),
        ),
        fileCandidates: Array.from({ length: 12 }, (_, index) =>
          candidate({ path: `src/app/${"deeply-nested/".repeat(10)}page-${index}.tsx` }),
        ),
      }),
    );

    expect(rendered.bytes).toBeLessThanOrEqual(BRIEF_BUDGET.maxRenderedBytes);
  });

  it("says what it left out rather than presenting a squeezed brief as the whole", () => {
    const rendered = renderExecutionBrief(
      brief({
        facts: Array.from({ length: 60 }, (_, index) =>
          fact({ value: `${"a-very-long-fact-value ".repeat(8)}${index}` }),
        ),
        truncated: { factsOmitted: 4, candidatesOmitted: 0 },
      }),
    );

    expect(rendered.text).toContain("Vibe knows more than this");
    // Selection dropped four; the byte budget dropped the rest.
    expect(rendered.factsOmitted).toBeGreaterThan(4);
  });

  it("does not imply a deployed origin is the code being edited", () => {
    const rendered = renderExecutionBrief(
      brief({ live: { origin: "https://acme.example", relationToRepository: "unknown" } }),
    );

    expect(rendered.text).toContain("is not known");
  });
});
