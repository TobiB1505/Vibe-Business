import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { listBenchmarkFixtures } from "./fixtures";
import { prepareBenchmark, renderBenchmarkPreparation } from "./benchmark";

/**
 * The internal benchmark harness, as a command (Sprint 0045).
 *
 * **Dev-only. Not part of the test suite.** The file is `*.probe.ts`, and
 * `vitest.config.mts` includes only `*.test.ts`, so CI cannot reach a database
 * or a provider through it.
 *
 * ```
 * NEXT_PUBLIC_SUPABASE_URL=… \
 * SUPABASE_SERVICE_ROLE_KEY=… \
 * VIBE_DOGFOOD_PROJECT_ID=<uuid> \
 * VIBE_DOGFOOD_FIXTURE=low-ui-primary-cta \
 * pnpm agent:dogfood
 * ```
 *
 * ## It cannot spend money
 *
 * Not by policy — by construction. Everything it calls is deterministic:
 * resolver, spec builder, context compiler, verification classifier, completion
 * budget. It imports no provider client and no execution starter, so there is
 * no code path from this file to Anthropic, and a typo in a fixture name
 * produces a refusal rather than a run.
 *
 * ## It writes nothing
 *
 * No spec row, no run, no audit event. A preflight is an evaluation, not a
 * product action, and a benchmark that left rows behind every time somebody
 * checked its shape would pollute the very metrics it exists to produce.
 *
 * ## There is no longer a way to start a fixture run
 *
 * There used to be: the operator allowlist gated the website's Run button, and
 * a fixture step key handed to it started a real, paid benchmark through the
 * same idempotent `startAgentExecution` a founder reaches. [ADR 0092](../../../../docs/decisions/0092-the-agent-runs-as-the-product.md) removed
 * that allowlist so every customer can run the agent — which also means a
 * crafted step key would let any of them start a Vibe-authored task against
 * their own repository. So `previewAgentStep` resolves plan steps only, and
 * this harness is a dry run: it compiles a fixture through the production
 * pipeline and prints what a run would be given.
 *
 * The measurement the fixtures existed to produce comes from real runs now
 * ([ADR 0083](../../../../docs/decisions/0083-the-estimator-reads-the-runs.md)).
 */

const PROJECT_ID = process.env.VIBE_DOGFOOD_PROJECT_ID;
const FIXTURE_ID = process.env.VIBE_DOGFOOD_FIXTURE ?? "low-ui-primary-cta";
const EXPECTED_BASE = process.env.VIBE_DOGFOOD_BASE_SHA ?? null;

describe("internal benchmark harness — dry run", () => {
  it("compiles a fixture through the real execution pipeline, spending nothing", async () => {
    expect(
      PROJECT_ID,
      "VIBE_DOGFOOD_PROJECT_ID is required — a benchmark runs against a real project's repository.",
    ).toBeTruthy();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(supabaseUrl && serviceKey, "Supabase URL and service role key are required.").toBeTruthy();

    // Constructed here rather than through `createServiceClient` so this harness
    // cannot be mistaken for an application code path — only
    // `src/modules/operations/` may use that one (Rule 53).
    const supabase = createClient(supabaseUrl!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: project } = await supabase
      .from("projects")
      .select("id, user_id")
      .eq("id", PROJECT_ID!)
      .maybeSingle();

    expect(project, `Project ${PROJECT_ID} was not found.`).toBeTruthy();
    const userId = (project as { user_id: string }).user_id;

    const prepared = await prepareBenchmark(supabase, {
      fixtureId: FIXTURE_ID,
      projectId: PROJECT_ID!,
      userId,
      expectedBaseSha: EXPECTED_BASE,
      /*
       * A dry run compiles; it does not admit.
       *
       * Reading the live default branch needs the GitHub App credentials a
       * developer machine does not necessarily hold, and admission needs that
       * read to be real. So the preflight resolves against the analysed commit
       * and says so — and the run itself is started elsewhere, where the HEAD
       * is read for real and a moved branch refuses.
       */
      resolveAgainstAnalysedCommit: true,
    });

    if (!prepared.ok) {
      console.log("");
      console.log(`Benchmark refused: ${prepared.reason}`);
      console.log(
        "reason" in prepared && prepared.reason === "not_executable"
          ? `  ${prepared.preview.reason}`
          : `  ${"detail" in prepared ? prepared.detail : ""}`,
      );
      console.log("");
      console.log(`Known fixtures: ${listBenchmarkFixtures().map((f) => f.id).join(", ")}`);
      expect.fail(`the benchmark could not be prepared: ${prepared.reason}`);
      return;
    }

    console.log("");
    console.log(renderBenchmarkPreparation(prepared));
    console.log("");
    console.log("── This is a dry run, and there is no way to start it ──────");
    console.log("  A fixture step key no longer reaches the website's Run button (ADR 0092):");
    console.log("  the start path resolves steps of the project's own plan only.");
    console.log("");
    console.log(`  Would have run · model ${prepared.compiled.model} · max provider spend ` +
      `$${prepared.preview.economics.budget.maxProviderSpendUsd} · base ${prepared.compiled.baseSha}`);
    console.log("");

    // The assertions that make this a check and not only a printout.
    expect(prepared.compiled.contextFreshness).toBe("fresh");
    expect(prepared.compiled.policyContradiction).toBeNull();
    expect(prepared.preview.revisionVerified).toBe(false);
  }, 120_000);
});
