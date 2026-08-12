import { describe, expect, it } from "vitest";
import {
  buildOperationView,
  OPERATION_STAGE_LABELS,
  OPERATION_STALL_THRESHOLD_MS,
  type BuildOperationViewInput,
} from "./view";

/**
 * The safe operation DTO (Sprint 7 §17, §18, §20).
 *
 * Two properties carry real weight: polling has to stop, and "Try again" has
 * to be offered only where trying again is honest.
 */

const NOW = new Date("2026-08-12T12:00:00.000Z");

function view(overrides: Partial<BuildOperationViewInput> = {}, now: Date = NOW) {
  return buildOperationView(
    {
      operationId: "operation_1",
      status: "running",
      stage: "running_ai",
      failureCode: null,
      auditId: null,
      startedAt: "2026-08-12T11:59:30.000Z",
      completedAt: null,
      createdAt: "2026-08-12T11:59:29.000Z",
      ...overrides,
    },
    now,
  );
}

describe("polling", () => {
  it("polls while queued or running", () => {
    expect(view({ status: "queued" }).shouldPoll).toBe(true);
    expect(view({ status: "running" }).shouldPoll).toBe(true);
  });

  it("stops on every terminal status", () => {
    for (const status of ["completed", "failed", "cancelled"] as const) {
      expect(view({ status, completedAt: "2026-08-12T11:59:59.000Z" }).shouldPoll).toBe(false);
    }
  });

  it("stops rather than polling forever when a run is lost", () => {
    const stalled = view({}, new Date(NOW.getTime() + OPERATION_STALL_THRESHOLD_MS + 1_000));

    expect(stalled.stalled).toBe(true);
    expect(stalled.shouldPoll).toBe(false);
  });

  it("does not call a merely slow audit stalled", () => {
    // The measured audit is ~50s. A minute in is normal, not broken — calling
    // it stalled would invite a duplicate paid run.
    const slow = view({}, new Date(NOW.getTime() + 60_000));

    expect(slow.stalled).toBe(false);
    expect(slow.shouldPoll).toBe(true);
  });

  it("measures staleness from creation when a run never started", () => {
    const neverStarted = view(
      { status: "queued", startedAt: null },
      new Date(Date.parse("2026-08-12T11:59:29.000Z") + OPERATION_STALL_THRESHOLD_MS + 1_000),
    );

    expect(neverStarted.stalled).toBe(true);
  });
});

describe("retry offers", () => {
  it("offers a retry for transient provider failures", () => {
    for (const code of ["provider_rate_limited", "provider_timeout", "provider_unavailable"]) {
      expect(view({ status: "failed", failureCode: code, completedAt: "x" }).retryAllowed).toBe(true);
    }
  });

  it("never offers a retry after an interrupted paid call", () => {
    // We do not know whether the user was billed, so a one-click retry would
    // be the product quietly risking a double charge (§11, §21).
    expect(
      view({ status: "failed", failureCode: "inference_interrupted", completedAt: "x" }).retryAllowed,
    ).toBe(false);
  });

  it("never offers a retry for failures a retry cannot fix", () => {
    for (const code of ["provider_refusal", "provider_auth_error", "audit_input_budget_exceeded"]) {
      expect(view({ status: "failed", failureCode: code, completedAt: "x" }).retryAllowed).toBe(false);
    }
  });

  it("offers nothing to retry while still running", () => {
    expect(view().retryAllowed).toBe(false);
  });
});

describe("the DTO surface", () => {
  it("exposes the result once there is one", () => {
    const done = view({ status: "completed", auditId: "audit_1", completedAt: "x", stage: "completed" });

    expect(done.resultId).toBe("audit_1");
  });

  it("carries no execution-provider internals", () => {
    const keys = Object.keys(view());

    expect(keys).not.toContain("workflowRunId");
    expect(keys).not.toContain("executionProvider");
    expect(keys).not.toContain("userId");
  });
});

describe("stage copy", () => {
  it("names the work rather than a percentage", () => {
    for (const label of Object.values(OPERATION_STAGE_LABELS)) {
      expect(label).not.toMatch(/\d/);
      expect(label).not.toContain("%");
    }
  });

  it("has copy for every stage", () => {
    expect(OPERATION_STAGE_LABELS.running_ai).toBe("Analyzing business");
    expect(OPERATION_STAGE_LABELS.preparing).toBe("Preparing evidence");
  });
});
