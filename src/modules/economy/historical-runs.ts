import type { StepChangeKind } from "@/modules/action-plans/schema";
import { deriveExecutionSurfaceRequirement } from "@/modules/execution-context/surface";
import type { ExecutionRiskClass } from "@/modules/execution-contract/schema";
import {
  classifyExecutionPricingClass,
  type ExecutionPricingClass,
  type ExecutionPricingClassReason,
} from "./execution-class";

/**
 * The historical reconstruction (Sprint 0052, Credit Economics v1, PART D).
 *
 * ## Where every field comes from
 *
 * Read directly from Supabase (`dcbwlctscooefwnivxzv`) on 2026-08-20 by this
 * sprint, joining `agent_execution_runs` → `execution_specs` →
 * `action_plan_steps` for the `status = 'succeeded'` runs, in creation order.
 * Sprint 0053 added run #9 the same way — same query, same tables, same day —
 * and recomputed its two derived figures with this repository's own
 * `deriveSandboxCost` and `VERCEL_SANDBOX_RATES` rather than transcribing them
 * from a document. The economic cost floor/upper-bound figures are **not** recomputed
 * here — they are copied from `docs/business/ECONOMY_MODEL.md`'s "Re-analysed
 * run costs (PART I)" table, which Sprint 0050/0051 already derived and
 * pinned in `run-economics.test.ts`. Restating them from a second source
 * would risk exactly the silent drift this sprint's own doctrine forbids.
 *
 * ## Run #9 is the first repeat of one step across a changed repository
 *
 * Runs #3–#6 repeat one step against an essentially unchanged tree. Run #9
 * repeats that *same* step (byte-identical `step_key`) against a repository
 * that had since gained `src/app/robots.ts`, `src/app/robots.test.ts` and
 * `src/lib/env/app-url.ts` — and cost 2.00× run #6's floor (2.16× in model
 * spend alone). Nothing about the
 * task changed; the agent read the files the repository had grown, which is
 * correct behaviour and an expensive one. It is the only same-step, changed-
 * repository pair in this dataset, which is why it is worth its own note.
 *
 * ## Run #8 is honestly weaker evidence than #3–#7
 *
 * Runs #3–#7 join to a real, persisted `action_plan_steps` row — their
 * `change_kind` and `evidence_ids` are read from the same table the
 * production pricing flow would read from. Run #8 is
 * `coding-agent/dogfood/fixtures.ts`'s `LOW_UI_PRIMARY_CTA` benchmark
 * fixture: the join to `action_plan_steps` returns null for `change_kind` and
 * `evidence_ids` because a dogfood run never persisted a plan step at all.
 * Its `changeKind`/`evidenceIds` below are read from the fixture's own source
 * instead — a real, structured value, but reconstructed from a different
 * table than the one a production classification would read, which is why
 * its `classificationConfidence` is `"limited"` rather than `"confirmed"`.
 * This is not a guess — the fixture's fields are exact — but the sprint's own
 * rule ("if a historical classification cannot be reconstructed with
 * confidence, mark it limited, never guess") is about the reconstruction
 * path, not just the answer, so it is marked down honestly.
 */

export type ClassificationConfidence = "confirmed" | "limited";

export type HistoricalRun = {
  run: number;
  /** The step's own title, exactly as persisted — documentation only, never a classification input. */
  title: string;
  createdAt: string;
  riskClass: ExecutionRiskClass;
  changeKind: StepChangeKind;
  evidenceIds: readonly string[];
  classificationConfidence: ClassificationConfidence;
  confidenceNote: string;
  /**
   * From `ECONOMY_MODEL.md`'s "Re-analysed run costs" table: model spend +
   * agent sandbox + validation sandbox (floor, when active CPU is unknown).
   */
  economicCostFloorNanoUsd: number;
  /**
   * Same components, with validation sandbox CPU assumed fully active — the
   * `deriveSandboxCost` upper bound. Equal to the floor for run #4, which was
   * never validated at all.
   */
  economicCostUpperNanoUsd: number;
  /**
   * The model-spend component alone, from `ai_usage_events` — exact, per
   * `backfill.test.ts`'s pinned `RUNS` fixture. Split out from the floor so
   * `stress-test.ts` can inflate AI provider cost and infrastructure cost
   * independently rather than scaling one opaque total by both factors at
   * once.
   */
  providerCostNanoUsd: number;
  /** False for every historical run — Sprint 0051's point-estimate fix applies only forward. */
  costIsPointEstimate: boolean;
};

export const HISTORICAL_RUNS: readonly HistoricalRun[] = [
  {
    run: 3,
    title: "Add robots meta directives to public and signed-in pages",
    createdAt: "2026-08-19T11:08:29.928Z",
    riskClass: "moderate",
    changeKind: "product_change",
    evidenceIds: ["live.seo.robots_meta_missing"],
    classificationConfidence: "confirmed",
    confidenceNote:
      "riskClass, changeKind and evidenceIds joined directly from execution_specs/action_plan_steps.",
    economicCostFloorNanoUsd: 433_100_000, // $0.4331
    economicCostUpperNanoUsd: 481_400_000, // $0.4814
    providerCostNanoUsd: 346_506_500, // $0.3465
    costIsPointEstimate: false,
  },
  {
    run: 4,
    title: "Add robots meta directives to public and signed-in pages",
    createdAt: "2026-08-19T16:01:46.312Z",
    riskClass: "moderate",
    changeKind: "product_change",
    evidenceIds: ["live.seo.robots_meta_missing"],
    classificationConfidence: "confirmed",
    confidenceNote:
      "riskClass, changeKind and evidenceIds joined directly from execution_specs/action_plan_steps. " +
      "This run was never validated, so its floor and upper bound are identical — there is no " +
      "validation-sandbox component to bound.",
    economicCostFloorNanoUsd: 284_500_000, // $0.2845
    economicCostUpperNanoUsd: 284_500_000, // $0.2845 — not validated
    providerCostNanoUsd: 227_170_000, // $0.2272
    costIsPointEstimate: false,
  },
  {
    run: 5,
    title: "Add robots meta directives to public and signed-in pages",
    createdAt: "2026-08-19T17:16:38.566Z",
    riskClass: "moderate",
    changeKind: "product_change",
    evidenceIds: ["live.seo.robots_meta_missing"],
    classificationConfidence: "confirmed",
    confidenceNote:
      "riskClass, changeKind and evidenceIds joined directly from execution_specs/action_plan_steps.",
    economicCostFloorNanoUsd: 354_200_000, // $0.3542
    economicCostUpperNanoUsd: 402_700_000, // $0.4027
    providerCostNanoUsd: 319_930_000, // $0.3199
    costIsPointEstimate: false,
  },
  {
    run: 6,
    title: "Add robots meta directives to public and signed-in pages",
    createdAt: "2026-08-19T18:45:03.611Z",
    riskClass: "moderate",
    changeKind: "product_change",
    evidenceIds: ["live.seo.robots_meta_missing"],
    classificationConfidence: "confirmed",
    confidenceNote:
      "riskClass, changeKind and evidenceIds joined directly from execution_specs/action_plan_steps. " +
      "This is the run whose actual changed files included an authenticated-area layout " +
      "(src/app/app/layout.tsx, per Sprint 0047's own benchmark) even though its evidence family " +
      "(live.seo.*) never implies the authenticated_pages scope — see the PART K limitation below.",
    economicCostFloorNanoUsd: 173_900_000, // $0.1739
    economicCostUpperNanoUsd: 224_500_000, // $0.2245
    providerCostNanoUsd: 144_400_000, // $0.1444
    costIsPointEstimate: false,
  },
  {
    run: 7,
    title: "Add canonical URLs to public pages",
    createdAt: "2026-08-19T19:42:47.998Z",
    riskClass: "moderate",
    changeKind: "product_change",
    evidenceIds: ["live.seo.canonical_missing"],
    classificationConfidence: "confirmed",
    confidenceNote:
      "riskClass, changeKind and evidenceIds joined directly from execution_specs/action_plan_steps.",
    economicCostFloorNanoUsd: 282_100_000, // $0.2821
    economicCostUpperNanoUsd: 328_900_000, // $0.3289
    providerCostNanoUsd: 251_500_000, // $0.2515
    costIsPointEstimate: false,
  },
  {
    run: 8,
    title: "Improve the primary landing-page call to action",
    createdAt: "2026-08-19T22:19:42.892Z",
    riskClass: "moderate",
    changeKind: "product_change",
    evidenceIds: ["live.conversion.primary_cta"],
    classificationConfidence: "limited",
    confidenceNote:
      "This run's action_plan_steps join is null (step_key 'dogfood-fixture--low-ui-primary-cta' " +
      "never persisted a plan step). changeKind/evidenceIds are read from " +
      "coding-agent/dogfood/fixtures.ts's LOW_UI_PRIMARY_CTA source instead — exact values, but " +
      "reconstructed from a different table than a production classification would read, so this " +
      "is marked limited rather than confirmed per the sprint's own rule.",
    economicCostFloorNanoUsd: 254_100_000, // $0.2541
    economicCostUpperNanoUsd: 301_700_000, // $0.3017
    providerCostNanoUsd: 214_400_000, // $0.2144
    costIsPointEstimate: false,
  },
  {
    run: 9,
    title: "Add robots meta directives to public and signed-in pages",
    createdAt: "2026-08-20T15:07:13.616Z",
    riskClass: "moderate",
    changeKind: "product_change",
    evidenceIds: ["live.seo.robots_meta_missing"],
    classificationConfidence: "confirmed",
    confidenceNote:
      "riskClass, changeKind and evidenceIds joined directly from execution_specs/action_plan_steps. " +
      "This run has the same step_key as run #6 ('4-product_change-add-robots-meta-directives-to-" +
      "public-and-signed-') on a real persisted plan step, which is what makes the two directly " +
      "comparable and is the whole reason this entry matters: identical step, identical pricing " +
      "class, 2.00x the cost floor and 2.16x the model spend. costIsPointEstimate stays false, " +
      "but for a different reason " +
      "than runs #3-8 — this run's *agent* sandbox did record active CPU (66,910 ms), and its " +
      "*validation* sandbox still recorded null sixteen minutes after Sprint 0051's fix deployed. " +
      "That null is the evidence Sprint 0051's fix did not work in production; see Sprint 0053's " +
      "reordering in validation/vercel/provider.ts, which is not yet verified against a real run.",
    economicCostFloorNanoUsd: 347_000_000, // $0.3470 (computed $0.347039)
    economicCostUpperNanoUsd: 395_400_000, // $0.3954 (computed $0.395402)
    providerCostNanoUsd: 311_505_500, // $0.3115055 — exact, 14 ai_usage_events
    costIsPointEstimate: false,
  },
];

export type ReconstructedClassification = {
  run: number;
  pricingClass: ExecutionPricingClass | null;
  reason: ExecutionPricingClassReason;
  surfaces: readonly string[];
  classificationConfidence: ClassificationConfidence;
};

/**
 * The v1 Execution Pricing Class each historical run would have received,
 * had this classifier existed at run time — computed from the same
 * pre-execution fields a live quote would use, never from the run's actual
 * outcome or cost.
 */
export function reconstructHistoricalClassification(run: HistoricalRun): ReconstructedClassification {
  const surfaceRequirement = deriveExecutionSurfaceRequirement({
    changeKind: run.changeKind,
    evidenceIds: run.evidenceIds,
  });

  const resolution = classifyExecutionPricingClass({
    riskClass: run.riskClass,
    changeKind: run.changeKind,
    evidenceIds: run.evidenceIds,
    surfaces: surfaceRequirement.surfaces,
  });

  return {
    run: run.run,
    pricingClass: resolution.pricingClass,
    reason: resolution.reason,
    surfaces: surfaceRequirement.surfaces,
    classificationConfidence: run.classificationConfidence,
  };
}

export const HISTORICAL_CLASSIFICATIONS: readonly ReconstructedClassification[] =
  HISTORICAL_RUNS.map(reconstructHistoricalClassification);
