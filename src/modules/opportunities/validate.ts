import { AUDIT_DIMENSIONS, type AuditDimensionId, type Confidence } from "@/modules/business-audit/schema";
import {
  EXECUTION_READINESS,
  EXECUTION_TYPES,
  MAX_OPPORTUNITIES,
  OPPORTUNITY_CATEGORIES,
  type BusinessOpportunity,
  type ExecutionReadiness,
  type ExecutionType,
  type OpportunityCategory,
  type OpportunityEffort,
  type OpportunityImpact,
} from "./schema";
import type { WireOpportunity } from "./wire-schema";

/**
 * Domain validation of a billed opportunity response (Sprint 8 §12, §14, §17).
 *
 * Schema compliance is not truthfulness. The provider guarantees the shape;
 * this layer decides whether the content is usable, and it is deliberately
 * willing to discard parts of a response we already paid for. The alternatives
 * are worse: a fabricated evidence id displayed as justification, or two
 * ranks both claiming to be first.
 *
 * The repair-versus-reject line:
 *
 *  - **Repaired** — things where the intent is unambiguous and dropping the
 *    whole set would waste a paid call: unknown evidence ids, duplicate
 *    opportunities, an over-long list, non-contiguous ranks.
 *  - **Rejected** — things where we cannot know what was meant: an entry with
 *    no valid dimension, no title, or no surviving evidence at all.
 *
 * Every repair is recorded in `validationNotes`, so a reviewer can see what
 * the model actually returned rather than only what survived.
 */

export type OpportunityValidationFailure = "structured_output_schema_invalid";

export type OpportunityValidationReason =
  | "no_valid_opportunities"
  | "all_opportunities_unsupported";

export type ValidatedOpportunities = {
  opportunities: BusinessOpportunity[];
  notes: string[];
};

export type OpportunityValidateResult =
  | { ok: true; result: ValidatedOpportunities }
  | { ok: false; error: OpportunityValidationFailure; reason: OpportunityValidationReason };

const IMPACT_VALUES = ["high", "medium", "low"] as const;
const MAX_EVIDENCE_IDS = 6;
const MAX_SECONDARY_DIMENSIONS = 2;
const MAX_DEPENDENCIES = 3;
const MAX_TEXT_LENGTH = 600;

function text(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}…` : collapsed;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function stringList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const kept: string[] = [];
  for (const entry of value) {
    const item = text(entry, 200);
    if (item !== null && !kept.includes(item)) kept.push(item);
    if (kept.length >= cap) break;
  }
  return kept;
}

/**
 * A deterministic key for "this is the same piece of work" (§17).
 *
 * Category plus primary dimension, which is coarse on purpose. No embeddings,
 * no similarity thresholds — a V0.1 duplicate is almost always the same
 * category attacked from two angles ("add pricing" / "create a pricing page"),
 * and a cheap exact key catches that without a model deciding what "similar"
 * means. Two genuinely different opportunities in one category is the cost,
 * and the higher-ranked one survives, which is the right one to keep.
 */
function semanticKey(category: OpportunityCategory, dimension: AuditDimensionId): string {
  return `${category}:${dimension}`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

type Candidate = {
  rank: number;
  opportunity: Omit<BusinessOpportunity, "rank" | "id">;
  key: string;
};

function readCandidate(
  entry: WireOpportunity,
  knownEvidenceIds: Set<string>,
  knownConclusionKeys: Set<string>,
  notes: string[],
): Candidate | null {
  const title = text(entry.title, 120);
  const problem = text(entry.problem);
  const whyNow = text(entry.whyNow);
  const impact = oneOf<OpportunityImpact>(entry.impact, IMPACT_VALUES);
  const effort = oneOf<OpportunityEffort>(entry.effort, IMPACT_VALUES);
  const confidence = oneOf<Confidence>(entry.confidence, IMPACT_VALUES);
  const category = oneOf<OpportunityCategory>(entry.category, OPPORTUNITY_CATEGORIES);
  const primaryDimension = oneOf<AuditDimensionId>(entry.primaryDimension, AUDIT_DIMENSIONS);
  const executionType = oneOf<ExecutionType>(entry.executionType, EXECUTION_TYPES);
  const executionReadiness = oneOf<ExecutionReadiness>(entry.executionReadiness, EXECUTION_READINESS);

  // Anything missing here leaves an entry we cannot render or reason about.
  if (
    title === null ||
    problem === null ||
    whyNow === null ||
    impact === null ||
    effort === null ||
    confidence === null ||
    category === null ||
    primaryDimension === null ||
    executionType === null ||
    executionReadiness === null
  ) {
    notes.push("An opportunity was discarded because required fields were missing or invalid.");
    return null;
  }

  const citedIds = stringList(entry.evidenceIds, MAX_EVIDENCE_IDS);
  const evidenceIds = citedIds.filter((id) => knownEvidenceIds.has(id));
  const dropped = citedIds.length - evidenceIds.length;
  if (dropped > 0) {
    notes.push(
      `${dropped} cited evidence id(s) did not exist in the evidence pack and were removed from "${title}".`,
    );
  }

  // An opportunity with no surviving evidence is an assertion, and this
  // product's entire claim is that it does not make those.
  if (evidenceIds.length === 0) {
    notes.push(`"${title}" was discarded because none of its evidence could be verified.`);
    return null;
  }

  const secondaryDimensions = stringList(entry.secondaryDimensions, MAX_SECONDARY_DIMENSIONS)
    .filter((value): value is AuditDimensionId => (AUDIT_DIMENSIONS as readonly string[]).includes(value))
    .filter((value) => value !== primaryDimension);

  const rank = typeof entry.rank === "number" && Number.isFinite(entry.rank) ? entry.rank : Number.MAX_SAFE_INTEGER;

  /*
   * The conclusion this Move addresses (CORE-2b FIX §1, §2).
   *
   * Verified against the audit's own keys and dropped otherwise, exactly as an evidence
   * id is. Unlike an evidence id, a missing one is **not** grounds for discarding the
   * opportunity: a Move that genuinely addresses no single conclusion is a legitimate,
   * if unusual, output, and the Action Planner is the layer that decides whether it can
   * plan without one. Enforcing it here would put a planning prerequisite inside
   * prioritization.
   */
  const citedConclusion = text(entry.sourceConclusionKey, 64);
  let sourceConclusionKey: string | null = null;
  if (citedConclusion !== null) {
    if (knownConclusionKeys.has(citedConclusion)) {
      sourceConclusionKey = citedConclusion;
    } else {
      notes.push(
        `"${title}" cited an audit conclusion that does not exist; its source conclusion was not recorded.`,
      );
    }
  }

  return {
    rank,
    key: semanticKey(category, primaryDimension),
    opportunity: {
      sourceConclusionKey,
      title,
      problem,
      whyNow,
      impact,
      effort,
      confidence,
      category,
      primaryDimension,
      secondaryDimensions,
      evidenceIds,
      executionType,
      executionReadiness,
      dependencies: stringList(entry.dependencies, MAX_DEPENDENCIES),
    },
  };
}

export function validateOpportunityOutput(
  entries: WireOpportunity[],
  knownEvidenceIds: Set<string>,
  /**
   * The conclusion keys this audit actually offers (CORE-2b FIX §2).
   *
   * Optional so every existing caller and fixture keeps working; an omitted set means
   * "no conclusion keys are verifiable", and every cited key is therefore dropped. That
   * is the honest degradation: an unverified lineage is worse than a missing one, since
   * the planner would trust it.
   */
  knownConclusionKeys: Set<string> = new Set(),
): OpportunityValidateResult {
  const notes: string[] = [];

  const candidates = entries
    .map((entry) => readCandidate(entry, knownEvidenceIds, knownConclusionKeys, notes))
    .filter((candidate): candidate is Candidate => candidate !== null);

  if (candidates.length === 0) {
    return {
      ok: false,
      error: "structured_output_schema_invalid",
      reason: entries.length === 0 ? "no_valid_opportunities" : "all_opportunities_unsupported",
    };
  }

  // The model's own ordering is authoritative; ties break by original
  // position so the result stays deterministic for an identical response.
  const ordered = [...candidates].sort((a, b) => a.rank - b.rank || candidates.indexOf(a) - candidates.indexOf(b));

  const seen = new Set<string>();
  const deduped: Candidate[] = [];
  for (const candidate of ordered) {
    if (seen.has(candidate.key)) {
      notes.push(
        `"${candidate.opportunity.title}" was removed as a duplicate of a higher-ranked opportunity in the same area.`,
      );
      continue;
    }
    seen.add(candidate.key);
    deduped.push(candidate);
  }

  const capped = deduped.slice(0, MAX_OPPORTUNITIES);
  if (deduped.length > MAX_OPPORTUNITIES) {
    notes.push(
      `The model returned ${deduped.length} opportunities; the lowest-ranked ${deduped.length - MAX_OPPORTUNITIES} were dropped to keep the set focused.`,
    );
  }

  // Ranks are reassigned rather than trusted: after discarding and
  // deduplication the model's numbering is stale by construction, and the UI
  // must never have to infer priority from array position (§12).
  const opportunities: BusinessOpportunity[] = capped.map((candidate, index) => ({
    ...candidate.opportunity,
    rank: index + 1,
    id: `${index + 1}-${candidate.opportunity.category}-${slug(candidate.opportunity.title)}`,
  }));

  return { ok: true, result: { opportunities, notes } };
}
