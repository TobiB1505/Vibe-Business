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
    validationRunId: "validation_1",
    operationRunId: "operation_1",
    artifactSnapshotId: "snap_1",
    previewProfile: "nextjs_preview_v1",
    previewProfileVersion: "nextjs-preview-v1",
    previewPolicyVersion: "preview-policy-v1",
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
      validation: { status: "passed" },
      artifact: { expiresAt: LATER },
      session: null,
      failureMessage: null,
      ...input,
    },
    NOW,
  );
}

describe("eligibility states", () => {
  it("says nothing is available when the change was never validated", () => {
    expect(card({ validation: null, artifact: null }).state).toBe("not_available");
  });

  it("requires validation when the run did not pass", () => {
    const result = card({ validation: { status: "failed" }, artifact: null });

    expect(result.state).toBe("needs_validation");
    // No re-validation nudge here: the user is already looking at a failed
    // validation with its own "Validate again" button. Two would compete.
    expect(result.revalidationRequired).toBe(false);
  });

  it("offers a start when a live artifact exists", () => {
    expect(card().state).toBe("ready_to_start");
  });

  it("reports an expired artifact separately from a missing one", () => {
    // Different sentences, and a user can act on knowing which: an expiry is a
    // clock, a deletion is a preview that already happened.
    expect(card({ artifact: { expiresAt: EARLIER } }).state).toBe("artifact_expired");
    expect(card({ artifact: null }).state).toBe("artifact_unavailable");
  });

  it("marks both artifact-gone states as needing a deliberate re-validation", () => {
    // The honest cost. Never rendered as a free refresh (§15).
    expect(card({ artifact: null }).revalidationRequired).toBe(true);
    expect(card({ artifact: { expiresAt: EARLIER } }).revalidationRequired).toBe(true);
  });
});

describe("live sessions", () => {
  it("shows a starting preview with its stage", () => {
    const result = card({
      session: session({ status: "starting", stage: "restoring_artifact", readyAt: null }),
    });

    expect(result.state).toBe("starting");
    expect(result.stage).toBe("restoring_artifact");
    expect(result.operationRunId).toBe("operation_1");
  });

  it("shows a running preview with its deadline", () => {
    const result = card({ session: session() });

    expect(result.state).toBe("running");
    expect(result.expiresAt).toBe(LATER);
    expect(result.previewSessionId).toBe("preview_1");
  });

  it("shows a running preview even though its artifact is already gone", () => {
    // The artifact is deleted at teardown, so a running preview whose artifact
    // has been consumed is the normal case. Reading the artifact first would
    // report `artifact_unavailable` while the user looks at a working preview.
    const result = card({ session: session(), artifact: null });

    expect(result.state).toBe("running");
  });

  it("never exposes a sandbox or snapshot identifier", () => {
    const result = card({ session: session() });

    // The card is what reaches the browser. A provider sandbox id there would
    // be internal infrastructure detail on a customer's screen (§8).
    expect(JSON.stringify(result)).not.toContain("snap_1");
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

  it("reports expiry even while the artifact row still looks live", () => {
    // The window between a deadline passing and an authorized read converging
    // the state. The artifact is about to be deleted by that read, so offering
    // a start here would describe a window closing as it is read — and would
    // hide from the user the thing that actually happened.
    const result = card({
      session: session({ expiresAt: EARLIER }),
      artifact: { expiresAt: LATER },
    });

    expect(result.state).toBe("expired");
  });

  it("treats a starting session past its deadline as expired", () => {
    const result = card({
      session: session({ status: "starting", stage: "starting_server", expiresAt: EARLIER }),
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
      artifact: null,
    });

    expect(result.state).toBe("stopped");
    expect(result.revalidationRequired).toBe(true);
  });

  it("shows an expired preview", () => {
    const result = card({
      session: session({ status: "expired", expiresAt: EARLIER, stoppedAt: EARLIER }),
      artifact: null,
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
      artifact: null,
      failureMessage: "The preview started but never answered, so Vibe stopped it.",
    });

    expect(result.state).toBe("failed");
    expect(result.failureCode).toBe("preview_health_check_failed");
    expect(result.failureMessage).toContain("never answered");
  });

  it("offers a fresh start when a terminal session is followed by a new artifact", () => {
    // Previewed, stopped, then re-validated. Without this the panel would be
    // stuck on "Preview stopped" with no way forward.
    const result = card({
      session: session({ status: "stopped", stoppedAt: EARLIER }),
      artifact: { expiresAt: LATER },
    });

    expect(result.state).toBe("ready_to_start");
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
