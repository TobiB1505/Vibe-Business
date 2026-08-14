import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { REVIEW_POLICY } from "@/modules/review/policy";
import { fakeCaptureProvider, fakeStorage, withFakeStorage } from "@/modules/review/test-support";

/**
 * The durable review, executed rather than mirrored (Sprint 11A §39, §32).
 *
 * These prove the properties that only exist once capture, storage and
 * persistence are one orchestrated sequence:
 *
 *  - both sides are captured under **identical** conditions, which is the only
 *    thing that makes them a comparison;
 *  - a one-sided result is a failure, not a half-rendered success;
 *  - the browser session ends on every path;
 *  - the spend is recorded whichever way it went.
 */

const db = { current: new FakeDatabase() };
const storage = { current: fakeStorage() };
const capture = { current: fakeCaptureProvider() };
const previewOrigin = { current: "https://preview-3000.vercel.run" as string | null };

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => withFakeStorage(fakeSupabase(db.current), storage.current),
}));

vi.mock("@/modules/review/browserbase/capture", () => ({
  // The real adapter is never constructed in a test: no Browserbase session,
  // no Playwright, no network.
  createBrowserbaseCaptureProvider: () => capture.current,
}));

vi.mock("@/modules/validation/vercel/provider", () => ({
  createVercelSandboxProvider: () => ({ id: "vercel_sandbox" }),
}));

vi.mock("@/modules/authenticated-product-intelligence/browserbase/client", () => ({
  getBrowserSessionProvider: () => ({ name: "browserbase" }),
}));

vi.mock("@/modules/change-preview/orchestrator", () => ({
  resolvePreviewOrigin: async () => previewOrigin.current,
}));

const { changeReviewWorkflow } = await import("./workflow");

const USER = "user_1";
const PROJECT = "project_1";
const PREPARED = "prepared_1";
const VALIDATION = "validation_1";
const PREVIEW = "preview_1";
const OPERATION = "review_op_1";
const ARTIFACT = "review_1";
const ORIGIN = "https://vibe-business.example";

function seed(overrides: { previewStatus?: string } = {}) {
  db.current.seed("projects", { id: PROJECT, user_id: USER, production_url: ORIGIN });

  db.current.seed("operation_runs", {
    id: OPERATION,
    project_id: PROJECT,
    user_id: USER,
    operation_type: "change_review",
    input_identity: "r".repeat(64),
    status: "queued",
    stage: "preparing",
    subject_id: PREPARED,
  });

  db.current.seed("preview_sessions", {
    id: PREVIEW,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: PREPARED,
    validation_run_id: VALIDATION,
    operation_run_id: "preview_op",
    artifact_snapshot_id: "snap_1",
    preview_profile: "nextjs_preview_v1",
    preview_identity: "p".repeat(64),
    provider: "vercel_sandbox",
    status: overrides.previewStatus ?? "running",
    port: 3000,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });

  db.current.seed("review_artifacts", {
    id: ARTIFACT,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: PREPARED,
    validation_run_id: VALIDATION,
    preview_session_id: PREVIEW,
    operation_run_id: OPERATION,
    review_profile: "public_visual_review_v1",
    review_profile_version: "public-visual-review-v1",
    review_policy_version: "review-policy-v1",
    provider: "browserbase",
    route: REVIEW_POLICY.route,
    before_origin: ORIGIN,
    before_capture_status: "pending",
    after_capture_status: "pending",
    review_identity: "i".repeat(64),
    status: "capturing",
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
}

function artifact() {
  return db.current.rows("review_artifacts")[0];
}

beforeEach(() => {
  db.current = new FakeDatabase();
  storage.current = fakeStorage();
  capture.current = fakeCaptureProvider();
  previewOrigin.current = "https://preview-3000.vercel.run";
});

describe("a successful comparison", () => {
  it("captures both sides and marks the artifact ready", async () => {
    seed();

    await changeReviewWorkflow(OPERATION);

    expect(artifact().status).toBe("ready");
    expect(artifact().before_capture_status).toBe("captured");
    expect(artifact().after_capture_status).toBe("captured");
    expect(db.current.rows("operation_runs")[0].status).toBe("completed");
  });

  it("captures before from the live origin and after from the preview", async () => {
    seed();

    await changeReviewWorkflow(OPERATION);

    const [before, after] = capture.current.requests();
    expect(before.url).toBe(`${ORIGIN}/`);
    expect(after.url).toBe("https://preview-3000.vercel.run/");
  });

  it("captures both sides under identical conditions", async () => {
    seed();

    await changeReviewWorkflow(OPERATION);

    const [before, after] = capture.current.requests();
    // The property that makes the two images a *comparison*. Capture one at a
    // different width and every reflowed element reads as a change that was
    // never made (§12, §39).
    expect(before.viewport).toEqual(after.viewport);
    expect(before.fullPage).toBe(after.fullPage);
    expect(before.settleMs).toBe(after.settleMs);
    expect(before.stabilizationCss).toBe(after.stabilizationCss);
    expect(before.viewport).toEqual(REVIEW_POLICY.viewport);
  });

  it("stores both images under the project's own prefix", async () => {
    seed();

    await changeReviewWorkflow(OPERATION);

    // The path prefix is what makes storage authorization expressible at all.
    expect([...storage.current.objects.keys()].sort()).toEqual([
      `${PROJECT}/${ARTIFACT}/after.png`,
      `${PROJECT}/${ARTIFACT}/before.png`,
    ]);
  });

  it("records the hash and dimensions of each side", async () => {
    seed();

    await changeReviewWorkflow(OPERATION);

    const row = artifact();
    expect(String(row.before_sha256)).toHaveLength(64);
    expect(String(row.after_sha256)).toHaveLength(64);
    // Different bytes per side, so a test that compared an image to itself
    // would not pass here.
    expect(row.before_sha256).not.toBe(row.after_sha256);
    expect(row.before_width).toBe(REVIEW_POLICY.viewport.width);
    expect(row.after_width).toBe(REVIEW_POLICY.viewport.width);
  });

  it("opens exactly one browser session for both captures", async () => {
    seed();

    await changeReviewWorkflow(OPERATION);

    // Two sessions would mean two Chrome instances, and a rendering difference
    // that is an artefact of our own orchestration.
    expect(capture.current.sessions()).toBe(1);
  });

  it("records the browser spend", async () => {
    seed();

    await changeReviewWorkflow(OPERATION);

    const [usage] = db.current.rows("review_browser_usage");
    expect(usage.operation).toBe("change_review");
    expect(usage.review_artifact_id).toBe(ARTIFACT);
    expect(usage.status).toBe("ready");
    expect(usage.duration_ms).toBe(4321);
    expect(usage.captures).toBe(2);
    // Browserbase reports no attributable price, and a rate-card figure would
    // be a guess in an accounting field (§22).
    expect(usage.provider_cost_usd).toBeNull();
  });

  it("records no AI usage", async () => {
    seed();

    await changeReviewWorkflow(OPERATION);

    expect(db.current.rows("ai_usage_events")).toHaveLength(0);
  });
});

describe("partial failure is failure", () => {
  it("fails the artifact when the before capture fails", async () => {
    capture.current = fakeCaptureProvider({ failAt: { index: 0, layer: "target" } });
    seed();

    await changeReviewWorkflow(OPERATION);

    expect(artifact().status).toBe("failed");
    expect(artifact().failure_code).toBe("review_before_capture_failed");
  });

  it("fails the artifact when the after capture fails", async () => {
    capture.current = fakeCaptureProvider({ failAt: { index: 1, layer: "target" } });
    seed();

    await changeReviewWorkflow(OPERATION);

    expect(artifact().status).toBe("failed");
    expect(artifact().failure_code).toBe("review_after_capture_failed");
  });

  it("never leaves a one-sided comparison stored", async () => {
    capture.current = fakeCaptureProvider({ failAt: { index: 1, layer: "target" } });
    seed();

    await changeReviewWorkflow(OPERATION);

    // The before image uploaded successfully before the after failed. Left
    // behind it would be a customer's product sitting in storage with nothing
    // pointing at it — and a UI that rendered it alone would read as "the
    // change deleted the page" (§32).
    expect(storage.current.objects.size).toBe(0);
    expect(storage.current.removed).toContain(`${PROJECT}/${ARTIFACT}/before.png`);
  });

  it("blames the provider when the session could not be created", async () => {
    capture.current = fakeCaptureProvider({ failAt: { index: 0, layer: "provider" } });
    seed();

    await changeReviewWorkflow(OPERATION);

    // A provider outage is a different problem from a page that will not load,
    // and the user can act on exactly one of them (§31).
    expect(artifact().failure_code).toBe("review_browser_unavailable");
  });

  it("fails when storage refuses the image", async () => {
    seed();
    storage.current.failUpload = true;

    await changeReviewWorkflow(OPERATION);

    expect(artifact().status).toBe("failed");
    expect(artifact().failure_code).toBe("review_storage_failed");
  });

  it("still records the spend of a failed comparison", async () => {
    capture.current = fakeCaptureProvider({ failAt: { index: 1, layer: "target" } });
    seed();

    await changeReviewWorkflow(OPERATION);

    // The browser ran either way. A ledger that only records successes
    // systematically understates unit economics.
    const [usage] = db.current.rows("review_browser_usage");
    expect(usage.status).toBe("failed");
    expect(usage.duration_ms).toBe(4321);
  });
});

describe("the preview must still be there", () => {
  it("refuses when the preview stopped before the capture ran", async () => {
    seed({ previewStatus: "stopped" });

    await changeReviewWorkflow(OPERATION);

    // Between the click and this step there is a queue, and a fifteen-minute
    // preview can end inside it (§6).
    expect(artifact().status).toBe("failed");
    expect(artifact().failure_code).toBe("review_preview_required");
    expect(capture.current.sessions()).toBe(0);
  });

  it("refuses when the preview has no reachable origin", async () => {
    previewOrigin.current = null;
    seed();

    expect(capture.current.sessions()).toBe(0);
    await changeReviewWorkflow(OPERATION);

    expect(artifact().failure_code).toBe("review_preview_required");
    // Nothing was photographed, so nothing was paid for.
    expect(capture.current.sessions()).toBe(0);
  });
});

describe("ownership", () => {
  it("takes the project from the operation row, never from the artifact", async () => {
    seed();
    // An artifact claiming a different project, reachable only if the step
    // trusted the artifact instead of the persisted operation.
    db.current.rows("review_artifacts")[0].project_id = "project_other";

    await changeReviewWorkflow(OPERATION);

    expect(capture.current.sessions()).toBe(0);
    expect(storage.current.objects.size).toBe(0);
  });
});
