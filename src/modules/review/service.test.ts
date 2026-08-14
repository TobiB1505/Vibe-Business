import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, FakeExecutor, fakeSupabase } from "@/modules/operations/test-support";
import { FIXTURE_COMMIT_SHA } from "@/modules/validation/test-support";
import { computeReviewIdentity } from "./identity";
import { REVIEW_POLICY } from "./policy";
import { REVIEW_POLICY_VERSION, reviewProfileVersionFor } from "./schema";
import { getReviewCard, getReviewImages, startChangeReview } from "./service";
import { fakeStorage, withFakeStorage } from "./test-support";

/**
 * Eligibility, authority and privacy (Sprint 11A §37, §38, §40, §41).
 *
 * Three families, and they are the three ways review goes wrong: photographing
 * the wrong thing, photographing something the caller does not own, and paying
 * for a browser nobody asked for.
 *
 * Every one asserts against a fake executor and fake storage that open no
 * browser, so "zero browser sessions" is a counter rather than a reading of the
 * source.
 */

const USER = "user_1";
const OTHER_USER = "user_2";
const PROJECT = "project_1";
const OTHER_PROJECT = "project_2";
const PREPARED = "prepared_1";
const VALIDATION = "validation_1";
const PREVIEW = "preview_1";
const ORIGIN = "https://vibe-business.example";

let db: FakeDatabase;
let executor: FakeExecutor;
let storage: ReturnType<typeof fakeStorage>;

const LATER = () => new Date(Date.now() + 10 * 60 * 1000).toISOString();
const EARLIER = () => new Date(Date.now() - 10 * 60 * 1000).toISOString();

function client() {
  return withFakeStorage(fakeSupabase(db), storage);
}

function identityFor(overrides: { previewSessionId?: string; policyVersion?: string } = {}) {
  return computeReviewIdentity({
    projectId: PROJECT,
    preparedChangeId: PREPARED,
    preparedCommitSha: FIXTURE_COMMIT_SHA,
    validationRunId: VALIDATION,
    previewSessionId: overrides.previewSessionId ?? PREVIEW,
    beforeOrigin: ORIGIN,
    route: REVIEW_POLICY.route,
    reviewProfile: "public_visual_review_v1",
    reviewProfileVersion: reviewProfileVersionFor("public_visual_review_v1"),
    reviewPolicyVersion: overrides.policyVersion ?? REVIEW_POLICY_VERSION,
  });
}

function seed(
  options: {
    productionUrl?: string | null;
    validationStatus?: string;
    previewStatus?: string;
    previewExpiresAt?: string;
    previewPreparedChangeId?: string;
  } = {},
) {
  db.seed("projects", {
    id: PROJECT,
    user_id: USER,
    production_url: options.productionUrl === undefined ? ORIGIN : options.productionUrl,
  });
  db.seed("projects", { id: OTHER_PROJECT, user_id: OTHER_USER, production_url: ORIGIN });

  db.seed("prepared_changes", {
    id: PREPARED,
    project_id: PROJECT,
    user_id: USER,
    status: "prepared",
    commit_sha: FIXTURE_COMMIT_SHA,
    files: [{ path: "app/robots.ts", contentHash: "a".repeat(64), bytes: 408 }],
  });

  db.seed("validation_runs", {
    id: VALIDATION,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: PREPARED,
    status: options.validationStatus ?? "passed",
    prepared_commit_sha: FIXTURE_COMMIT_SHA,
    created_at: "2026-08-14T00:00:00.000Z",
  });

  db.seed("preview_sessions", {
    id: PREVIEW,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: options.previewPreparedChangeId ?? PREPARED,
    validation_run_id: VALIDATION,
    operation_run_id: "preview_op_1",
    artifact_snapshot_id: "snap_1",
    preview_profile: "nextjs_preview_v1",
    preview_identity: "p".repeat(64),
    provider: "vercel_sandbox",
    status: options.previewStatus ?? "running",
    stage: "completed",
    port: 3000,
    ready_at: new Date().toISOString(),
    expires_at: options.previewExpiresAt ?? LATER(),
  });
}

function start(params: { userId?: string; projectId?: string; previewSessionId?: string } = {}) {
  return startChangeReview(client(), executor, {
    projectId: params.projectId ?? PROJECT,
    userId: params.userId ?? USER,
    preparedChangeId: PREPARED,
    previewSessionId: params.previewSessionId ?? PREVIEW,
  });
}

beforeEach(() => {
  db = new FakeDatabase();
  executor = new FakeExecutor();
  storage = fakeStorage();
});

describe("eligibility", () => {
  it("starts one durable operation for a validated, running preview", async () => {
    seed();

    const outcome = await start();

    expect(outcome.kind).toBe("capturing");
    expect(executor.starts).toHaveLength(1);
    expect(executor.starts[0].operationType).toBe("change_review");
  });

  it("requires a preview when none is running", async () => {
    seed({ previewStatus: "stopped" });

    expect(await start()).toEqual({ kind: "failed", error: "review_preview_required" });
    expect(executor.starts).toHaveLength(0);
  });

  it("requires a preview that has not passed its deadline", async () => {
    seed({ previewExpiresAt: EARLIER() });

    // A preview past its deadline is being torn down. Photographing it would
    // race the teardown and produce whichever the browser reached first.
    expect(await start()).toEqual({ kind: "failed", error: "review_preview_required" });
  });

  it("blocks when the validation did not pass", async () => {
    seed({ validationStatus: "failed" });

    // "After" must be a *validated* artifact. Without that it is a screenshot
    // of something nobody checked builds.
    expect(await start()).toEqual({ kind: "failed", error: "review_preview_required" });
    expect(executor.starts).toHaveLength(0);
  });

  it("refuses a preview belonging to a different prepared change", async () => {
    seed({ previewPreparedChangeId: "prepared_other" });

    // The exact-linkage rule (§6). Comparing against a preview of a different
    // change would attribute someone else's diff to this one.
    expect(await start()).toEqual({ kind: "failed", error: "review_preview_required" });
  });

  it("reports a missing public origin honestly", async () => {
    seed({ productionUrl: null });

    expect(await start()).toEqual({ kind: "failed", error: "review_before_unavailable" });
    expect(executor.starts).toHaveLength(0);
  });
});

describe("authority", () => {
  it("refuses another user's project", async () => {
    seed();

    expect(await start({ userId: OTHER_USER })).toEqual({
      kind: "failed",
      error: "project_not_found",
    });
    expect(executor.starts).toHaveLength(0);
  });

  it("refuses a preview session from another project", async () => {
    seed();
    db.seed("preview_sessions", {
      id: "preview_other",
      project_id: OTHER_PROJECT,
      user_id: OTHER_USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      operation_run_id: "op_other",
      artifact_snapshot_id: "snap_other",
      preview_profile: "nextjs_preview_v1",
      preview_identity: "q".repeat(64),
      provider: "vercel_sandbox",
      status: "running",
      port: 3000,
      expires_at: LATER(),
    });

    // Named directly, with the caller's own project. Scoping is a query
    // predicate, so the other tenant's session is invisible rather than
    // forbidden — there is no path that reads it and then decides.
    expect(await start({ previewSessionId: "preview_other" })).toEqual({
      kind: "failed",
      error: "review_preview_required",
    });
  });

  it("accepts no parameter that could choose a URL, route, viewport or provider", async () => {
    seed();

    await start();

    const artifact = db.rows("review_artifacts")[0];
    // Everything consequential is server-resolved. The shape of
    // `StartReviewParams` is the real guarantee; these record what it produces,
    // so a widened input surface shows up here.
    expect(artifact.route).toBe(REVIEW_POLICY.route);
    expect(artifact.before_origin).toBe(ORIGIN);
    expect(artifact.provider).toBe("browserbase");
    expect(artifact.review_policy_version).toBe(REVIEW_POLICY_VERSION);
    expect(artifact.review_profile).toBe("public_visual_review_v1");
  });

  it("takes the before origin from the project, never from the caller", async () => {
    seed({ productionUrl: "https://the-real-product.example" });

    await start();

    // A caller who could name this could point Vibe's browser at any site and
    // have the screenshot stored under their project as though it were theirs.
    expect(db.rows("review_artifacts")[0].before_origin).toBe("https://the-real-product.example");
  });
});

describe("idempotency", () => {
  it("reuses an existing comparison for the same identity", async () => {
    seed();
    db.seed("review_artifacts", {
      id: "review_existing",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      preview_session_id: PREVIEW,
      operation_run_id: "op_old",
      review_profile: "public_visual_review_v1",
      review_identity: identityFor(),
      route: REVIEW_POLICY.route,
      before_origin: ORIGIN,
      status: "ready",
      expires_at: LATER(),
    });

    const outcome = await start();

    expect(outcome).toMatchObject({ kind: "reused", reviewArtifactId: "review_existing" });
    expect(executor.starts).toHaveLength(0);
  });

  it("does not reuse a comparison captured under a different policy", async () => {
    seed();
    db.seed("review_artifacts", {
      id: "review_old_policy",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      preview_session_id: PREVIEW,
      operation_run_id: "op_old",
      review_profile: "public_visual_review_v1",
      review_identity: identityFor({ policyVersion: "review-policy-v0" }),
      route: REVIEW_POLICY.route,
      before_origin: ORIGIN,
      status: "ready",
      expires_at: LATER(),
    });

    // Images captured under other viewport or settle rules describe conditions
    // that no longer exist (§19).
    expect((await start()).kind).not.toBe("reused");
  });

  it("does not reuse a comparison of a different preview session", async () => {
    seed();
    db.seed("review_artifacts", {
      id: "review_other_preview",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      preview_session_id: "preview_previous",
      operation_run_id: "op_old",
      review_profile: "public_visual_review_v1",
      review_identity: identityFor({ previewSessionId: "preview_previous" }),
      route: REVIEW_POLICY.route,
      before_origin: ORIGIN,
      status: "ready",
      expires_at: LATER(),
    });

    // "After" is a photograph of one specific running sandbox, not of a commit.
    expect((await start()).kind).not.toBe("reused");
  });

  it("turns a double click into one operation and one artifact", async () => {
    seed();

    const [first, second] = await Promise.all([start(), start()]);

    expect(db.rows("operation_runs")).toHaveLength(1);
    expect(db.rows("review_artifacts")).toHaveLength(1);
    expect(executor.starts).toHaveLength(1);
    expect([first.kind, second.kind]).toContain("capturing");
  });
});

describe("no hidden spend", () => {
  it("opens no browser session when the panel is read", async () => {
    seed();

    const card = await getReviewCard(client(), {
      projectId: PROJECT,
      preparedChangeId: PREPARED,
      resolveFailureMessage: () => "safe copy",
    });

    // The regression this exists for (§40). Reading a page is not asking to
    // spend money, and a browser session is billed by the second.
    expect(card.state).toBe("not_generated");
    expect(db.rows("review_artifacts")).toHaveLength(0);
    expect(db.rows("operation_runs")).toHaveLength(0);
    expect(db.rows("review_browser_usage")).toHaveLength(0);
    expect(executor.starts).toHaveLength(0);
  });

  it("starts nothing when a preview becomes ready", async () => {
    seed();

    // A running preview alone must never trigger a capture. Only the explicit
    // click does (§23).
    const card = await getReviewCard(client(), {
      projectId: PROJECT,
      preparedChangeId: PREPARED,
      resolveFailureMessage: () => null,
    });

    expect(card.state).toBe("not_generated");
    expect(executor.starts).toHaveLength(0);
  });

  it("records no AI usage", async () => {
    seed();

    await start();

    // Nothing in a review calls a model, so no inference row is earned (§22).
    expect(db.rows("ai_usage_events")).toHaveLength(0);
  });
});

describe("image authorization", () => {
  function seedReady(overrides: Record<string, unknown> = {}) {
    seed();
    db.seed("review_artifacts", {
      id: "review_ready",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      preview_session_id: PREVIEW,
      operation_run_id: "op_ready",
      review_profile: "public_visual_review_v1",
      review_identity: identityFor(),
      route: REVIEW_POLICY.route,
      before_origin: ORIGIN,
      before_object_path: `${PROJECT}/review_ready/before.png`,
      after_object_path: `${PROJECT}/review_ready/after.png`,
      before_capture_status: "captured",
      after_capture_status: "captured",
      before_sha256: "b".repeat(64),
      after_sha256: "c".repeat(64),
      before_width: REVIEW_POLICY.viewport.width,
      before_height: REVIEW_POLICY.viewport.height,
      after_width: REVIEW_POLICY.viewport.width,
      after_height: REVIEW_POLICY.viewport.height,
      status: "ready",
      expires_at: LATER(),
      ...overrides,
    });

    storage.objects.set(`${PROJECT}/review_ready/before.png`, new Uint8Array([1]));
    storage.objects.set(`${PROJECT}/review_ready/after.png`, new Uint8Array([2]));
  }

  function images(params: { userId?: string; projectId?: string } = {}) {
    return getReviewImages(client(), {
      projectId: params.projectId ?? PROJECT,
      userId: params.userId ?? USER,
      reviewArtifactId: "review_ready",
    });
  }

  it("signs both images for the owner", async () => {
    seedReady();

    const result = await images();

    expect(result?.beforeUrl).toBe(`signed:${PROJECT}/review_ready/before.png`);
    expect(result?.afterUrl).toBe(`signed:${PROJECT}/review_ready/after.png`);
  });

  it("refuses another user", async () => {
    seedReady();

    expect(await images({ userId: OTHER_USER })).toBeNull();
    // Nothing was signed. Authorization comes first, then signing — the other
    // order hands a capability to whoever asked (§34).
    expect(storage.signed).toEqual([]);
  });

  it("refuses another project", async () => {
    seedReady();

    expect(await images({ projectId: OTHER_PROJECT, userId: OTHER_USER })).toBeNull();
    expect(storage.signed).toEqual([]);
  });

  it("signs nothing for a comparison still capturing", async () => {
    seedReady({ status: "capturing" });

    expect(await images()).toBeNull();
    expect(storage.signed).toEqual([]);
  });

  it("signs nothing past the retention deadline", async () => {
    seedReady({ expires_at: EARLIER() });

    // An expired artifact never produces a retrieval URL, whatever a stale
    // client believes (§41).
    expect(await images()).toBeNull();
    expect(storage.signed).toEqual([]);
  });

  it("never persists a signed URL", async () => {
    seedReady();

    await images();

    // A signed URL is a bearer credential. Storing one would give it a lifetime
    // nobody controls (§16).
    //
    // `before_origin` is deliberately excluded: it is the origin that was
    // photographed, recorded on purpose so a historical comparison can say what
    // it looked at (§20). What must never appear is a *signed* URL — which
    // carries a token in a query string, and paths never do.
    const row = db.rows("review_artifacts")[0];
    const { before_origin, ...rest } = row;
    void before_origin;
    const stored = JSON.stringify(rest);

    expect(stored).not.toContain("signed:");
    expect(stored).not.toContain("token");
    expect(stored).not.toContain("?");
    // What *is* stored for each side is a plain object path.
    expect(row.before_object_path).toBe(`${PROJECT}/review_ready/before.png`);
  });
});
