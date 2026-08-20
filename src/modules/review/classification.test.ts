import { describe, expect, it } from "vitest";
import {
  EXECUTION_SURFACE_REQUIREMENT_VERSION,
  type ExecutionSurfaceRequirement,
  type ResolvedExecutionSurface,
} from "@/modules/execution-context/surface";
import {
  REVIEW_CLASSIFICATION_VERSION,
  classifyReview,
  type ClassifyReviewInput,
} from "./classification";

/**
 * Review classification (Sprint 0048).
 *
 * The property under test is that the decision follows the *artifact* — the
 * paths Vibe verified and the analyzer's own route table — and never the
 * intention behind the change. A test that only proved "a page is visual" would
 * pass on a classifier that returned `visual` for everything, so every fixture
 * below is paired with its opposite.
 */

function route(path: string, sourcePath: string) {
  return { path, sourcePath, confidence: "high" as const, liveObserved: true };
}

/** A route table shaped like this repository's own. */
const SURFACE: ResolvedExecutionSurface = {
  publicPages: [route("/", "src/app/page.tsx"), route("/privacy", "src/app/privacy/page.tsx")],
  authenticatedPages: [route("/app", "src/app/app/page.tsx")],
  authenticatedRoots: ["src/app/app"],
  corroboratedByLiveScan: true,
};

const REQUIREMENT: ExecutionSurfaceRequirement = {
  requirementVersion: EXECUTION_SURFACE_REQUIREMENT_VERSION,
  scopes: ["public_pages"],
  surfaces: [],
  derivedFrom: ["live.conversion.primary_cta"],
  unrecognised: [],
};

function input(overrides: Partial<ClassifyReviewInput> = {}): ClassifyReviewInput {
  return { changedPaths: [], surface: SURFACE, requirement: REQUIREMENT, ...overrides };
}

describe("PART E — the three required fixtures", () => {
  it("fixture 1: a landing-page CTA change is VISUAL", () => {
    const result = classifyReview(
      input({ changedPaths: ["src/app/page.tsx", "src/components/marketing/hero.tsx"] }),
    );

    expect(result.classification).toBe("visual");
    expect(result.codePaths).toEqual([]);
    // The route table named the page, so the recommendation can say which one.
    expect(result.routes).toEqual(["/"]);
  });

  it("fixture 2: a backend change is CODE", () => {
    const result = classifyReview(
      input({
        changedPaths: [
          "src/app/api/billing/route.ts",
          "src/modules/billing/ledger.ts",
          "supabase/migrations/20260101_credits.sql",
        ],
      }),
    );

    expect(result.classification).toBe("code");
    expect(result.visualPaths).toEqual([]);
    expect(result.routes).toEqual([]);
  });

  it("fixture 3: a UI and backend change is VISUAL_AND_CODE", () => {
    const result = classifyReview(
      input({
        changedPaths: ["src/components/pricing-card.tsx", "src/app/api/billing/route.ts"],
      }),
    );

    expect(result.classification).toBe("visual_and_code");
    expect(result.visualPaths).toEqual(["src/components/pricing-card.tsx"]);
    expect(result.codePaths).toEqual(["src/app/api/billing/route.ts"]);
  });
});

describe("the route table is consulted before any structural rule", () => {
  it("treats a file the analyzer says serves a route as visual, whatever its shape", () => {
    // An .mdx page would fail every structural pattern. The analyzer says it
    // serves `/handbook`, and the analyzer is describing this repository.
    const surface: ResolvedExecutionSurface = {
      ...SURFACE,
      publicPages: [route("/handbook", "content/handbook.mdx")],
    };

    const result = classifyReview(input({ changedPaths: ["content/handbook.mdx"], surface }));

    expect(result.classification).toBe("visual");
    expect(result.routes).toEqual(["/handbook"]);
  });

  it("still classifies when route analysis produced nothing", () => {
    // `limited` or `none` analysis yields a null surface. That degrades the
    // explanation, not the answer.
    const result = classifyReview(
      input({ changedPaths: ["src/app/page.tsx"], surface: null, requirement: null }),
    );

    expect(result.classification).toBe("visual");
    expect(result.routes).toEqual([]);
    expect(result.scopes).toEqual([]);
  });

  it("names an authenticated route as readily as a public one", () => {
    const result = classifyReview(input({ changedPaths: ["src/app/app/page.tsx"] }));

    expect(result.classification).toBe("visual");
    expect(result.routes).toEqual(["/app"]);
  });
});

describe("CODE is the fallback, in both directions", () => {
  it("classifies a change with no paths at all as CODE, never VISUAL", () => {
    const result = classifyReview(input({ changedPaths: [] }));

    expect(result.classification).toBe("code");
  });

  it("does not treat a route handler under src/app as visual", () => {
    // The .ts / .tsx distinction is the whole guard, so it gets its own test.
    expect(classifyReview(input({ changedPaths: ["src/app/api/x/route.ts"] })).classification).toBe(
      "code",
    );
    expect(classifyReview(input({ changedPaths: ["src/app/actions.ts"] })).classification).toBe(
      "code",
    );
  });

  it("does not let a test file named after a page buy a visual review", () => {
    const result = classifyReview(
      input({ changedPaths: ["e2e/first-ten-minutes.spec.ts", "src/modules/billing/ledger.ts"] }),
    );

    expect(result.classification).toBe("code");
    expect(result.visualPaths).toEqual([]);
  });

  it("keeps a page visual even when the change also edits its spec", () => {
    const result = classifyReview(
      input({ changedPaths: ["src/app/page.tsx", "e2e/auth.spec.ts"] }),
    );

    expect(result.classification).toBe("visual_and_code");
    expect(result.visualPaths).toEqual(["src/app/page.tsx"]);
    expect(result.codePaths).toEqual(["e2e/auth.spec.ts"]);
  });
});

describe("the result describes itself", () => {
  it("carries the policy version and the evidence-derived scopes", () => {
    const result = classifyReview(input({ changedPaths: ["src/app/page.tsx"] }));

    expect(result.policyVersion).toBe(REVIEW_CLASSIFICATION_VERSION);
    expect(result.scopes).toEqual(["public_pages"]);
  });

  it("partitions every changed path exactly once", () => {
    const changedPaths = [
      "src/app/page.tsx",
      "src/modules/billing/ledger.ts",
      "src/components/ui/button.tsx",
      "supabase/migrations/x.sql",
    ];

    const result = classifyReview(input({ changedPaths }));

    expect([...result.visualPaths, ...result.codePaths].sort()).toEqual([...changedPaths].sort());
  });
});

/**
 * Sprint 0048's own real inputs, so the fixtures above are not the only
 * evidence. These are the verified path lists of runs #6, #7 and #8, read from
 * `prepared_changes.files`.
 */
describe("the historical runs", () => {
  it("run #6 (two layouts) is VISUAL", () => {
    expect(
      classifyReview(input({ changedPaths: ["src/app/app/layout.tsx", "src/app/layout.tsx"] }))
        .classification,
    ).toBe("visual");
  });

  it("run #8 (CTA copy plus two e2e specs) is VISUAL_AND_CODE", () => {
    // Honest rather than flattering: the specs are real changed files and a
    // reviewer should read them. The page is still worth looking at.
    const result = classifyReview(
      input({
        changedPaths: ["e2e/auth.spec.ts", "e2e/first-ten-minutes.spec.ts", "src/app/page.tsx"],
      }),
    );

    expect(result.classification).toBe("visual_and_code");
    expect(result.routes).toEqual(["/"]);
  });
});
