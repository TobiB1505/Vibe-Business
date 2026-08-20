import type { StepChangeKind } from "@/modules/action-plans/schema";
import type { ExecutionRiskClass } from "@/modules/execution-contract/schema";
import type { ExecutionPricingClass } from "../execution-class";
import { HISTORICAL_RUNS, type ClassificationConfidence, type HistoricalRun } from "../historical-runs";
import { reconstructHistoricalClassification } from "../historical-runs";
import { type ConfidenceLevel, capConfidence, confidenceFromSampleSize } from "./confidence";

/**
 * What comparable work has actually cost (Sprint 0054, PART D).
 *
 * ## Why not the dataset mean
 *
 * Because the dataset mean answers a question nobody asked. "Runs cost $0.30 on
 * average" is true and useless for a specific SEO metadata change, which the
 * dataset happens to contain three near-neighbours of. The mean drags them
 * toward runs that share nothing with the work being estimated.
 *
 * So runs are matched on the fields a quote can actually see before execution —
 * pricing class, change kind, risk class, and how much evidence they cite in
 * common — and weighted by how well they match.
 *
 * ## Why weighting is a seam and not a formula
 *
 * Historical runs are not equally valuable forever. A run against Next.js 14 on
 * an older model in an older sandbox should eventually count for less than last
 * week's. That is real and it is not implementable here: the entire dataset
 * spans two days, one repository and one model, so an age or model decay curve
 * would be a shape fitted to noise.
 *
 * The answer is to make weighting a function the caller supplies, with the
 * deferred factors present and pinned at exactly 1. "Not yet weighted by age"
 * is then visible in the data rather than hidden in the absence of a field, and
 * a later decay policy is a new `HistoricalWeighting` rather than a change to
 * every call site.
 *
 * ## Why a `limited` run cannot raise confidence
 *
 * Run #8 is a dogfood fixture whose `change_kind` and `evidence_ids` were read
 * from a source file rather than from `action_plan_steps`. The values are
 * exact; the reconstruction path is not the production one. `historical-runs.ts`
 * already marks it `limited`, and a marker that nothing reads is a comment. It
 * contributes to the expected cost and caps the confidence.
 */

export const SIMILARITY_DIMENSIONS = ["pricing_class", "change_kind", "risk_class", "evidence_overlap"] as const;
export type SimilarityDimension = (typeof SIMILARITY_DIMENSIONS)[number];

/**
 * How much each dimension is worth. Pricing class dominates because it is the
 * one dimension already derived from all the others by a versioned policy.
 */
const DIMENSION_WEIGHTS: Record<SimilarityDimension, number> = {
  pricing_class: 0.45,
  change_kind: 0.2,
  risk_class: 0.15,
  evidence_overlap: 0.2,
};

/** Below this, a run is not a neighbour and does not enter the weighted mean. */
const MATCH_THRESHOLD = 0.3;

export type HistoricalRunWeight = {
  run: number;
  /** Computed by this sprint, from the dimensions above. */
  similarityFactor: number;
  /** Deferred: how much an older observation should count. Exactly 1 in v1. */
  ageFactor: number;
  /** Deferred: whether the observation came from a comparable model/provider generation. Exactly 1 in v1. */
  modelFactor: number;
  /** Deferred: whether the observation came from a comparable repository. Exactly 1 in v1. */
  repositoryFactor: number;
  finalWeight: number;
};

export type SimilarRun = {
  run: number;
  similarity: number;
  matched: readonly SimilarityDimension[];
  floorNanoUsd: number;
  upperNanoUsd: number;
  confidence: ClassificationConfidence;
  weight: HistoricalRunWeight;
};

export const HISTORICAL_BASES = ["class_matched", "kind_matched", "dataset_wide", "no_data"] as const;
export type HistoricalBasis = (typeof HISTORICAL_BASES)[number];

export type HistoricalExpectation = {
  matches: readonly SimilarRun[];
  /** Weighted mean of the matched runs' cost floors. Null when nothing matched. */
  expectedFloorNanoUsd: number | null;
  expectedUpperNanoUsd: number | null;
  basis: HistoricalBasis;
  sampleSize: number;
  confidence: ConfidenceLevel;
};

export type SimilarityInput = {
  pricingClass: ExecutionPricingClass | null;
  changeKind: StepChangeKind;
  riskClass: ExecutionRiskClass;
  evidenceIds: readonly string[];
};

/** A weighting policy. Takes the run and the instant the estimate is being made at. */
export type HistoricalWeighting = (run: HistoricalRun, similarityFactor: number, at: Date) => HistoricalRunWeight;

/**
 * The v1 policy: similarity only, with the three deferred factors at exactly 1.
 *
 * Pinned by a test, so "age is not yet accounted for" stays a visible fact
 * about the data rather than an omission a reader has to notice.
 */
export const SIMILARITY_ONLY_WEIGHTING: HistoricalWeighting = (run, similarityFactor) => ({
  run: run.run,
  similarityFactor,
  ageFactor: 1,
  modelFactor: 1,
  repositoryFactor: 1,
  finalWeight: similarityFactor,
});

function evidenceOverlap(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const left = new Set(a);
  const shared = b.filter((id) => left.has(id)).length;
  const union = new Set([...a, ...b]).size;

  return union === 0 ? 0 : shared / union;
}

function scoreRun(
  input: SimilarityInput,
  run: HistoricalRun,
): { similarity: number; matched: SimilarityDimension[]; pricingClass: ExecutionPricingClass | null } {
  const runClass = reconstructHistoricalClassification(run).pricingClass;
  const matched: SimilarityDimension[] = [];
  let similarity = 0;

  // A null pricing class on either side is not a match: an unclassifiable step
  // and a classified one are not comparable work, and treating two nulls as
  // equal would make every non-mutating step a neighbour of every other.
  if (input.pricingClass !== null && runClass !== null && input.pricingClass === runClass) {
    similarity += DIMENSION_WEIGHTS.pricing_class;
    matched.push("pricing_class");
  }

  if (input.changeKind === run.changeKind) {
    similarity += DIMENSION_WEIGHTS.change_kind;
    matched.push("change_kind");
  }

  if (input.riskClass === run.riskClass) {
    similarity += DIMENSION_WEIGHTS.risk_class;
    matched.push("risk_class");
  }

  const overlap = evidenceOverlap(input.evidenceIds, run.evidenceIds);
  if (overlap > 0) {
    similarity += DIMENSION_WEIGHTS.evidence_overlap * overlap;
    matched.push("evidence_overlap");
  }

  return { similarity, matched, pricingClass: runClass };
}

/**
 * What the expectation mostly rests on.
 *
 * Weight-majority rather than unanimity: a distant neighbour scraping past the
 * threshold contributes a little to the number and should not relabel where the
 * answer came from. Requiring every match to share the pricing class would make
 * one 0.35-weight outlier turn a five-run class match into "kind_matched", and
 * the label would then describe the weakest evidence rather than the answer.
 */
function basisFor(matches: readonly SimilarRun[], totalWeight: number): HistoricalBasis {
  if (matches.length === 0 || totalWeight === 0) return "no_data";

  const weightIn = (dimension: SimilarityDimension): number =>
    matches
      .filter((match) => match.matched.includes(dimension))
      .reduce((sum, match) => sum + match.weight.finalWeight, 0);

  if (weightIn("pricing_class") / totalWeight >= 0.5) return "class_matched";
  if (weightIn("change_kind") / totalWeight >= 0.5) return "kind_matched";
  return "dataset_wide";
}

export function findSimilarRuns(
  input: SimilarityInput,
  options: {
    dataset?: readonly HistoricalRun[];
    weighting?: HistoricalWeighting;
    at?: Date;
  } = {},
): HistoricalExpectation {
  const dataset = options.dataset ?? HISTORICAL_RUNS;
  const weighting = options.weighting ?? SIMILARITY_ONLY_WEIGHTING;
  const at = options.at ?? new Date(0);

  const matches: SimilarRun[] = dataset
    .map((run) => {
      const { similarity, matched } = scoreRun(input, run);
      return {
        run: run.run,
        similarity,
        matched,
        floorNanoUsd: run.economicCostFloorNanoUsd,
        upperNanoUsd: run.economicCostUpperNanoUsd,
        confidence: run.classificationConfidence,
        weight: weighting(run, similarity, at),
      };
    })
    .filter((match) => match.similarity >= MATCH_THRESHOLD && match.weight.finalWeight > 0)
    .sort((a, b) => b.weight.finalWeight - a.weight.finalWeight || a.run - b.run);

  const totalWeight = matches.reduce((sum, match) => sum + match.weight.finalWeight, 0);

  const weightedMean = (pick: (match: SimilarRun) => number): number | null =>
    totalWeight === 0
      ? null
      : Math.round(matches.reduce((sum, match) => sum + pick(match) * match.weight.finalWeight, 0) / totalWeight);

  // Every neighbour reconstructed from a non-production path caps the answer.
  // One `limited` run among three is still an answer nobody should call solid.
  const hasLimited = matches.some((match) => match.confidence === "limited");
  const sampleConfidence = confidenceFromSampleSize(matches.length);

  return {
    matches,
    expectedFloorNanoUsd: weightedMean((match) => match.floorNanoUsd),
    expectedUpperNanoUsd: weightedMean((match) => match.upperNanoUsd),
    basis: basisFor(matches, totalWeight),
    sampleSize: matches.length,
    confidence: hasLimited ? capConfidence(sampleConfidence, "low") : sampleConfidence,
  };
}
