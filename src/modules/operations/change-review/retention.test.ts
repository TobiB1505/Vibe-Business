import { describe, expect, it, vi } from "vitest";
import { FakeDatabase, fakeSupabase } from "../test-support";
import { EXPIRED_SWEEP_LIMIT, sweepExpiredReviewScreenshots } from "./retention";

/**
 * VB-004 — the seven-day screenshot retention is actually executed.
 *
 * It was declared in Sprint 11A and honoured everywhere it was *read*: an
 * expired artifact never mints a signed URL, is never reused, and cannot back
 * an approval. What never happened is the deletion, so images of a customer's
 * product stayed in the bucket past a deadline the product had set itself.
 */

const PROJECT = "project_1";
const OTHER_PROJECT = "project_2";
const NOW = new Date("2026-08-27T22:00:00.000Z");

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** A stored comparison, with both images where the bucket layout puts them. */
function artifact(db: FakeDatabase, id: string, expiresAt: string, projectId = PROJECT) {
  db.seed("review_artifacts", {
    id,
    project_id: projectId,
    before_object_path: `${projectId}/${id}/before.png`,
    after_object_path: `${projectId}/${id}/after.png`,
    expires_at: expiresAt,
  });
}

/** Captures what the sweep asked storage to remove. */
function storageSpy(db: FakeDatabase) {
  const removed: string[][] = [];
  const client = fakeSupabase(db) as unknown as {
    storage: { from: (bucket: string) => { remove: (paths: string[]) => Promise<{ error: null }> } };
  };
  client.storage = {
    from: () => ({
      remove: async (paths: string[]) => {
        removed.push(paths);
        return { error: null };
      },
    }),
  };
  return { client: client as never, removed };
}

describe("what it deletes", () => {
  it("removes both images of an artifact past its deadline", async () => {
    const db = new FakeDatabase();
    artifact(db, "expired_1", daysFromNow(-1));
    const { client, removed } = storageSpy(db);

    const outcome = await sweepExpiredReviewScreenshots(client, { projectId: PROJECT, now: NOW });

    expect(outcome).toEqual({ removed: 2, failed: false });
    expect(removed).toEqual([
      [`${PROJECT}/expired_1/before.png`, `${PROJECT}/expired_1/after.png`],
    ]);
  });

  it("takes every expired artifact in one call", async () => {
    const db = new FakeDatabase();
    artifact(db, "expired_1", daysFromNow(-1));
    artifact(db, "expired_2", daysFromNow(-30));
    const { client, removed } = storageSpy(db);

    await sweepExpiredReviewScreenshots(client, { projectId: PROJECT, now: NOW });

    expect(removed).toHaveLength(1);
    expect(removed[0]).toHaveLength(4);
  });
});

describe("what it must not delete", () => {
  /** The point of a retention period is that it has not run out yet. */
  it("leaves a live artifact alone", async () => {
    const db = new FakeDatabase();
    artifact(db, "live", daysFromNow(3));
    const { client, removed } = storageSpy(db);

    const outcome = await sweepExpiredReviewScreenshots(client, { projectId: PROJECT, now: NOW });

    expect(outcome).toEqual({ removed: 0, failed: false });
    expect(removed).toEqual([]);
  });

  /**
   * The sweep runs with a service-role client, which RLS does not constrain, so
   * the project filter is the only thing keeping it inside one tenant. That
   * makes this the load-bearing assertion in the file.
   */
  it("never reaches another project's screenshots", async () => {
    const db = new FakeDatabase();
    artifact(db, "mine", daysFromNow(-1));
    artifact(db, "theirs", daysFromNow(-1), OTHER_PROJECT);
    const { client, removed } = storageSpy(db);

    await sweepExpiredReviewScreenshots(client, { projectId: PROJECT, now: NOW });

    expect(removed.flat()).toEqual([
      `${PROJECT}/mine/before.png`,
      `${PROJECT}/mine/after.png`,
    ]);
  });

  it("does not call storage at all when there is nothing to remove", async () => {
    const db = new FakeDatabase();
    const { client, removed } = storageSpy(db);

    expect(await sweepExpiredReviewScreenshots(client, { projectId: PROJECT, now: NOW })).toEqual({
      removed: 0,
      failed: false,
    });
    expect(removed).toEqual([]);
  });

  /** A failed capture leaves one side null; the other is still worth removing. */
  it("skips a missing path rather than sending an empty string to storage", async () => {
    const db = new FakeDatabase();
    db.seed("review_artifacts", {
      id: "half",
      project_id: PROJECT,
      before_object_path: `${PROJECT}/half/before.png`,
      after_object_path: null,
      expires_at: daysFromNow(-1),
    });
    const { client, removed } = storageSpy(db);

    await sweepExpiredReviewScreenshots(client, { projectId: PROJECT, now: NOW });

    expect(removed).toEqual([[`${PROJECT}/half/before.png`]]);
  });
});

describe("when it cannot finish", () => {
  it("reports a failed removal rather than claiming the bytes are gone", async () => {
    const db = new FakeDatabase();
    artifact(db, "expired_1", daysFromNow(-1));
    const client = fakeSupabase(db) as unknown as { storage: unknown };
    client.storage = {
      from: () => ({ remove: async () => ({ error: { message: "storage is down" } }) }),
    };

    expect(
      await sweepExpiredReviewScreenshots(client as never, { projectId: PROJECT, now: NOW }),
    ).toEqual({ removed: 0, failed: true });
  });

  it("reports a failed read rather than concluding there was nothing expired", async () => {
    const db = new FakeDatabase();
    artifact(db, "expired_1", daysFromNow(-1));
    db.failNextReadWith = { table: "review_artifacts", message: "boom" };
    const { client, removed } = storageSpy(db);

    expect(await sweepExpiredReviewScreenshots(client, { projectId: PROJECT, now: NOW })).toEqual({
      removed: 0,
      failed: true,
    });
    expect(removed).toEqual([]);
  });
});

describe("the batch is bounded", () => {
  /**
   * A loop guard rather than a product limit: one artifact per review means
   * reaching this says something else is wrong. The next review takes the rest.
   */
  it("stops at the cap", async () => {
    const db = new FakeDatabase();
    for (let i = 0; i < EXPIRED_SWEEP_LIMIT + 25; i += 1) {
      artifact(db, `expired_${1000 + i}`, daysFromNow(-1));
    }
    const { client, removed } = storageSpy(db);

    await sweepExpiredReviewScreenshots(client, { projectId: PROJECT, now: NOW });

    expect(removed[0]).toHaveLength(EXPIRED_SWEEP_LIMIT * 2);
  });
});

describe("the step around it", () => {
  /**
   * The work the customer asked for is finished and recorded by the time this
   * runs. A storage outage must not turn a completed review into a retrying
   * step, and must certainly not turn it into a failed one.
   */
  it("never throws, whatever the sweep does", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sweepExpiredScreenshotsStep } = await import("./execution");

    const exploding = {
      from: () => {
        throw new Error("boom");
      },
    } as never;

    await expect(
      sweepExpiredScreenshotsStep({ supabase: exploding } as never, "operation_1"),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
