import { describe, expect, it } from "vitest";
import {
  buildOperationView,
  freshestOperation,
  OPERATION_STAGE_LABELS,
  OPERATION_STALL_THRESHOLD_MS,
  operationPollPhase,
  shouldRefreshForState,
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
      resultId: null,
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
    const done = view({ status: "completed", resultId: "audit_1", completedAt: "x", stage: "completed" });

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

describe("poll phase", () => {
  /**
   * The distinction the panels kept getting wrong: `shouldPoll` goes false
   * for three different reasons and only one of them means the work is over.
   */

  it("says there is nothing to watch without an operation", () => {
    expect(operationPollPhase(null)).toBe("idle");
  });

  it("works while queued or running", () => {
    expect(operationPollPhase(view({ status: "queued" }))).toBe("working");
    expect(operationPollPhase(view({ status: "running" }))).toBe("working");
  });

  it("settles on every terminal status", () => {
    for (const status of ["completed", "failed", "cancelled"] as const) {
      expect(operationPollPhase(view({ status }))).toBe("settled");
    }
  });

  it("separates a paused question from a finished run", () => {
    const paused = operationPollPhase(view({ status: "needs_user" }));

    expect(paused).toBe("waiting_user");
    expect(paused).not.toBe("settled");
  });

  it("separates a lost run from a finished one", () => {
    const lost = view(
      { status: "running" },
      new Date(NOW.getTime() + OPERATION_STALL_THRESHOLD_MS + 1_000),
    );

    expect(lost.shouldPoll).toBe(false);
    expect(operationPollPhase(lost)).toBe("stalled");
    expect(operationPollPhase(lost)).not.toBe("settled");
  });

  it("stops polling for everything except work in progress", () => {
    // The property the hook depends on: one phase means "keep asking".
    for (const status of ["needs_user", "completed", "failed", "cancelled"] as const) {
      expect(view({ status }).shouldPoll).toBe(false);
    }
  });
});

describe("freshest answer", () => {
  it("prefers a just-started operation the poller has not seen", () => {
    const started = view({ operationId: "operation_2" });

    expect(freshestOperation(view({ operationId: "operation_1" }), started)).toBe(started);
  });

  it("prefers the poll once it has caught up", () => {
    const polled = view({ operationId: "operation_2", status: "completed" });

    expect(freshestOperation(polled, view({ operationId: "operation_2" }))).toBe(polled);
  });

  it("falls back to whichever one exists", () => {
    const only = view();

    expect(freshestOperation(null, only)).toBe(only);
    expect(freshestOperation(only, null)).toBe(only);
    expect(freshestOperation(null, null)).toBeNull();
  });
});

describe("refresh on transition", () => {
  /**
   * The rule the preview panel paid for: refreshing every tick can cost a
   * page render per two seconds, each superseding the last.
   */

  it("does not refresh while the poll agrees with the screen", () => {
    expect(shouldRefreshForState("running", "running")).toBe(false);
  });

  it("refreshes when the poll names something else", () => {
    expect(shouldRefreshForState("ready", "starting")).toBe(true);
  });

  it("does not refresh on an answer it did not get", () => {
    expect(shouldRefreshForState(null, "starting")).toBe(false);
    expect(shouldRefreshForState(undefined, "starting")).toBe(false);
  });
});
