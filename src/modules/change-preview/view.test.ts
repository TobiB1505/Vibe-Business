import { describe, expect, it } from "vitest";
import { PREVIEW_STAGES } from "./schema";
import type { PreviewSession } from "./schema";
import { PREVIEW_STAGE_LABELS, buildPreviewCard, type PreviewCardInput } from "./view";

/**
 * The preview state machine (Sprint 10B-3 §2, §13, §18).
 *
 * Ten states, most of which look similar from a distance and none of which
 * takes the same action. These tests exist because getting one wrong means
 * either a user paying for a sandbox that cannot start, or a working preview
 * rendered as broken.
 *
 * Expiry is tested against an injected clock rather than the real one, because
 * the property under test is that the *server* decides — a client clock is
 * exactly what must not be trusted.
 */

const NOW = new Date("2026-08-13T12:00:00.000Z");
const LATER = "2026-08-13T12:10:00.000Z";
const EARLIER = "2026-08-13T11:50:00.000Z";

function session(overrides: Partial<PreviewSession> = {}): PreviewSession {
  return {
    id: "preview_1",
    projectId: "project_1",
    userId: "user_1",
    preparedChangeId: "prepared_1",
    preparedCommitSha: "a".repeat(40),
    validationRunId: null,
    operationRunId: "operation_1",
    artifactSnapshotId: null,
    previewProfile: "nextjs_dev_preview_v1",
    previewProfileVersion: "nextjs-dev-preview-v1",
    previewPolicyVersion: "preview-policy-v2",
    provider: "vercel_sandbox",
    runtime: "vercel/sandbox/node:24",
    port: 3000,
    status: "running",
    stage: "completed",
    failureCode: null,
    teardownReason: null,
    cleanupStatus: null,
    previewIdentity: "p".repeat(64),
    startedAt: EARLIER,
    readyAt: EARLIER,
    expiresAt: LATER,
    stoppedAt: null,
    artifactDeletedAt: null,
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ...overrides,
  };
}

function card(input: Partial<PreviewCardInput> = {}) {
  return buildPreviewCard(
    {
      prepared: true,
      session: null,
      failureMessage: null,
      ...input,
    },
    NOW,
  );
}

describe("eligibility states", () => {
  it("says nothing is available when the change has no commit", () => {
    expect(card({ prepared: false }).state).toBe("not_available");
  });

  it("offers a start as soon as a commit exists", () => {
    /*
     * The whole of Sprint 0114 in one assertion. This used to require a passing
     * validation *and* a live captured artifact — which is what made a person
     * wait roughly five minutes to look at code that was already written.
     */
    expect(card().state).toBe("ready_to_start");
  });

  it("does not wait for a validation of any status", () => {
    // A preview runs alongside validation now, not after it. There is no input
    // here through which a validation could still gate one.
    expect(card().state).toBe("ready_to_start");
  });
});

describe("live sessions", () => {
  it("shows a starting preview with its stage", () => {
    const result = card({
      session: session({ status: "starting", stage: "starting_dev_server", readyAt: null }),
    });

    expect(result.state).toBe("starting");
    expect(result.stage).toBe("starting_dev_server");
    expect(result.operationRunId).toBe("operation_1");
  });

  it("shows a running preview with its deadline", () => {
    const result = card({ session: session() });

    expect(result.state).toBe("running");
    expect(result.expiresAt).toBe(LATER);
    expect(result.previewSessionId).toBe("preview_1");
  });

  it("shows a running preview", () => {
    expect(card({ session: session() }).state).toBe("running");
  });

  it("never exposes a sandbox or snapshot identifier", () => {
    const result = card({ session: session() });

    // The card is what reaches the browser. A provider sandbox id there would
    // be internal infrastructure detail on a customer's screen (§8).
    expect(JSON.stringify(result)).not.toContain("vercel/sandbox");
  });
});

describe("expiry is decided on the server", () => {
  it("treats a running session past its deadline as expired", () => {
    // The row still says `running` because nothing has read it yet. The user
    // must not be offered a URL that is gone (§13).
    const result = card({ session: session({ expiresAt: EARLIER }) });

    expect(result.state).toBe("expired");
  });

  it("treats a starting session past its deadline as expired", () => {
    const result = card({
      session: session({ status: "starting", stage: "starting_dev_server", expiresAt: EARLIER }),
    });

    expect(result.state).toBe("expired");
    expect(result.stage).toBeNull();
  });

  it("does not expire a session one second before its deadline", () => {
    const result = card({ session: session({ expiresAt: "2026-08-13T12:00:01.000Z" }) });

    expect(result.state).toBe("running");
  });
});

describe("terminal sessions", () => {
  it("shows a stopped preview", () => {
    const result = card({
      session: session({ status: "stopped", stoppedAt: EARLIER }),
    });

    expect(result.state).toBe("stopped");
  });

  it("shows an expired preview", () => {
    const result = card({
      session: session({ status: "expired", expiresAt: EARLIER, stoppedAt: EARLIER }),
    });

    expect(result.state).toBe("expired");
  });

  it("shows a failed preview with safe copy, never a provider message", () => {
    const result = card({
      session: session({
        status: "failed",
        failureCode: "preview_health_check_failed",
        stoppedAt: EARLIER,
      }),
      failureMessage: "The preview started but never answered, so Vibe stopped it.",
    });

    expect(result.state).toBe("failed");
    expect(result.failureCode).toBe("preview_health_check_failed");
    expect(result.failureMessage).toContain("never answered");
  });

  it("reports a finished session as finished rather than as ready", () => {
    /*
     * The opposite of what this asserted under v1, and the reason is that the
     * thing it was weighing has gone. A settled session used to be outranked by
     * a still-usable artifact, because "previewed, stopped, then re-validated"
     * left a live artifact sitting there already paid for.
     *
     * Starting again costs a fresh clone either way now, so the honest card
     * says what happened and the panel offers a new preview beside it.
     */
    const result = card({ session: session({ status: "stopped", stoppedAt: EARLIER }) });

    expect(result.state).toBe("stopped");
  });
});

describe("stage copy", () => {
  it("names every stage", () => {
    for (const stage of PREVIEW_STAGES) {
      expect(PREVIEW_STAGE_LABELS[stage]).toBeTruthy();
    }
  });

  it("names work rather than claiming progress", () => {
    // No percentages anywhere. A preview is tens of seconds with phases of
    // wildly different durations, and any number would be invented (§7).
    for (const label of Object.values(PREVIEW_STAGE_LABELS)) {
      expect(label).not.toMatch(/%|\d+\s*\/\s*\d+/);
    }
  });
});
