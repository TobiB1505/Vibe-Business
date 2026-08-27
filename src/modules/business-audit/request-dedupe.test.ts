import { describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { getLatestSuccessfulAudit } from "./store";

/**
 * VB-022 — wrapping the hot document reads in `cache()`, and what that does
 * **not** do.
 *
 * The intended benefit is per-render deduplication: the Business Health render
 * asks fourteen questions at once and several of the services answering them
 * re-read the same documents underneath — the audit three times, the repository
 * snapshot four.
 *
 * ## That benefit is not verified here, and cannot be
 *
 * `cache()` memoizes only inside a React render. These tests are not a render,
 * so every call is a miss — measured directly below rather than assumed. The
 * finding's own verification is a PostgREST log showing one fetch per document
 * per render, and that needs a signed-in session against a real database. The
 * browser suite points at a project that does not exist by design, so it cannot
 * produce one either.
 *
 * ## What these tests do pin, which is the risk rather than the reward
 *
 * These stores are shared with durable execution. A memoized read leaking
 * across a workflow step would hand a step stale state — far worse than the
 * duplicate fetch this is meant to remove. Both properties below say that
 * cannot happen, and both would fail if someone replaced `cache()` with a
 * process-wide memo, which is the plausible "improvement" to guard against.
 */

function countingSupabase(db: FakeDatabase, counter: { n: number }) {
  const real = fakeSupabase(db);
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (...args: unknown[]) => {
          counter.n += 1;
          return (target as { from: (...a: unknown[]) => unknown }).from(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as ReturnType<typeof fakeSupabase>;
}

describe("outside a render", () => {
  /**
   * The property durable execution depends on. A workflow step re-reads state
   * deliberately — to see what the previous step did — and a memo that
   * survived would answer with what it saw before the step ran.
   */
  it("memoizes nothing, so every read is fresh", async () => {
    const db = new FakeDatabase();
    const counter = { n: 0 };
    const supabase = countingSupabase(db, counter);

    await getLatestSuccessfulAudit(supabase, "project_1");
    await getLatestSuccessfulAudit(supabase, "project_1");
    await getLatestSuccessfulAudit(supabase, "project_1");

    expect(counter.n).toBe(3);
  });

  it("never serves one project's audit to another", async () => {
    const db = new FakeDatabase();
    const counter = { n: 0 };
    const supabase = countingSupabase(db, counter);

    await getLatestSuccessfulAudit(supabase, "project_1");
    await getLatestSuccessfulAudit(supabase, "project_2");

    // Two projects, two reads. A cache keyed on the client alone would have
    // served project_2 whatever project_1 got — the failure worth catching in
    // a multi-tenant read path, and the reason the key includes the id.
    expect(counter.n).toBe(2);
  });

  it("re-reads for a different client, so no answer crosses a request", async () => {
    const db = new FakeDatabase();
    const counter = { n: 0 };

    await getLatestSuccessfulAudit(countingSupabase(db, counter), "project_1");
    await getLatestSuccessfulAudit(countingSupabase(db, counter), "project_1");

    expect(counter.n).toBe(2);
  });
});
