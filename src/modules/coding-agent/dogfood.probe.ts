import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { getLatestCompletedActionPlan } from "@/modules/action-plans/store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { resolvePlanExecution } from "@/modules/execution-contract/resolver";
import { buildExecutionSpec } from "@/modules/execution-contract/spec";
import { resolveExecutionValidation } from "@/modules/execution-contract/validation-requirements";
import { compileExecutionPolicy } from "@/modules/execution-contract/policy";
import { AGENT_DISCOVERY_SCOPE, deriveAgentLimits } from "./budget";
import { resolveAgentEconomics } from "./authorization";
import { compileAgentInstruction } from "./prompt";
import { renderAgentPreflight, runAgentPreflight } from "./preflight";
import { AGENTIC_EXECUTION_CONFIG } from "@/modules/ai/operations";

/**
 * The EXECUTION CORE-4 dogfood preflight harness (§43, §44).
 *
 * **Dev-only. Not part of the test suite.** The file is `*.probe.ts`, and
 * `vitest.config.mts` includes only `*.test.ts`, so CI can never reach the
 * database or a provider through it. Run it explicitly:
 *
 * ```
 * NEXT_PUBLIC_SUPABASE_URL=… \
 * SUPABASE_SERVICE_ROLE_KEY=… \
 * VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS=<uuid> \
 * VIBE_DOGFOOD_PROJECT_ID=<uuid> \
 * pnpm agent:preflight
 * ```
 *
 * ## What it does, and what it deliberately does not
 *
 * It reads the project's **real current** Action Plan and repository snapshot,
 * resolves every step through the deterministic resolver, builds the real
 * ExecutionSpec for the first agentic one, compiles the real policy and budget,
 * renders the real agent instruction, and prints the §43 preflight.
 *
 * It **spends nothing**. No provider request, no sandbox, no branch, no Credit.
 * Everything above is deterministic by construction, which is exactly why a
 * preflight of it is free — and why it can be run as many times as it takes
 * before anyone approves the first paid run.
 *
 * It **writes nothing** — no spec row, no run, no audit event. A preflight is
 * an evaluation, not a product action.
 *
 * Starting the paid run is a separate, deliberate act through
 * `startAgentExecution`, which re-derives all of this server-side. This harness
 * exists so that act is made with the whole picture on screen (§43).
 */

const PROJECT_ID = process.env.VIBE_DOGFOOD_PROJECT_ID;

describe("EXECUTION CORE-4 — agent preflight against a real project", () => {
  it("resolves the project's current plan and prepares the first agentic step", async () => {
    expect(
      PROJECT_ID,
      "VIBE_DOGFOOD_PROJECT_ID is required — the preflight reads a real project's current plan.",
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

    const [plan, snapshot] = await Promise.all([
      getLatestCompletedActionPlan(supabase, PROJECT_ID!),
      getLatestSuccessfulSnapshot(supabase, PROJECT_ID!),
    ]);

    expect(plan, "The project has no completed Action Plan to execute from.").toBeTruthy();
    expect(snapshot?.result, "The project has no successful repository snapshot.").toBeTruthy();

    const economics = resolveAgentEconomics({ projectId: PROJECT_ID!, pricingClass: "standard" });

    console.log("");
    console.log("EXECUTION CORE-4 — DOGFOOD PREFLIGHT");
    console.log("====================================");
    console.log(`project              ${PROJECT_ID}`);
    console.log(`plan                 ${plan!.id}`);
    console.log(`repository           ${snapshot!.result!.repository.fullName}`);
    console.log(`analyzed commit      ${snapshot!.result!.source.commitSha}`);
    console.log(`model                ${AGENTIC_EXECUTION_CONFIG.model} (${AGENTIC_EXECUTION_CONFIG.effort})`);
    console.log(
      `economics            ${economics?.budget.budgetPolicyVersion ?? "not authorized"}`,
    );
    console.log("");

    const resolutions = resolvePlanExecution({
      plan: { steps: plan!.steps, completedSteps: new Set<number>(), isCurrent: true },
      repository: {
        connection: {
          id: "preflight",
          fullName: snapshot!.result!.repository.fullName,
          defaultBranch: snapshot!.result!.repository.defaultBranch,
        },
        snapshot: snapshot!.result!,
        snapshotId: snapshot!.id,
        snapshotCommitSha: snapshot!.result!.source.commitSha,
        snapshotIsLatest: true,
        // Deliberately unread. Probing GitHub for the live HEAD needs an
        // installation token in a dev harness, and admission already models an
        // unread HEAD honestly: it refuses with `source_revision_unverified`
        // rather than assuming the repository has not moved. The *route* — what
        // this harness exists to evaluate — is unaffected.
        liveHead: null,
      },
      agenticBudgetAuthorized: economics !== null,
    });

    console.log("Step routes");
    for (const resolution of resolutions) {
      const step = plan!.steps.find((candidate) => candidate.order === resolution.stepOrder);
      console.log(
        `  ${String(resolution.stepOrder).padStart(2)}  ${resolution.mode.padEnd(18)} ${resolution.reason.padEnd(34)} ${step?.title ?? ""}`,
      );
    }
    console.log("");

    const agentic = resolutions.find((resolution) => resolution.mode === "agentic");
    if (!agentic) {
      console.log("No step on this plan resolves to an agentic route. Nothing to preflight.");
      return;
    }

    const step = plan!.steps.find((candidate) => candidate.order === agentic.stepOrder)!;
    const validation = resolveExecutionValidation(snapshot!.result!);
    const budget = economics?.budget ?? null;

    const writeScope = {
      discovery: { ...AGENT_DISCOVERY_SCOPE },
      mutation: {
        maxChangedFiles: budget?.maxChangedFiles ?? 0,
        maxChangedBytes: budget?.maxChangedBytes ?? 0,
        forbiddenPathClasses: [],
      },
    };

    /*
     * A spec needs the plan's goal, its expected outcome and its lineage, and
     * all four are nullable on a stored plan.
     *
     * Asserted rather than defaulted. A spec built with a placeholder goal is
     * an instruction package that cannot be traced back to the business problem
     * it serves — and the agent would be told to work toward an empty string.
     * A plan missing any of them is not one this preflight can proceed from,
     * and saying so is the honest answer.
     */
    expect(plan!.goal, "The plan has no recorded goal.").toBeTruthy();
    expect(plan!.expectedOutcome, "The plan has no recorded expected outcome.").toBeTruthy();
    expect(plan!.opportunityId, "The plan does not trace to a Move.").toBeTruthy();
    expect(plan!.businessAuditId, "The plan does not trace to an audit.").toBeTruthy();

    const spec = buildExecutionSpec({
      resolution: agentic,
      step,
      plan: {
        id: plan!.id,
        goal: plan!.goal!,
        expectedOutcome: plan!.expectedOutcome!,
        assumptions: plan!.assumptions,
        opportunityId: plan!.opportunityId!,
        businessAuditId: plan!.businessAuditId!,
      },
      projectId: PROJECT_ID!,
      repository: {
        repositoryConnectionId: "preflight",
        fullName: snapshot!.result!.repository.fullName,
        defaultBranch: snapshot!.result!.repository.defaultBranch,
        baseSha: snapshot!.result!.source.commitSha,
        repositorySnapshotId: snapshot!.id,
        frameworks: snapshot!.result!.frameworks.map((framework) => framework.id),
        packageManager: snapshot!.result!.packageManager ?? "unknown",
        workspaceRoot: validation.supported ? validation.workspaceRoot : ".",
        installRoot: validation.supported ? validation.installRoot : ".",
      },
      approvedDecisions: [],
      validation,
      budget,
      credit: { quoteId: null, maxAuthorizedCredits: budget?.maxCredits ?? null },
      writeScope,
      // Preparation the resolver folded into this boundary (semantics fix §12).
      // Read from the plan by the orders the resolver named, never chosen here:
      // `buildExecutionSpec` refuses if the two disagree.
      preparationSteps: agentic.absorbedPreparation.map(
        (order) => plan!.steps.find((candidate) => candidate.order === order)!,
      ),
      createdAt: new Date().toISOString(),
    });

    // The compiled policy the runtime would actually enforce, printed so the
    // grants can be read before anything runs rather than inferred afterwards.
    const policy = compileExecutionPolicy({
      mode: agentic.mode,
      executionClass: agentic.executionClass,
      riskClass: agentic.riskClass,
      writeScope,
    });

    console.log(`Selected step        #${step.order} — ${step.title}`);
    if (spec.objective.preparation.length > 0) {
      console.log("absorbed preparation");
      for (const preparation of spec.objective.preparation) {
        console.log(`  #${preparation.stepOrder} — ${preparation.title}`);
      }
    }
    console.log(`spec identity        ${spec.identity}`);
    console.log("");

    const preflight = runAgentPreflight({ resolution: agentic, spec, economics });
    console.log(renderAgentPreflight(preflight));
    console.log("");

    if (budget) {
      const limits = deriveAgentLimits({ budget, policy });
      const instruction = compileAgentInstruction({
        spec,
        limits,
        availableChecks: ["typecheck", "test", "build"],
      });

      console.log("Agent instruction (system)");
      console.log("--------------------------");
      console.log(instruction.system);
      console.log("");
      console.log("Agent instruction (user turn)");
      console.log("-----------------------------");
      console.log(instruction.userMessage);
      console.log("");
      console.log(`compiler version     ${instruction.compilerVersion}`);
    }

    console.log("");
    console.log("PRODUCTION AGENT CREDIT PRICE: NOT ACTIVATED");
    console.log("Nothing was spent, written or started by this preflight.");
  });
});
