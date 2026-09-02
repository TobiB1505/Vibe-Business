import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { FIXTURE_COMMIT_SHA } from "@/modules/validation/test-support";
import { computeReviewIdentity } from "./identity";
import { REVIEW_POLICY } from "./policy";
import { REVIEW_POLICY_VERSION, reviewProfileVersionFor } from "./schema";
import { getReviewCard, getReviewImages } from "./service";
import { fakeStorage, withFakeStorage } from "./test-support";

/**
 * Reading a historical visual review: authority and privacy (ADR 0074).
 *
 * The capture path is gone — no route reaches it, no operation starts one, and
 * the provider client was deleted. What remains is the read side, which one
 * historical approval still depends on, and its two failure modes are the ones
 * that were always the dangerous ones: handing an image to somebody who does
 * not own it, and handing one out past its retention deadline.
 *
 * Every test asserts against fake storage that opens no browser, so "zero
 * browser sessions" stays a counter rather than a reading of the source.
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
let storage: ReturnType<typeof fakeStorage>;

const LATER = () => new Date(Date.now() + 10 * 60 * 1000).toISOString();
const EARLIER = () => new Date(Date.now() - 10 * 60 * 1000).toISOString();

function client() {
  return withFakeStorage(fakeSupabase(db), storage);
}

function identityFor() {
  return computeReviewIdentity({
    projectId: PROJECT,
    preparedChangeId: PREPARED,
    preparedCommitSha: FIXTURE_COMMIT_SHA,
    validationRunId: VALIDATION,
    previewSessionId: PREVIEW,
    beforeOrigin: ORIGIN,
    route: REVIEW_POLICY.route,
    reviewProfile: "public_visual_review_v1",
    reviewProfileVersion: reviewProfileVersionFor("public_visual_review_v1"),
    reviewPolicyVersion: REVIEW_POLICY_VERSION,
  });
}

function seed() {
  db.seed("projects", { id: PROJECT, user_id: USER, production_url: ORIGIN });
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
    status: "passed",
    prepared_commit_sha: FIXTURE_COMMIT_SHA,
    created_at: "2026-08-14T00:00:00.000Z",
  });
}

beforeEach(() => {
  db = new FakeDatabase();
  storage = fakeStorage();
});

describe("no hidden spend", () => {
  it("opens no browser session when the panel is read", async () => {
    seed();

    const card = await getReviewCard(client(), {
      projectId: PROJECT,
      preparedChangeId: PREPARED,
      resolveFailureMessage: () => "safe copy",
    });

    // The regression this exists for (Sprint 11A §40). Reading a page is not
    // asking to spend money. With the capture path deleted there is no code
    // left that could, but the assertion is what would catch a reintroduction.
    expect(card.state).toBe("not_generated");
    expect(db.rows("review_artifacts")).toHaveLength(0);
    expect(db.rows("operation_runs")).toHaveLength(0);
    expect(db.rows("review_browser_usage")).toHaveLength(0);
    expect(storage.signed).toEqual([]);
  });

  it("records no AI usage", async () => {
    seed();

    await getReviewCard(client(), {
      projectId: PROJECT,
      preparedChangeId: PREPARED,
      resolveFailureMessage: () => null,
    });

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
