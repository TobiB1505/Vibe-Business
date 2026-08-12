import { describe, expect, it } from "vitest";
import { resolveExecutionCapability } from "./capabilities";
import { runExecutionPreflight } from "./preflight";
import {
  FIXTURE_SNAPSHOT_SHA,
  fakePreflightInput,
  fakeProbe,
  fakeRepositorySnapshotFor,
  fakeSeoOpportunity,
} from "./test-support";

/**
 * Capability resolution and execution preflight (Sprint 9 §39, §40).
 *
 * The sprint's central claim is that stored evidence does not authorize a
 * repository write. Almost every case here is therefore a refusal — the base
 * fixture describes a project that should be executable, and each test breaks
 * exactly one thing.
 */

describe("capability resolution (§39)", () => {
  const repository = fakeRepositorySnapshotFor();

  function resolve(opportunity = fakeSeoOpportunity(), snapshot = repository) {
    return resolveExecutionCapability({
      opportunity,
      repository: snapshot,
      hasProductionOrigin: true,
    });
  }

  it("supports a structurally valid SEO opportunity", () => {
    expect(resolve()).toEqual({ supported: true, capability: "nextjs_seo_foundations_v2" });
  });

  it("supports the same structure under completely different wording", () => {
    // Model wording is not a machine API. A rewritten prompt must not change
    // which opportunities Vibe is willing to write code for (§7).
    const reworded = fakeSeoOpportunity({
      title: "Suchmaschinen können deine Seite nicht richtig lesen",
      problem: "Es fehlen grundlegende Crawler-Dateien.",
      whyNow: "Günstig und unabhängig von anderen Entscheidungen.",
    });

    expect(resolve(reworded).supported).toBe(true);
  });

  it("refuses the exact SEO wording when the evidence is absent", () => {
    // The inverse of the case above, and the more important one: prose that
    // looks right must not be able to authorize anything.
    const wordingOnly = fakeSeoOpportunity({ evidenceIds: ["live.site.title"] });

    expect(resolve(wordingOnly)).toEqual({ supported: false, reason: "no_matching_capability" });
  });

  it("refuses an opportunity the model classified as a business decision", () => {
    expect(resolve(fakeSeoOpportunity({ executionType: "business_decision" }))).toEqual({
      supported: false,
      reason: "not_a_code_change",
    });
  });

  it("refuses a framework with no generator", () => {
    const django = fakeRepositorySnapshotFor({ frameworks: [{ id: "django", name: "Django" }] });

    expect(resolve(fakeSeoOpportunity(), django)).toEqual({
      supported: false,
      reason: "unsupported_framework",
    });
  });

  it("refuses when the repository already has the surfaces", () => {
    const alreadyDone = fakeRepositorySnapshotFor({ robotsDetected: true, sitemapDetected: true });

    expect(resolve(fakeSeoOpportunity(), alreadyDone).supported).toBe(false);
  });

  it("does not consult readiness at all", () => {
    // `ready` is the model's opinion that a human could act. It is not
    // authority, and a capability must resolve on structure alone (§33).
    expect(resolve(fakeSeoOpportunity({ executionReadiness: "not_supported_yet" })).supported).toBe(true);
  });
});

describe("preflight — the happy path", () => {
  it("is eligible when everything currently agrees", () => {
    const result = runExecutionPreflight(fakePreflightInput());

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.capability).toBe("nextjs_seo_foundations_v2");
    expect(result.baseSha).toBe(FIXTURE_SNAPSHOT_SHA);
    expect(result.baseBranch).toBe("main");
  });
});

describe("preflight — staleness (§5)", () => {
  it.each([
    ["a stale audit", { auditCurrent: false }, "stale_audit"],
    ["a stale opportunity set", { opportunitySetCurrent: false }, "stale_opportunity"],
    [
      "a superseded repository snapshot",
      { latestRepositorySnapshotId: "snapshot_2" },
      "stale_repository_intelligence",
    ],
  ])("blocks on %s", (_label, override, reason) => {
    const result = runExecutionPreflight(fakePreflightInput(override));

    expect(result).toEqual({ eligible: false, reason });
  });
});

describe("preflight — repository consistency (§4)", () => {
  it("blocks when the default branch moved since analysis", () => {
    const result = runExecutionPreflight(
      fakePreflightInput({ probe: fakeProbe({ head: { defaultBranch: "main", commitSha: "deadbeef" } }) }),
    );

    expect(result).toEqual({ eligible: false, reason: "repository_changed" });
  });
});

describe("preflight — premise revalidation (§8)", () => {
  /**
   * The Sprint 8 regression class, stated directly: the stored evidence says
   * the files are missing, and the world says otherwise. The world wins.
   */
  it("blocks when a robots implementation appeared after analysis", () => {
    const result = runExecutionPreflight(
      fakePreflightInput({ probe: fakeProbe({ existingTargetPaths: ["src/app/robots.ts"] }) }),
    );

    expect(result).toEqual({ eligible: false, reason: "conflicting_files_exist" });
  });

  it("blocks when a sitemap implementation appeared after analysis", () => {
    const result = runExecutionPreflight(
      fakePreflightInput({ probe: fakeProbe({ existingTargetPaths: ["src/app/sitemap.ts"] }) }),
    );

    expect(result.eligible).toBe(false);
  });

  it("blocks when the live site now serves robots.txt", () => {
    const result = runExecutionPreflight(
      fakePreflightInput({ probe: fakeProbe({ liveRobotsServed: true }) }),
    );

    expect(result).toEqual({ eligible: false, reason: "premise_no_longer_true" });
  });

  it("blocks when the live site now serves a sitemap", () => {
    const result = runExecutionPreflight(
      fakePreflightInput({ probe: fakeProbe({ liveSitemapServed: true }) }),
    );

    expect(result).toEqual({ eligible: false, reason: "premise_no_longer_true" });
  });

  it("refuses on current state even when the stored evidence still says go", () => {
    // The whole sprint in one case. The opportunity, its evidence ids and the
    // snapshot all agree the files are missing — exactly the Sprint 8 shape,
    // where every stored layer was self-consistent and wrong. Only the live
    // probe disagrees, and that is enough to stop a commit.
    const input = fakePreflightInput({
      probe: fakeProbe({ liveRobotsServed: true, liveSitemapServed: true }),
    });

    expect(input.opportunity.executionReadiness).toBe("ready");
    expect(input.repository.businessSurfaces.every((surface) => !surface.detected)).toBe(true);
    expect(runExecutionPreflight(input).eligible).toBe(false);
  });
});

describe("preflight — context and layout (§9, §12)", () => {
  it("blocks when the app root is ambiguous", () => {
    const result = runExecutionPreflight(fakePreflightInput({ appRoot: null }));

    expect(result).toEqual({ eligible: false, reason: "unsupported_repository_layout" });
  });

  it("blocks when no trustworthy production origin exists", () => {
    // Rather than writing a placeholder URL into someone's repository.
    const result = runExecutionPreflight(fakePreflightInput({ productionOrigin: null }));

    expect(result).toEqual({ eligible: false, reason: "missing_required_context" });
  });
});

describe("preflight — permission (§14)", () => {
  it("blocks when the installation is still read-only", () => {
    const result = runExecutionPreflight(
      fakePreflightInput({ probe: fakeProbe({ hasWritePermission: false }) }),
    );

    expect(result).toEqual({ eligible: false, reason: "github_write_permission_required" });
  });
});

describe("preflight — unsupported opportunities (§33)", () => {
  it("blocks an opportunity with no executor", () => {
    const result = runExecutionPreflight(
      fakePreflightInput({ opportunity: fakeSeoOpportunity({ executionType: "business_decision" }) }),
    );

    expect(result).toEqual({ eligible: false, reason: "unsupported_opportunity" });
  });

  it("checks capability support before anything else", () => {
    // An unsupported opportunity on a stale audit reports the thing the user
    // can actually understand: Vibe cannot do this, not "refresh your audit".
    const result = runExecutionPreflight(
      fakePreflightInput({
        opportunity: fakeSeoOpportunity({ executionType: "research" }),
        auditCurrent: false,
      }),
    );

    expect(result).toEqual({ eligible: false, reason: "unsupported_opportunity" });
  });
});
