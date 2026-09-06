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
  authenticatedPages: [route("/app", "src/app/app/(account)/page.tsx")],
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
    const result = classifyReview(input({ changedPaths: ["src/app/app/(account)/page.tsx"] }));

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

  it("still partitions exactly once when a path was downgraded", () => {
    const changedPaths = ["src/app/layout.tsx", "src/modules/billing/ledger.ts"];

    const result = classifyReview(
      input({ changedPaths, provenNonRendering: ["src/app/layout.tsx"] }),
    );

    expect([...result.visualPaths, ...result.codePaths].sort()).toEqual([...changedPaths].sort());
    // Downgraded paths are a *label* on paths already counted in `codePaths`,
    // never a third bucket that would make the partition add up to more than
    // the change.
    expect(result.downgradedPaths).toEqual(["src/app/layout.tsx"]);
    expect(result.codePaths).toContain("src/app/layout.tsx");
    expect(result.visualPaths).not.toContain("src/app/layout.tsx");
  });
});

/**
 * A structural proof may only ever subtract (Sprint 0053).
 *
 * `provenNonRendering` is consulted after `isVisual` has already said yes, so
 * these are properties of *where* the check sits rather than rules the loop has
 * to remember. Both directions are asserted, because a test that only showed
 * the downgrade working would also pass on a classifier that returned `code`
 * for anything named in the list.
 */
describe("a proof can only downgrade, never upgrade", () => {
  it("cannot make a code path visual, however loudly it is proven", () => {
    const result = classifyReview(
      input({
        changedPaths: ["src/modules/billing/ledger.ts"],
        provenNonRendering: ["src/modules/billing/ledger.ts"],
      }),
    );

    expect(result.classification).toBe("code");
    expect(result.visualPaths).toEqual([]);
    // It was never visual, so there was nothing to downgrade.
    expect(result.downgradedPaths).toEqual([]);
  });

  it("leaves visualPaths a subset of what it would be without any proof", () => {
    const changedPaths = ["src/app/layout.tsx", "src/app/page.tsx", "src/components/ui/button.tsx"];

    const without = classifyReview(input({ changedPaths }));
    const with_ = classifyReview(
      input({ changedPaths, provenNonRendering: ["src/app/layout.tsx"] }),
    );

    for (const path of with_.visualPaths) expect(without.visualPaths).toContain(path);
    expect(with_.visualPaths.length).toBeLessThan(without.visualPaths.length);
  });

  it("stops naming a route once the only file serving it is downgraded", () => {
    const changedPaths = ["src/app/page.tsx"];

    expect(classifyReview(input({ changedPaths })).routes).toEqual(["/"]);
    expect(
      classifyReview(input({ changedPaths, provenNonRendering: ["src/app/page.tsx"] })).routes,
    ).toEqual([]);
  });

  it("ignores a proof for a path that did not change", () => {
    const result = classifyReview(
      input({ changedPaths: ["src/app/page.tsx"], provenNonRendering: ["src/app/other.tsx"] }),
    );

    expect(result.classification).toBe("visual");
    expect(result.downgradedPaths).toEqual([]);
  });
});

/**
 * Sprint 0048's own real inputs, so the fixtures above are not the only
 * evidence. These are the verified path lists of runs #6, #7 and #8, read from
 * `prepared_changes.files`.
 */
describe("the historical runs", () => {
  /**
   * Unchanged, and worth being precise about *why* it is still `visual`.
   *
   * The path rule alone cannot tell a layout that moved its JSX from one that
   * only edited `metadata` — that is the whole defect run #9 exposed below. So
   * with no proof supplied, two changed layouts remain visual, and that is the
   * correct conservative answer rather than a stale one.
   */
  it("run #6 (two layouts, nothing proven) is VISUAL", () => {
    expect(
      classifyReview(input({ changedPaths: ["src/app/app/layout.tsx", "src/app/layout.tsx"] }))
        .classification,
    ).toBe("visual");
  });

  /**
   * The regression, at the pure layer (Sprint 0053).
   *
   * Production run `5ea8a9a0` (2026-08-20) changed only the `metadata` export
   * in two layouts and added one test file, and was recommended a *visual*
   * review — a before/after screenshot of a page that could not have moved.
   * With `render-impact.ts`'s proof supplied, the recommendation becomes what
   * it always should have been.
   */
  it("run #9 (two metadata-only layouts plus a test) is CODE once proven", () => {
    const changedPaths = [
      "src/app/app/layout.tsx",
      "src/app/layout.tsx",
      "src/app/robots-meta.test.ts",
    ];

    const before = classifyReview(input({ changedPaths }));
    expect(before.classification).toBe("visual_and_code");

    const after = classifyReview(
      input({
        changedPaths,
        provenNonRendering: ["src/app/app/layout.tsx", "src/app/layout.tsx"],
      }),
    );

    expect(after.classification).toBe("code");
    expect(after.visualPaths).toEqual([]);
    expect(after.downgradedPaths).toEqual(["src/app/app/layout.tsx", "src/app/layout.tsx"]);
    // Nothing is photographed, so nothing names a route.
    expect(after.routes).toEqual([]);
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

/**
 * An application that does not live at the repository root.
 *
 * Every pattern here is anchored, and until Stufe 4 it was anchored at the
 * repository — the same place, while every validatable repository had its app
 * there. It is not any more, and the failure this describes is the quiet kind:
 * nothing throws, every change classifies as `code`, no preview is ever
 * recommended, `render-impact.ts` never runs, and the suite stays green.
 */
describe("the patterns are anchored at the application, not at the repository", () => {
  const PATHS = [
    "frontend/src/app/page.tsx",
    "frontend/src/components/hero.tsx",
    "frontend/src/app/globals.css",
  ];

  it("reads a page under frontend/ as visual", () => {
    const result = classifyReview(
      input({ changedPaths: PATHS, surface: null, workspaceRoot: "frontend" }),
    );

    expect(result.classification).toBe("visual");
    expect(result.visualPaths).toEqual([...PATHS].sort());
  });

  it("reads the same paths as code when the application is at the root", () => {
    // The defect, stated as the answer the old code gave for every one of them.
    const result = classifyReview(input({ changedPaths: PATHS, surface: null }));

    expect(result.classification).toBe("visual_and_code");
    // Only the stylesheet survives, because its pattern is extension-based and
    // never had a directory to be wrong about.
    expect(result.visualPaths).toEqual(["frontend/src/app/globals.css"]);
  });

  it("does not treat a sibling directory as part of the application", () => {
    // A prefix that never matched must not be trimmed off anyway: `docs/app/`
    // is prose about a page rather than a page, and a rule loose enough to
    // accept any leading directory would call it renderable.
    const result = classifyReview(
      input({
        changedPaths: ["docs/app/page.tsx", "backend/app/main.py"],
        surface: null,
        workspaceRoot: "frontend",
      }),
    );

    expect(result.classification).toBe("code");
    expect(result.visualPaths).toEqual([]);
  });

  it("still consults the route table on the repository-relative path", () => {
    // The analyzer's route table and `changedPaths` are both repository-
    // relative, so that comparison must not be stripped — a route source is a
    // route source wherever the application sits.
    const result = classifyReview(
      input({
        changedPaths: ["src/app/app/(account)/page.tsx"],
        workspaceRoot: "frontend",
      }),
    );

    expect(result.classification).toBe("visual");
  });

  it("reads a Vite application's routed views as visual", () => {
    // Vite and its family have no `app/` directory to be recognised by; routed
    // views live under `src/pages/` or `src/routes/`.
    const result = classifyReview(
      input({
        changedPaths: ["src/pages/Pricing.tsx", "src/routes/checkout.jsx"],
        surface: null,
      }),
    );

    expect(result.classification).toBe("visual");
    expect(result.visualPaths).toHaveLength(2);
  });
});
