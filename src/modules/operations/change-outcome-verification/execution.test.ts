import { beforeEach, describe, expect, it } from "vitest";
import { xmlResponse } from "@/modules/live-product-intelligence/test-support";
import { DEFAULT_OUTCOME_BUDGETS } from "@/modules/outcome-verification/budgets";
import { evaluateOutcomeEligibility } from "@/modules/outcome-verification/eligibility";
import { observationSchedule } from "@/modules/outcome-verification/schedule";
import {
  OUTCOME_EVIDENCE_SCHEMA_VERSION,
  OUTCOME_POLICY_VERSION,
} from "@/modules/outcome-verification/schema";
import { createOutcomeVerification } from "@/modules/outcome-verification/store";
import {
  FakeDatabase,
  OUTCOME_FIXTURES,
  OUTCOME_ORIGIN,
  outcomeHttp,
  outcomeSite,
  seedMergedChange,
  sitemapBody,
  type SeedOutcomeOptions,
} from "@/modules/outcome-verification/test-support";
import { fakeSupabase } from "../test-support";
import {
  abortOutcomeStep,
  completeOutcomeOperationStep,
  concludeOutcomeStep,
  observeOutcomeStep,
  openOutcomeWindowStep,
  type OutcomeDeps,
} from "./execution";

/**
 * The durable observation (Sprint 12A §17, §19, §20, §42, §43).
 *
 * ## The properties under test
 *
 * **The window cannot extend itself.** Re-running the open step, replaying an
 * observation, or retrying after a crash must all see the same deadline. This
 * is the mutation §45 names as "observation deadline removed", and it is
 * checked here at the step level rather than only in `schedule.test.ts`.
 *
 * **Early success stops the polling.** A verified outcome must not keep
 * requesting a customer's production website for the remaining fourteen
 * minutes (§20).
 *
 * **Replay does not duplicate anything.** Not a second verification row, not a
 * second terminal audit event, not a second operation (§42).
 *
 * **Nothing billed is ever touched.** Counted, not promised (§28, §43).
 */

let db: FakeDatabase;

const OPERATION_ID = "operation_outcome";

function deps(routes: Parameters<typeof outcomeHttp>[0]): OutcomeDeps & {
  transport: ReturnType<typeof outcomeHttp>["transport"];
} {
  const http = outcomeHttp(routes);
  return { supabase: fakeSupabase(db), http, transport: http.transport };
}

/** Seeds a merged change plus a queued verification, exactly as `startOutcomeVerification` would. */
async function seedQueuedVerification(options: SeedOutcomeOptions = {}): Promise<void> {
  seedMergedChange(db, options);

  db.seed("operation_runs", {
    id: OPERATION_ID,
    project_id: OUTCOME_FIXTURES.project,
    user_id: OUTCOME_FIXTURES.user,
    operation_type: "change_outcome_verification",
    status: "queued",
    stage: "preparing",
    input_identity: "i".repeat(64),
  });

  const eligibility = await evaluateOutcomeEligibility(fakeSupabase(db), {
    projectId: OUTCOME_FIXTURES.project,
    preparedChangeId: OUTCOME_FIXTURES.preparedChange,
  });
  if (!eligibility.eligible) throw new Error(`fixture not eligible: ${eligibility.reason}`);

  const created = await createOutcomeVerification(fakeSupabase(db), {
    projectId: OUTCOME_FIXTURES.project,
    userId: OUTCOME_FIXTURES.user,
    changeMergeId: eligibility.changeMergeId,
    preparedChangeId: eligibility.preparedChangeId,
    changeApprovalId: eligibility.changeApprovalId,
    mergedCommitSha: eligibility.mergedCommitSha,
    capability: eligibility.capability,
    capabilityVersion: eligibility.capabilityVersion,
    outcomeProfile: eligibility.outcomeProfile,
    outcomeProfileVersion: eligibility.outcomeProfileVersion,
    outcomePolicyVersion: OUTCOME_POLICY_VERSION,
    evidenceSchemaVersion: OUTCOME_EVIDENCE_SCHEMA_VERSION,
    publicOrigin: eligibility.publicOrigin,
    expectedOutcome: eligibility.expected,
    verificationIdentity: eligibility.verificationIdentity,
    operationRunId: OPERATION_ID,
  });

  if (!created.ok) throw new Error("fixture verification could not be created");
}

function verificationRow() {
  return db.rows("change_outcome_verifications")[0];
}

function terminalEvents(): string[] {
  return db
    .rows("audit_events")
    .map((row) => String(row.event_type))
    .filter((type) => type !== "change_outcome.started");
}

const CORRECT_SITE = outcomeSite({
  sitemap: xmlResponse(sitemapBody([OUTCOME_ORIGIN, `${OUTCOME_ORIGIN}/pricing`])),
});

beforeEach(() => {
  db = new FakeDatabase();
});

describe("the window is opened once and never moved (§17, §42, §45)", () => {
  it("writes a deadline exactly one window after it opens", async () => {
    await seedQueuedVerification();

    const before = Date.now();
    await openOutcomeWindowStep(deps(CORRECT_SITE), OPERATION_ID);
    const row = verificationRow();

    const started = Date.parse(String(row.verification_window_started_at));
    const ends = Date.parse(String(row.verification_window_ends_at));

    expect(row.status).toBe("observing");
    expect(ends - started).toBe(DEFAULT_OUTCOME_BUDGETS.observationWindowMs);
    expect(started).toBeGreaterThanOrEqual(before);
  });

  it("does not move the deadline when the step runs again (§42)", async () => {
    await seedQueuedVerification();

    await openOutcomeWindowStep(deps(CORRECT_SITE), OPERATION_ID);
    const first = verificationRow().verification_window_ends_at;

    // A replayed or retried step must find the window already open and keep it.
    await openOutcomeWindowStep(deps(CORRECT_SITE), OPERATION_ID);

    expect(verificationRow().verification_window_ends_at).toBe(first);
  });

  it("makes no outbound request of its own", async () => {
    await seedQueuedVerification();
    const dependencies = deps(CORRECT_SITE);

    await openOutcomeWindowStep(dependencies, OPERATION_ID);

    expect(dependencies.transport.requests).toHaveLength(0);
  });
});

describe("observation stops as soon as everything holds (§20)", () => {
  it("verifies on the first attempt and reports done", async () => {
    await seedQueuedVerification();
    const dependencies = deps(CORRECT_SITE);

    await openOutcomeWindowStep(dependencies, OPERATION_ID);
    const outcome = await observeOutcomeStep(dependencies, OPERATION_ID, 1);

    expect(outcome).toEqual({ ok: true, done: true });
    expect(verificationRow().status).toBe("verified");
    expect(verificationRow().attempt_count).toBe(1);
    // Two requests. Not fourteen.
    expect(dependencies.transport.requests).toHaveLength(2);
  });

  it("does not contact the site again once verified", async () => {
    await seedQueuedVerification();
    const dependencies = deps(CORRECT_SITE);

    await openOutcomeWindowStep(dependencies, OPERATION_ID);
    await observeOutcomeStep(dependencies, OPERATION_ID, 1);
    const after = dependencies.transport.requests.length;

    await observeOutcomeStep(dependencies, OPERATION_ID, 2);

    expect(dependencies.transport.requests).toHaveLength(after);
  });

  it("emits exactly one terminal audit event, even when the step is replayed (§42)", async () => {
    await seedQueuedVerification();
    const dependencies = deps(CORRECT_SITE);

    await openOutcomeWindowStep(dependencies, OPERATION_ID);
    await observeOutcomeStep(dependencies, OPERATION_ID, 1);
    await observeOutcomeStep(dependencies, OPERATION_ID, 1);
    await concludeOutcomeStep(dependencies, OPERATION_ID);

    expect(terminalEvents()).toEqual(["change_outcome.verified"]);
    expect(db.rows("change_outcome_verifications")).toHaveLength(1);
  });
});

describe("a resource that appears late is still verified (§17, §41)", () => {
  it("keeps looking after a missing robots.txt and verifies when it arrives", async () => {
    await seedQueuedVerification();

    const missing = deps(outcomeSite({ robots: null }));
    await openOutcomeWindowStep(missing, OPERATION_ID);

    const first = await observeOutcomeStep(missing, OPERATION_ID, 1);
    expect(first).toEqual({ ok: true, done: false });
    expect(verificationRow().status).toBe("observing");

    // The same frozen expectation, a later look.
    const present = deps(CORRECT_SITE);
    const second = await observeOutcomeStep(present, OPERATION_ID, 2);

    expect(second).toEqual({ ok: true, done: true });
    expect(verificationRow().status).toBe("verified");
    expect(verificationRow().attempt_count).toBe(2);
  });

  it("refuses to observe past the deadline (§42, §45)", async () => {
    await seedQueuedVerification();
    const dependencies = deps(CORRECT_SITE);

    await openOutcomeWindowStep(dependencies, OPERATION_ID);
    // The window closed while the workflow was asleep.
    verificationRow().verification_window_ends_at = new Date(Date.now() - 1000).toISOString();

    const outcome = await observeOutcomeStep(dependencies, OPERATION_ID, 3);

    expect(outcome).toEqual({ ok: true, done: true });
    expect(dependencies.transport.requests).toHaveLength(0);
  });

  it("refuses to observe when the deadline is missing entirely", async () => {
    // A mutation deleting the deadline must not produce unbounded polling.
    await seedQueuedVerification();
    const dependencies = deps(CORRECT_SITE);

    await openOutcomeWindowStep(dependencies, OPERATION_ID);
    verificationRow().verification_window_ends_at = null;

    await observeOutcomeStep(dependencies, OPERATION_ID, 2);

    expect(dependencies.transport.requests).toHaveLength(0);
  });
});

describe("what the deadline concludes (§21, §22, §23)", () => {
  it("records `partial` when a private route is advertised", async () => {
    await seedQueuedVerification();
    const dependencies = deps(
      outcomeSite({
        sitemap: xmlResponse(sitemapBody([OUTCOME_ORIGIN, `${OUTCOME_ORIGIN}/signup`])),
      }),
    );

    await openOutcomeWindowStep(dependencies, OPERATION_ID);
    await observeOutcomeStep(dependencies, OPERATION_ID, 1);
    await concludeOutcomeStep(dependencies, OPERATION_ID);

    expect(verificationRow().status).toBe("partial");
    expect(terminalEvents()).toEqual(["change_outcome.partial"]);
  });

  it("records `not_observed` when nothing appeared", async () => {
    await seedQueuedVerification();
    const dependencies = deps(outcomeSite({ robots: null, sitemap: null }));

    await openOutcomeWindowStep(dependencies, OPERATION_ID);
    await observeOutcomeStep(dependencies, OPERATION_ID, 1);
    await concludeOutcomeStep(dependencies, OPERATION_ID);

    expect(verificationRow().status).toBe("not_observed");
    expect(terminalEvents()).toEqual(["change_outcome.not_observed"]);
  });

  it("does not record a product answer when it could not look at all (§23)", async () => {
    await seedQueuedVerification();
    const dependencies = deps(
      outcomeSite({ robots: { fail: "connection_failed" }, sitemap: { fail: "connection_failed" } }),
    );

    await openOutcomeWindowStep(dependencies, OPERATION_ID);
    await observeOutcomeStep(dependencies, OPERATION_ID, 1);
    const outcome = await concludeOutcomeStep(dependencies, OPERATION_ID);

    // "The outcome was not observed" and "Vibe could not observe the outcome"
    // are different claims, and only the second is Vibe's to report.
    expect(outcome).toEqual({ ok: false, failureCode: "outcome_origin_unreachable" });
    expect(verificationRow().status).toBe("observing");
  });

  it("fails rather than concluding when no observation was ever recorded", async () => {
    await seedQueuedVerification();
    const dependencies = deps(CORRECT_SITE);

    await openOutcomeWindowStep(dependencies, OPERATION_ID);
    const outcome = await concludeOutcomeStep(dependencies, OPERATION_ID);

    expect(outcome).toEqual({ ok: false, failureCode: "outcome_origin_unreachable" });
  });

  it("records the summary counts and no response content in the audit event (§35)", async () => {
    await seedQueuedVerification();
    const dependencies = deps(
      outcomeSite({
        // Everything the capability intended, plus one leaked auth route — so
        // exactly one check fails and the counts are unambiguous.
        sitemap: xmlResponse(
          sitemapBody([OUTCOME_ORIGIN, `${OUTCOME_ORIGIN}/pricing`, `${OUTCOME_ORIGIN}/login`]),
        ),
      }),
    );

    await openOutcomeWindowStep(dependencies, OPERATION_ID);
    await observeOutcomeStep(dependencies, OPERATION_ID, 1);
    await concludeOutcomeStep(dependencies, OPERATION_ID);

    const event = db.rows("audit_events").find((row) => row.event_type === "change_outcome.partial");
    const metadata = event?.metadata as Record<string, unknown>;

    expect(metadata.checks_failed).toBe(1);
    expect(Number(metadata.checks_passed)).toBeGreaterThan(0);
    expect(JSON.stringify(metadata)).not.toContain("<urlset");
    expect(JSON.stringify(metadata)).not.toContain("/login");
  });
});

describe("failure is recorded as Vibe's, not the product's (§23)", () => {
  it("marks the verification failed with a typed code", async () => {
    await seedQueuedVerification();
    const dependencies = deps(CORRECT_SITE);

    await openOutcomeWindowStep(dependencies, OPERATION_ID);
    await abortOutcomeStep(dependencies, OPERATION_ID, "outcome_origin_unreachable");

    expect(verificationRow().status).toBe("failed");
    expect(verificationRow().failure_code).toBe("outcome_origin_unreachable");
    expect(terminalEvents()).toEqual(["change_outcome.failed"]);
    expect(db.rows("operation_runs")[0].status).toBe("failed");
  });

  it("cannot re-conclude a verification that already concluded", async () => {
    // The store guard, separate from the RLS guarantee. A late or duplicated
    // conclude step must not rewrite an answer the user has already been shown
    // — and the terminal audit event must not be emitted twice (§42).
    await seedQueuedVerification();
    const dependencies = deps(CORRECT_SITE);

    await openOutcomeWindowStep(dependencies, OPERATION_ID);
    await observeOutcomeStep(dependencies, OPERATION_ID, 1);
    expect(verificationRow().status).toBe("verified");
    const concludedAt = verificationRow().completed_at;

    // Now the site regresses and something tries to conclude again.
    const regressed = deps(outcomeSite({ robots: null, sitemap: null }));
    await concludeOutcomeStep(regressed, OPERATION_ID);

    expect(verificationRow().status).toBe("verified");
    expect(verificationRow().completed_at).toBe(concludedAt);
    expect(terminalEvents()).toEqual(["change_outcome.verified"]);
  });

  it("cannot overwrite a verification that already concluded", async () => {
    await seedQueuedVerification();
    const dependencies = deps(CORRECT_SITE);

    await openOutcomeWindowStep(dependencies, OPERATION_ID);
    await observeOutcomeStep(dependencies, OPERATION_ID, 1);
    expect(verificationRow().status).toBe("verified");

    await abortOutcomeStep(dependencies, OPERATION_ID, "outcome_verification_failed");

    // A terminal answer the user has already been shown is immutable.
    expect(verificationRow().status).toBe("verified");
  });
});

describe("the operation converges on the verification it produced", () => {
  it("completes pointing at the verification row", async () => {
    await seedQueuedVerification();
    const dependencies = deps(CORRECT_SITE);

    await openOutcomeWindowStep(dependencies, OPERATION_ID);
    await observeOutcomeStep(dependencies, OPERATION_ID, 1);
    await completeOutcomeOperationStep(dependencies, OPERATION_ID);

    const operation = db.rows("operation_runs")[0];
    expect(operation.status).toBe("completed");
    expect(operation.result_id).toBe(verificationRow().id);
  });
});

describe("nothing billed is touched (§28, §43, §53)", () => {
  it("makes no AI, sandbox, browser or GitHub write for a whole run", async () => {
    await seedQueuedVerification();
    const dependencies = deps(CORRECT_SITE);

    await openOutcomeWindowStep(dependencies, OPERATION_ID);
    await observeOutcomeStep(dependencies, OPERATION_ID, 1);
    await concludeOutcomeStep(dependencies, OPERATION_ID);
    await completeOutcomeOperationStep(dependencies, OPERATION_ID);

    for (const table of [
      "ai_usage_events",
      "sandbox_usage_events",
      "review_browser_usage",
      "business_readiness_audits",
      "opportunity_sets",
      "prepared_changes_writes",
    ]) {
      expect(db.rows(table)).toHaveLength(0);
    }
  });

  it("bounds the whole run to two requests per attempt", async () => {
    await seedQueuedVerification();
    const dependencies = deps(outcomeSite({ robots: null, sitemap: null }));

    await openOutcomeWindowStep(dependencies, OPERATION_ID);
    for (const attempt of observationSchedule()) {
      await observeOutcomeStep(dependencies, OPERATION_ID, attempt.index + 1);
    }

    expect(dependencies.transport.requests).toHaveLength(observationSchedule().length * 2);
    expect(dependencies.transport.requests.length).toBeLessThanOrEqual(16);
  });
});
