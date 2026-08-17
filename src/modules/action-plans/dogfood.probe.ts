import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { getAIProvider } from "@/modules/ai/anthropic/client";
import { ACTION_PLANNING_CONFIG } from "@/modules/ai/operations";
import { calculateProviderCost } from "@/modules/ai/pricing";
import { buildEvidencePackV3 } from "@/modules/business-audit/evidence-v3";
import { getLatestSuccessfulAudit } from "@/modules/business-audit/store";
import { getLatestSuccessfulAuthenticatedSnapshot } from "@/modules/authenticated-product-intelligence/store";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { getLatestCompletedOpportunitySet } from "@/modules/opportunities/store";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { getFounderIntent } from "@/modules/projects/founder-intent-store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { renderActionPlanReport } from "./report";
import { runActionPlanning } from "./runner";
import { defaultPlannedOpportunity, resolvePlannerSource } from "./source";

/**
 * The CORE-2b dogfood harness (§62, §92–§98).
 *
 * **Dev-only. Not part of the test suite.** The file is `*.probe.ts`, and
 * `vitest.config.mts` includes only `*.test.ts`, so CI can never reach the
 * provider or the database through it. Run it explicitly:
 *
 * ```
 * NEXT_PUBLIC_SUPABASE_URL=… \
 * SUPABASE_SERVICE_ROLE_KEY=… \
 * ANTHROPIC_API_KEY=sk-ant-… \
 * VIBE_DOGFOOD_PROJECT_ID=<uuid> \
 * pnpm ai:dogfood-action-plan
 * ```
 *
 * ## What it does, and what it deliberately does not
 *
 * It reads the project's **real current** audit, Moves, Product Profile,
 * founder intent and snapshots; resolves the top-ranked Move exactly as
 * production would; runs one real, billable planning call; and prints the
 * report from `report.ts` with the measured cost.
 *
 * It **writes nothing**. No plan row, no step rows, no usage event, no audit
 * event. A dogfood run is an evaluation, not a product action, and a harness
 * that persisted would make "is this plan any good?" and "is this project's
 * current plan?" the same question.
 *
 * It also **seeds nothing** (§75, §92). The Move it plans is whichever one
 * currently ranks first — not an SEO Move planted to demonstrate that execution
 * classification can say yes. If the real top Move is a founder decision that
 * Vibe cannot execute, that is the result, and the report says so.
 *
 * Cost: one inference call at the audit's model and effort. Nothing is billed
 * before the free token count passes the input-budget gate.
 */

const PROJECT_ID = process.env.VIBE_DOGFOOD_PROJECT_ID;

describe("action planner — real product dogfood", () => {
  it(
    "plans the project's current top Move and reports what it produced",
    async () => {
      expect(
        process.env.ANTHROPIC_API_KEY,
        "ANTHROPIC_API_KEY is required — this makes a real, billable provider request.",
      ).toBeTruthy();
      expect(
        PROJECT_ID,
        "VIBE_DOGFOOD_PROJECT_ID is required — the dogfood plans a real project's current top Move.",
      ).toBeTruthy();

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      expect(supabaseUrl && serviceKey, "Supabase URL and service role key are required.").toBeTruthy();

      // Read-only, and constructed here rather than through
      // `createServiceClient` so this harness cannot be mistaken for an
      // application code path — only `src/modules/operations/` may use that one.
      const supabase = createClient(supabaseUrl!, serviceKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const projectId = PROJECT_ID!;
      const [audit, opportunitySet, repository, live, profile, founderIntent, authenticated] =
        await Promise.all([
          getLatestSuccessfulAudit(supabase, projectId),
          getLatestCompletedOpportunitySet(supabase, projectId),
          getLatestSuccessfulSnapshot(supabase, projectId),
          getLatestSuccessfulLiveSnapshot(supabase, projectId),
          getLatestProfile(supabase, projectId),
          getFounderIntent(supabase, projectId),
          getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
        ]);

      expect(audit?.result, "the project has no successful audit to plan within").toBeTruthy();
      expect(opportunitySet, "the project has no Moves to plan").toBeTruthy();
      expect(repository?.result, "the project has no repository snapshot").toBeTruthy();
      expect(live?.result, "the project has no live product snapshot").toBeTruthy();
      expect(profile, "the project has no Product Profile").toBeTruthy();

      // The real top Move. Never chosen for how easy it would be to execute.
      const move = defaultPlannedOpportunity(opportunitySet!.opportunities);
      expect(move, "the Move set is empty").toBeTruthy();

      /*
       * The chain check production gets for free (FIX §7).
       *
       * `getActionPlanReadiness` refuses with `move_stale` when the Move set was
       * prioritized from a different audit than the current one, so production can never
       * pair a Move with an audit it did not come from. This harness deliberately
       * bypasses readiness — that is how it can evaluate planner quality on data the
       * product would gate — and without this check that bypass silently mispairs them.
       *
       * The failure it produced was worse than useless: resolving a Move against a
       * foreign audit yields `no_legacy_match`, which reads as "the planner cannot find
       * the problem" when the truth is "these two rows are not part of the same chain".
       * The first real run hit exactly this — a Move set built from an evidence-pack-v2
       * audit, resolved against a v3 one, where the two vocabularies share no ids at all
       * and an overlap of zero was arithmetically guaranteed.
       */
      if (opportunitySet!.businessAuditId !== audit!.id) {
        process.stdout.write(
          "\nCHAIN STALE — not a planner failure.\n" +
            `  latest audit:            ${audit!.id}\n` +
            `  audit the Moves came from: ${opportunitySet!.businessAuditId}\n` +
            "  The Moves were prioritized from a different audit, so no Move here can be\n" +
            "  traced to a conclusion in the current one. Refresh the Moves (a paid run,\n" +
            "  and the user's action) before dogfooding this project.\n\n",
        );
      }
      expect(
        opportunitySet!.businessAuditId,
        "the Move set was prioritized from a different audit than the current one — refresh Moves first",
      ).toBe(audit!.id);

      /*
       * The source gate, exactly as production applies it (FIX §7, §9).
       *
       * The probe refuses here rather than planning anyway, so a dogfood run can never
       * spend on a Move whose business problem could not be named — and so the harness
       * cannot accidentally prove the planner works on input production would reject.
       */
      const resolution = resolvePlannerSource(audit!.result!, move!);
      expect(
        resolution.resolved,
        `source conclusion unresolved: ${resolution.resolved ? "" : resolution.reason}`,
      ).toBe(true);
      if (!resolution.resolved) return;

      const source = resolution.source;
      const pack = buildEvidencePackV3({
        productProfile: profile!.profile,
        founderIntent: founderIntent.intent,
        repository: repository!.result!,
        liveProduct: live!.result!,
        authenticatedProduct: authenticated?.result ?? null,
      });

      const outcome = await runActionPlanning({
        source,
        pack,
        repository: repository!.result!,
        provider: getAIProvider(),
        config: ACTION_PLANNING_CONFIG,
      });

      if (!outcome.ok) {
        process.stdout.write(
          `\nPLANNING FAILED: ${outcome.error}` +
            (outcome.diagnostic?.validationReason
              ? ` (${outcome.diagnostic.validationReason})`
              : "") +
            `\nlatency ${outcome.latencyMs} ms\n\n`,
        );
      }

      expect(outcome.ok, `planning failed: ${outcome.ok ? "" : outcome.error}`).toBe(true);
      if (!outcome.ok) return;

      const cost = calculateProviderCost({
        model: outcome.plan.model,
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
      });

      process.stdout.write(
        `\n${renderActionPlanReport({
          source,
          plan: outcome.plan,
          findings: outcome.findings,
          usage: outcome.usage,
          estimatedInputTokens: outcome.estimatedInputTokens,
          latencyMs: outcome.latencyMs,
          providerCostUsd: cost.totalUsd,
        })}\n\n`,
      );
    },
    // One structured judgement call, at the operation's own timeout plus room
    // for the database reads in front of it.
    ACTION_PLANNING_CONFIG.timeoutMs + 60_000,
  );
});
