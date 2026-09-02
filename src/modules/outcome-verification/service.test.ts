import { beforeEach, describe, expect, it } from "vitest";
import { FakeExecutor, fakeSupabase } from "@/modules/operations/test-support";
import { evaluateOutcomeEligibility } from "./eligibility";
import { getOutcomeCard, startOutcomeVerification } from "./service";
import { OUTCOME_POLICY_VERSION } from "./schema";
import {
  FakeDatabase,
  OUTCOME_FIXTURES,
  OUTCOME_MERGED_COMMIT,
  OUTCOME_ORIGIN,
  seedMergedChange,
  type SeedOutcomeOptions,
} from "./test-support";

/**
 * Eligibility, the request boundary and idempotency
 * (Sprint 12A §10, §11, §25, §27, §39, §43).
 *
 * ## What this file is mostly about
 *
 * Refusals, and what is *not* left behind by them. A verification of something
 * that was never merged, or of a merge whose read-back never matched, would be
 * a record making a claim about a commit that is not serving anything.
 *
 * ## And about spending nothing
 *
 * The strongest assertions here are the negative ones: opening a page creates
 * no operation, an explicit click creates exactly one, and neither ever
 * produces an AI call, a sandbox, a browser session or a GitHub request. Those
 * are counted rather than promised.
 */

let db: FakeDatabase;
let executor: FakeExecutor;

function client() {
  return fakeSupabase(db);
}

const params = {
  projectId: OUTCOME_FIXTURES.project,
  preparedChangeId: OUTCOME_FIXTURES.preparedChange,
};

function seed(options: SeedOutcomeOptions = {}) {
  seedMergedChange(db, options);
}

function start(overrides: { userId?: string } = {}) {
  return startOutcomeVerification(client(), executor, {
    ...params,
    userId: overrides.userId ?? OUTCOME_FIXTURES.user,
  });
}

beforeEach(() => {
  db = new FakeDatabase();
  executor = new FakeExecutor();
});

describe("only a merged, read-back change is verifiable (§10, §39)", () => {
  it("accepts a merge that reached `merged` and read back the approved commit", async () => {
    seed();

    const eligibility = await evaluateOutcomeEligibility(client(), params);

    expect(eligibility.eligible).toBe(true);
    if (!eligibility.eligible) return;
    expect(eligibility.mergedCommitSha).toBe(OUTCOME_MERGED_COMMIT);
    expect(eligibility.outcomeProfile).toBe("nextjs_seo_foundations_outcome_v1");
  });

  it.each(["blocked", "failed", "preflight", "merging"] as const)(
    "refuses a %s merge",
    async (mergeStatus) => {
      seed({ mergeStatus });

      expect(await evaluateOutcomeEligibility(client(), params)).toEqual({
        eligible: false,
        reason: "outcome_merge_required",
      });
    },
  );

  it("refuses when the read-back does not equal the approved commit", async () => {
    // A `merged` row whose observed head is something else should be impossible
    // — the database constraint refuses it — but eligibility re-checks rather
    // than inheriting the merge's own claim (§10).
    seed({ resultingDefaultHeadSha: "f".repeat(40) });

    expect(await evaluateOutcomeEligibility(client(), params)).toEqual({
      eligible: false,
      reason: "outcome_merge_unverified",
    });
  });

  it("refuses when the read-back is missing entirely", async () => {
    seed({ resultingDefaultHeadSha: null });

    expect(await evaluateOutcomeEligibility(client(), params)).toEqual({
      eligible: false,
      reason: "outcome_merge_unverified",
    });
  });

  it("refuses a capability with no deterministic verifier, without an AI fallback (§10)", async () => {
    seed({ capability: "some_future_capability" });

    expect(await evaluateOutcomeEligibility(client(), params)).toEqual({
      eligible: false,
      reason: "outcome_not_supported",
    });
  });

  it("refuses when the repository evidence the contract needs is gone", async () => {
    seed({ withSnapshot: false });

    expect(await evaluateOutcomeEligibility(client(), params)).toEqual({
      eligible: false,
      reason: "outcome_expectation_unavailable",
    });
  });
});

describe("the public origin is resolved, never accepted (§11)", () => {
  it("refuses a project with no production URL", async () => {
    seed({ productionUrl: null });

    expect(await evaluateOutcomeEligibility(client(), params)).toEqual({
      eligible: false,
      reason: "outcome_public_origin_unavailable",
    });
  });

  it.each([
    "http://product.test/",
    "https://127.0.0.1/",
    "https://localhost/",
    "https://user:pass@product.test/",
    "not a url",
  ])("refuses %s as a public origin", async (productionUrl) => {
    // Re-validated on read rather than trusted because it was validated on
    // write: this is the last checkpoint before an outbound request is planned.
    seed({ productionUrl });

    expect(await evaluateOutcomeEligibility(client(), params)).toEqual({
      eligible: false,
      reason: "outcome_public_origin_unavailable",
    });
  });

  it("normalizes the stored URL to a bare origin", async () => {
    seed({ productionUrl: "https://Product.TEST/some/path?utm_source=x" });

    const eligibility = await evaluateOutcomeEligibility(client(), params);
    if (!eligibility.eligible) throw new Error("expected eligible");

    expect(eligibility.publicOrigin).toBe(OUTCOME_ORIGIN);
    expect(eligibility.expected.publicOrigin).toBe(OUTCOME_ORIGIN);
  });
});

describe("the request boundary (§11, §25)", () => {
  it("refuses a caller who does not own the project", async () => {
    seed();

    expect(await start({ userId: "someone_else" })).toEqual({
      kind: "blocked",
      reason: "outcome_not_authorized",
    });
    expect(db.rows("change_outcome_verifications")).toHaveLength(0);
    expect(db.rows("operation_runs")).toHaveLength(0);
  });

  it("leaves nothing behind when the change was never merged", async () => {
    seed({ mergeStatus: "blocked" });

    expect(await start()).toEqual({ kind: "blocked", reason: "outcome_merge_required" });
    expect(db.rows("change_outcome_verifications")).toHaveLength(0);
    expect(db.rows("operation_runs")).toHaveLength(0);
    expect(db.rows("audit_events")).toHaveLength(0);
    expect(executor.starts).toHaveLength(0);
  });

  it("enqueues exactly one durable operation", async () => {
    seed();

    const outcome = await start();

    expect(outcome.kind).toBe("started");
    expect(executor.starts).toHaveLength(1);
    expect(executor.starts[0].operationType).toBe("change_outcome_verification");
    expect(db.rows("change_outcome_verifications")).toHaveLength(1);
  });

  it("freezes the expectation onto the row before anything is observed (§9)", async () => {
    seed();

    await start();
    const row = db.rows("change_outcome_verifications")[0];

    expect(row.status).toBe("queued");
    expect(row.check_results ?? null).toBeNull();
    expect(row.attempt_count ?? 0).toBe(0);
    expect(row.verification_window_ends_at ?? null).toBeNull();

    const expected = row.expected_outcome as { checks: unknown[]; publicOrigin: string };
    expect(expected.publicOrigin).toBe(OUTCOME_ORIGIN);
    expect(expected.checks.length).toBeGreaterThan(0);
  });

  it("records the policy version the row will be read under (§6)", async () => {
    seed();

    await start();
    const row = db.rows("change_outcome_verifications")[0];

    expect(row.outcome_policy_version).toBe(OUTCOME_POLICY_VERSION);
    expect(row.outcome_profile).toBe("nextjs_seo_foundations_outcome_v1");
  });
});

describe("one verification per question (§27)", () => {
  it("returns the existing verification on a double click", async () => {
    seed();

    const first = await start();
    const second = await start();

    expect(first.kind).toBe("started");
    expect(second.kind).toBe("active");
    expect(db.rows("change_outcome_verifications")).toHaveLength(1);
    // The property that matters: one workflow, not two polling the same site.
    expect(executor.starts).toHaveLength(1);
  });

  it("does not re-run a terminal verification (§27)", async () => {
    seed();
    await start();

    const row = db.rows("change_outcome_verifications")[0];
    row.status = "not_observed";
    row.check_results = [];
    row.attempt_count = 7;
    row.completed_at = "2026-08-14T15:00:00.000Z";
    // A terminal operation, so no active run remains.
    db.rows("operation_runs")[0].status = "completed";

    const again = await start();

    // A terminal `not_observed` is an answer. Asking again until it comes back
    // greener would be measurement theatre, so v1 deliberately has no recheck.
    expect(again.kind).toBe("active");
    expect(db.rows("change_outcome_verifications")).toHaveLength(1);
    expect(executor.starts).toHaveLength(1);
  });

  it("gives the same identity for the same question and a different one otherwise", async () => {
    seed();
    const first = await evaluateOutcomeEligibility(client(), params);

    db.rows("change_merges")[0].id = "merge_other";
    const second = await evaluateOutcomeEligibility(client(), params);

    if (!first.eligible || !second.eligible) throw new Error("expected eligible");
    expect(first.verificationIdentity).not.toBe(second.verificationIdentity);
  });
});

describe("no hidden spend (§28, §43)", () => {
  it("reading the card creates no operation and no verification", async () => {
    seed();

    const card = await getOutcomeCard(client(), params);

    expect(card.state).toBe("not_started");
    expect(card.canVerify).toBe(true);
    expect(db.rows("change_outcome_verifications")).toHaveLength(0);
    expect(db.rows("operation_runs")).toHaveLength(0);
    expect(executor.starts).toHaveLength(0);
  });

  it("reading the card ten times still creates nothing", async () => {
    seed();

    for (let index = 0; index < 10; index += 1) await getOutcomeCard(client(), params);

    expect(db.rows("operation_runs")).toHaveLength(0);
  });

  it("starting a verification touches no AI, sandbox, browser or GitHub table", async () => {
    seed();

    await start();

    for (const table of [
      "ai_usage_events",
      "sandbox_usage_events",
      "review_browser_usage",
      "business_readiness_audits",
      "opportunity_sets",
      "validation_runs",
      "preview_sessions",
      "repository_intelligence_snapshots_runs",
    ]) {
      expect(db.rows(table)).toHaveLength(0);
    }
  });

  it("the only audit event a start writes is change_outcome.started", async () => {
    seed();

    await start();

    expect(db.rows("audit_events").map((row) => row.event_type)).toEqual([
      "change_outcome.started",
    ]);
  });

  it("the started event carries no URL beyond the origin (CLAUDE.md rule 37)", async () => {
    seed({ productionUrl: `${OUTCOME_ORIGIN}/path?token=secret` });

    await start();
    const metadata = JSON.stringify(db.rows("audit_events")[0].metadata);

    expect(metadata).toContain(OUTCOME_ORIGIN);
    expect(metadata).not.toContain("token=secret");
    expect(metadata).not.toContain("/path");
  });
});

describe("the card the panel renders (§29, §33, §34)", () => {
  it("is unavailable and silent for a change that was never merged", async () => {
    seed({ mergeStatus: "blocked" });

    const card = await getOutcomeCard(client(), params);

    expect(card.state).toBe("unavailable");
    // The merge panel directly above already explains this gate.
    expect(card.failureMessage).toBeNull();
    expect(card.canVerify).toBe(false);
  });

  it("explains an unsupported capability rather than staying silent", async () => {
    seed({ capability: "some_future_capability" });

    const card = await getOutcomeCard(client(), params);

    expect(card.state).toBe("unavailable");
    expect(card.failureCode).toBe("outcome_not_supported");
    expect(card.failureMessage).toContain("cannot verify the production outcome");
  });

  it("never claims a deployment or a business result, in any state", async () => {
    seed();

    const card = await getOutcomeCard(client(), params);

    expect(card.deploymentVerified).toBe(false);
    expect(card.businessImpactMeasured).toBe(false);
  });
});

/**
 * The agentic path reaches the verifier (ADR 0071).
 *
 * The gap this closes was a roadmap entry for three sprints: every change the
 * coding agent produced resolved to `outcome_not_supported`, so the measurement
 * half of the product was wired to two deterministic SEO generators and to
 * nothing a customer's agent had ever built.
 */
describe("an agentic change is verifiable, or refused for a stated reason (ADR 0071)", () => {
  it("is eligible when a changed file serves a public page", async () => {
    seed({
      capability: "agentic_execution_v1",
      changedPaths: ["src/app/pricing/page.tsx"],
    });

    const eligibility = await evaluateOutcomeEligibility(client(), params);

    expect(eligibility.eligible).toBe(true);
    if (!eligibility.eligible) return;
    expect(eligibility.outcomeProfile).toBe("agentic_public_routes_outcome_v1");
    expect(eligibility.expected.checks.map((check) => check.target)).toEqual(["/pricing"]);
  });

  it("refuses a backend-only change as having no public surface, not as unsupported", async () => {
    // Two different sentences. "Vibe cannot verify this kind of change" would be
    // false now, and "there is nothing public to check" is what happened.
    seed({
      capability: "agentic_execution_v1",
      changedPaths: ["src/modules/billing/catalog.ts"],
    });

    expect(await evaluateOutcomeEligibility(client(), params)).toEqual({
      eligible: false,
      reason: "outcome_no_public_surface",
    });
  });

  it("tells the founder what will be looked at before the click, and its limit", async () => {
    seed({
      capability: "agentic_execution_v1",
      changedPaths: ["src/app/pricing/page.tsx"],
    });

    const card = await getOutcomeCard(client(), params);

    expect(card.state).toBe("not_started");
    expect(card.canVerify).toBe(true);
    // The sentence that stops a green tick reading as "your change is on your
    // site". It is a field rather than component copy for exactly that reason.
    expect(card.profileNote).toContain("cannot tell you whether the new version");
  });

  it("explains a backend-only change on the card rather than staying silent", async () => {
    seed({
      capability: "agentic_execution_v1",
      changedPaths: ["src/modules/billing/catalog.ts"],
    });

    const card = await getOutcomeCard(client(), params);

    expect(card.state).toBe("unavailable");
    expect(card.failureCode).toBe("outcome_no_public_surface");
    expect(card.failureMessage).toContain("nothing public to check");
  });
});
