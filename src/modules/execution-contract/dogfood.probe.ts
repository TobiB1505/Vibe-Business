import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { getLatestCompletedActionPlan } from "@/modules/action-plans/store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { resolveExecutionBudget } from "./budget";
import { resolvePlanExecution } from "./resolver";
import { renderExecutionResolutionReport } from "./report";

import { liveConnections } from "@/modules/projects/repository-connection";
/**
 * The EXECUTION CORE-3 dogfood harness (§38, §39).
 *
 * **Dev-only. Not part of the test suite.** The file is `*.probe.ts`, and
 * `vitest.config.mts` includes only `*.test.ts`, so CI can never reach the
 * database through it. Run it explicitly:
 *
 * ```
 * NEXT_PUBLIC_SUPABASE_URL=… \
 * SUPABASE_SERVICE_ROLE_KEY=… \
 * VIBE_DOGFOOD_PROJECT_ID=<uuid> \
 * pnpm execution:dogfood
 * ```
 *
 * ## What it does, and what it deliberately does not
 *
 * It reads the project's **real current** Action Plan and repository snapshot
 * and resolves every step through the new resolver, printing the §38 table.
 *
 * It **runs no Planner call** (§38, §44 of the DoD). The plan already exists;
 * re-planning to evaluate a resolver would be paying for an answer we have.
 *
 * It **spends nothing**. No provider request, no sandbox, no browser. The
 * resolver is deterministic by design (§37), which is exactly why a dogfood of
 * it is free.
 *
 * It **writes nothing** — no spec row, no audit event. A dogfood is an
 * evaluation, not a product action.
 *
 * It does **not** probe GitHub for the live HEAD. Doing so would need an
 * installation token in a dev harness, and the resolver already models an
 * unread HEAD honestly: admission refuses with `source_revision_unverified`
 * rather than assuming the repository has not moved. The classification — which
 * is what this harness exists to evaluate — is unaffected.
 */

const PROJECT_ID = process.env.VIBE_DOGFOOD_PROJECT_ID;

describe("execution resolver — real product dogfood", () => {
  it("resolves every step of the project's current Action Plan", async () => {
    expect(
      PROJECT_ID,
      "VIBE_DOGFOOD_PROJECT_ID is required — the dogfood resolves a real project's current plan.",
    ).toBeTruthy();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(supabaseUrl && serviceKey, "Supabase URL and service role key are required.").toBeTruthy();

    // Read-only, and constructed here rather than through `createServiceClient`
    // so this harness cannot be mistaken for an application code path — only
    // `src/modules/operations/` may use that one (Rule 53).
    const supabase = createClient(supabaseUrl!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const projectId = PROJECT_ID!;
    const [plan, snapshot] = await Promise.all([
      getLatestCompletedActionPlan(supabase, projectId),
      getLatestSuccessfulSnapshot(supabase, projectId),
    ]);

    expect(plan, "the project has no completed Action Plan to resolve").toBeTruthy();

    const { data: connection } = await liveConnections(supabase, "id, full_name, default_branch")
      .eq("project_id", projectId)
      .maybeSingle();

    const budget = resolveExecutionBudget();

    const resolutions = resolvePlanExecution({
      plan: {
        steps: plan!.steps,
        // Nothing in the product completes a step yet, exactly as
        // `action-plans/sequence.ts` records. Passing an empty set is the
        // truthful state, not a simplification.
        completedSteps: new Set<number>(),
        isCurrent: plan!.status === "completed",
      },
      repository: {
        connection: connection
          ? {
              id: (connection as unknown as { id: string }).id,
              fullName: (connection as unknown as { full_name: string }).full_name,
              defaultBranch: (connection as unknown as { default_branch: string }).default_branch,
            }
          : null,
        snapshot: snapshot?.result ?? null,
        snapshotId: snapshot?.id ?? null,
        snapshotCommitSha: snapshot?.commitSha ?? null,
        snapshotIsLatest: snapshot !== null,
        // Not probed. See the header: unread is modelled as unknown, never as
        // unchanged.
        liveHead: null,
      },
      agenticBudgetAuthorized: budget !== null,
    });

    process.stdout.write(
      `\n${renderExecutionResolutionReport({
        plan: {
          id: plan!.id,
          goal: plan!.goal,
          steps: plan!.steps,
        },
        repository: {
          fullName: (connection as { full_name: string } | null)?.full_name ?? null,
          frameworks: (snapshot?.result?.frameworks ?? []).map((framework) => framework.id),
          packageManager: snapshot?.result?.packageManager ?? "unknown",
          snapshotCommitSha: snapshot?.commitSha ?? null,
        },
        budgetAuthorized: budget !== null,
        resolutions,
      })}\n\n`,
    );

    expect(resolutions).toHaveLength(plan!.steps.length);
  }, 60_000);
});
