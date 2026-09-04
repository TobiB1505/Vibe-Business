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
      // A project whose framework Vibe can start. The cases that turn this off
      // say so, because it is the difference between an offer and a promise.
      availability: "available",
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

  /*
   * A commit is necessary and was treated as sufficient.
   *
   * With no server for the framework, this card said `ready_to_start` — so the
   * founder clicked, confirmed publishing an unlisted public URL, and only then
   * learned nothing could start. Widening admission from single-app Next.js to
   * every Node build contract is what made that reachable: before it, nearly
   * every admitted project had a server command.
   */
  it("offers nothing when no development server exists for the framework", () => {
    expect(card({ availability: "no_dev_server" }).state).toBe("not_supported");
  });

  it("names an unresolved repository read as its own state", () => {
    /*
     * Not folded into `not_supported`, because the sentence a founder would
     * read there is false: nothing is wrong with the framework. Vibe simply
     * cannot say yet which directory it would run in, and that has a move.
     */
    expect(card({ availability: "repository_not_ready" }).state).toBe("repository_not_ready");
  });

  it("names a workspace install as its own state", () => {
    /*
     * A third reason rather than a shade of the other two, because it is a
     * fact about neither the framework nor the scan — both are fine. It is the
     * one refusal here that is Vibe declining to guess: a preview invokes the
     * framework binary by path, and where a workspace install puts that binary
     * differs by package manager.
     */
    expect(card({ availability: "workspace_not_previewable" }).state).toBe(
      "workspace_not_previewable",
    );
  });

  it("keeps that separate from having no commit", () => {
    // Different states because the founder can do different things about them:
    // a missing commit arrives when the agent finishes, and this one does not
    // change by waiting.
    expect(card({ prepared: false, availability: "no_dev_server" }).state).toBe("not_available");
  });
});

describe("a session outlives the offer that started it", () => {
  /*
   * Checked after the session states, deliberately. A repository that loses its
   * server — a framework removed, an application restructured — does not make
   * the session that already ran stop having run. Only the offer is withdrawn.
   */
  it("still reports a running session for a framework Vibe no longer starts", () => {
    const state = card({
      availability: "no_dev_server",
      session: session({ status: "running", readyAt: EARLIER }),
    }).state;

    expect(state).toBe("running");
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
