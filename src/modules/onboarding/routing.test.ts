import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { getOnboardingRouting } from "./store";

/**
 * Where an unfinished project sends a founder (ONBOARDING-1, dogfood fix).
 *
 * The first version of this returned only the resumable project, and `/app`
 * redirected whenever there was one. The dogfood found what that means for the
 * one person it hurts most: a founder with working projects starts a second,
 * and from then on the workspace is unreachable — every visit bounces into the
 * new project's setup, and the shell's "back" link bounces straight back.
 *
 * So the property under test is not "which project resumes". It is **when the
 * flow is allowed to take over at all**, and the answer is: only before a
 * founder has anywhere else to be.
 */

type Row = { project_id: string; state: string; updated_at: string };

function fakeSupabase(rows: Row[] | { error: true }) {
  const requested: { table: string; ids: string[] }[] = [];

  const client = {
    from(table: string) {
      return {
        select() {
          return {
            in(_column: string, ids: string[]) {
              requested.push({ table, ids });
              return Promise.resolve(
                "error" in rows
                  ? { data: null, error: new Error("read failed") }
                  : { data: rows, error: null },
              );
            },
          };
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, requested };
}

const complete = (id: string, at: string): Row => ({
  project_id: id,
  state: "complete",
  updated_at: at,
});
const inProgress = (id: string, at: string, state = "add_live_product"): Row => ({
  project_id: id,
  state,
  updated_at: at,
});

describe("onboarding routing", () => {
  it("reports no unfinished setup and no history for a founder with no projects", async () => {
    const { client, requested } = fakeSupabase([]);

    await expect(getOnboardingRouting(client, [])).resolves.toEqual({
      resumableProjectId: null,
      hasCompleted: false,
    });

    // And asks the database nothing: first login is answered by the empty list.
    expect(requested).toEqual([]);
  });

  it("resumes the only project when nothing has ever been completed", async () => {
    const { client } = fakeSupabase([inProgress("p1", "2026-08-17T09:00:00Z")]);

    await expect(getOnboardingRouting(client, ["p1"])).resolves.toEqual({
      resumableProjectId: "p1",
      hasCompleted: false,
    });
  });

  /**
   * The dogfood case, and the reason this file exists. Both facts are true at
   * once — there *is* something unfinished, and there *is* a workspace — and it
   * is the second one that has to stop the redirect.
   */
  it("still reports the unfinished project once another has been completed", async () => {
    const { client } = fakeSupabase([
      complete("done", "2026-08-16T09:00:00Z"),
      inProgress("new", "2026-08-17T09:00:00Z"),
    ]);

    await expect(getOnboardingRouting(client, ["done", "new"])).resolves.toEqual({
      resumableProjectId: "new",
      hasCompleted: true,
    });
  });

  it("reports nothing to resume when every project is complete", async () => {
    const { client } = fakeSupabase([
      complete("a", "2026-08-15T09:00:00Z"),
      complete("b", "2026-08-16T09:00:00Z"),
    ]);

    await expect(getOnboardingRouting(client, ["a", "b"])).resolves.toEqual({
      resumableProjectId: null,
      hasCompleted: true,
    });
  });

  /** The most recently touched one, so resuming lands where the founder left. */
  it("picks the most recently updated unfinished project", async () => {
    const { client } = fakeSupabase([
      inProgress("older", "2026-08-15T09:00:00Z"),
      inProgress("newest", "2026-08-17T09:00:00Z", "product_reveal"),
      inProgress("middle", "2026-08-16T09:00:00Z"),
    ]);

    const routing = await getOnboardingRouting(client, ["older", "newest", "middle"]);
    expect(routing.resumableProjectId).toBe("newest");
  });

  /** Ownership is filtered in the query, not after it. */
  it("asks only for the caller's own projects", async () => {
    const { client, requested } = fakeSupabase([]);

    await getOnboardingRouting(client, ["p1", "p2"]);

    expect(requested).toEqual([{ table: "project_onboarding", ids: ["p1", "p2"] }]);
  });

  /**
   * A failed read must not be reported as "nothing unfinished". Swallowing it
   * would silently strand a founder mid-setup with no way back to it.
   */
  it("throws rather than reporting a clean slate when the read fails", async () => {
    const { client } = fakeSupabase({ error: true });

    await expect(getOnboardingRouting(client, ["p1"])).rejects.toThrow("read failed");
  });
});
