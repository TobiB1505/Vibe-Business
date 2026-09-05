import { scoreDisplay, type ScoreTone } from "@/components/ui/score-display";
import { conclusionKey } from "@/modules/business-audit/conclusions";
import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import {
  HEALTH_LABELS,
  MATERIALITY_LABELS,
  buildBusinessMap,
  evidenceSources,
  type MapRing,
} from "@/modules/business-audit/map-view";
import type {
  BusinessConclusion,
  BusinessLens,
  ConclusionTone,
  LensHealth,
  LensMateriality,
  BusinessReadinessAudit,
} from "@/modules/business-audit/schema";
import { buildScoreSeries, type AuditReading } from "./score-series";

export type BusinessBrainEvidence = {
  id: string;
  detail: string;
  source: string;
};

export type BusinessBrainProblem = {
  key: string;
  rank: number;
  headline: string;
  explanation: string;
  whyItMatters: string | null;
  tone: ConclusionTone;
  evidence: BusinessBrainEvidence[];
  moveCount: number;
  move: BusinessBrainMove | null;
};

export type BusinessBrainMove = {
  title: string;
  impact: "high" | "medium" | "low";
  effort: "high" | "medium" | "low";
};

export type BusinessBrainNode = {
  id: BusinessLens;
  label: string;
  /** Null for legacy, unclear, founder-blocked or unsupported assessments. */
  score: number | null;
  health: LensHealth;
  healthLabel: string;
  priority: LensMateriality;
  priorityLabel: string;
  ring: MapRing;
  angle: number;
  /*
   * No `summary` here on purpose.
   *
   * `BusinessLensAssessment.summary` is internal prose — its own schema says
   * it is not shown to the founder — and the Brain's detail column used it as
   * the fallback when a lens had no diagnosis. The honest fallback is a
   * sentence that says the evidence did not support one, so the field stops at
   * this boundary rather than being carried across and then not rendered.
   */
  blockerRank: number | null;
  connectedNodeIds: BusinessLens[];
  missingContext: string[];
  evidence: BusinessBrainEvidence[];
  sourceCount: number;
  problem: BusinessBrainProblem | null;
};

export type BusinessBrainRelationship = {
  id: string;
  from: BusinessLens;
  to: BusinessLens;
  /** The audit's own headline for why these areas were judged together. */
  reason: string;
};

export type BusinessBrainPriority = BusinessBrainProblem & {
  lensIds: BusinessLens[];
};

export type BusinessBrainChange = {
  id: string;
  direction: "up" | "down" | "same";
  delta: number;
  score: number;
  recordedAt: string;
};

export type BusinessBrainView = {
  overall: {
    score: number | null;
    state: ScoreTone;
    stateLabel: string;
    summary: string | null;
    scoredLenses: number;
    eligibleLenses: number;
    /**
     * Why nothing could be scored, when nothing could.
     *
     * The audit computes this and the Brain rendered an em dash over it: a
     * score the product declined to give, with the reason it can give left
     * unread. Null whenever a score exists.
     */
    insufficientCoverageReason: string | null;
  };
  nodes: BusinessBrainNode[];
  relationships: BusinessBrainRelationship[];
  primaryPriority: BusinessBrainPriority | null;
  /**
   * Every blocker the audit ranked, `primaryPriority` first.
   *
   * The view carried the first one and a count of the rest, which is enough to
   * write "and 3 more" and not enough to show them. R11 is the ranked stack,
   * and a count cannot be rendered into one — so the list crosses the boundary
   * and `additionalPriorityCount` stays as the cheap read for callers that
   * only need the number.
   */
  priorities: BusinessBrainPriority[];
  additionalPriorityCount: number;
  recentChanges: BusinessBrainChange[];
  recentChangesUnavailableReason: "no_history" | "not_comparable" | "unscored" | null;
  sourceCount: number;
  signalCount: number;
  lastScanAt: string | null;
  usedSignedInEvidence: boolean;
};

const SCORE_STATE_LABELS: Record<ScoreTone, string> = {
  strong: "Strong foundation",
  partial: "Taking shape",
  weak: "Needs attention",
  unscored: "Not enough evidence",
};

function evidence(ids: readonly string[]): BusinessBrainEvidence[] {
  return ids.map((id) => {
    const description = describeEvidenceId(id);
    return { id, detail: description.detail, source: description.source };
  });
}

function problem(
  blocker: BusinessConclusion,
  index: number,
  movesByConclusion: Record<string, number>,
  moveByConclusion: Record<string, BusinessBrainMove>,
): BusinessBrainProblem {
  const key = conclusionKey("blocker", index);
  return {
    key,
    rank: index + 1,
    headline: blocker.headline,
    explanation: blocker.explanation,
    whyItMatters: blocker.whyItMatters,
    tone: blocker.tone,
    evidence: evidence(blocker.evidenceIds),
    moveCount: movesByConclusion[key] ?? 0,
    move: moveByConclusion[key] ?? null,
  };
}

function recentChange(readings: AuditReading[]): {
  changes: BusinessBrainChange[];
  unavailable: BusinessBrainView["recentChangesUnavailableReason"];
} {
  const series = buildScoreSeries(readings);
  if (series.readingCount < 2) return { changes: [], unavailable: "no_history" };
  if (series.delta === null) {
    const newestSegment = series.segments.at(-1);
    const newest = newestSegment?.points.at(-1);
    const previous = newestSegment?.points.at(-2);
    return {
      changes: [],
      unavailable:
        newest?.score === null || previous?.score === null ? "unscored" : "not_comparable",
    };
  }

  const newest = series.segments.at(-1)?.points.at(-1);
  if (!newest || newest.score === null) return { changes: [], unavailable: "unscored" };

  return {
    changes: [
      {
        id: `overall-${newest.recordedAt}`,
        direction: series.delta > 0 ? "up" : series.delta < 0 ? "down" : "same",
        delta: series.delta,
        score: newest.score,
        recordedAt: newest.recordedAt,
      },
    ],
    unavailable: null,
  };
}

/**
 * The stable boundary between the audit domain and the expressive UI.
 *
 * Every relationship, priority, count and sentence originates in persisted
 * audit data. A missing lens score stays null; the renderer is not allowed to
 * promote a visual reference into production evidence.
 */
export function buildBusinessBrainView(params: {
  audit: BusinessReadinessAudit;
  lastScanAt: string | null;
  auditReadings: AuditReading[];
  movesByConclusion: Record<string, number>;
  moveByConclusion?: Record<string, BusinessBrainMove>;
  usedSignedInEvidence?: boolean;
}): BusinessBrainView | null {
  const synthesis = params.audit.synthesis ?? null;
  if (!synthesis) return null;

  const map = buildBusinessMap(synthesis);
  const problems = synthesis.blockers.map((blocker, index) =>
    problem(blocker, index, params.movesByConclusion, params.moveByConclusion ?? {}),
  );
  const blockerByLens = new Map<BusinessLens, BusinessBrainProblem>();
  synthesis.blockers.forEach((blocker, index) => {
    for (const lens of blocker.lenses) {
      if (!blockerByLens.has(lens)) blockerByLens.set(lens, problems[index]);
    }
  });

  const nodes = map.nodes.map(
    (node): BusinessBrainNode => ({
      id: node.lens,
      label: node.label,
      score: node.score ?? null,
      health: node.health,
      healthLabel: HEALTH_LABELS[node.health],
      priority: node.materiality,
      priorityLabel: MATERIALITY_LABELS[node.materiality],
      ring: node.ring,
      angle: node.angle,
      blockerRank: node.blockerRank,
      connectedNodeIds: node.relatedLenses,
      missingContext: node.missingContext,
      evidence: evidence(node.evidenceIds),
      sourceCount: evidenceSources(node.evidenceIds).length,
      problem: blockerByLens.get(node.lens) ?? null,
    }),
  );

  const allEvidenceIds = new Set<string>();
  for (const node of map.nodes) for (const id of node.evidenceIds) allEvidenceIds.add(id);
  for (const conclusion of [...synthesis.blockers, ...synthesis.strengths]) {
    for (const id of conclusion.evidenceIds) allEvidenceIds.add(id);
  }
  const history = recentChange(params.auditReadings);
  const score = params.audit.overall.score;
  const state = scoreDisplay(score).tone;
  const firstBlocker = synthesis.blockers[0];

  return {
    overall: {
      score,
      state,
      stateLabel: SCORE_STATE_LABELS[state],
      summary: synthesis.overall || null,
      scoredLenses: params.audit.overall.scoredLenses,
      eligibleLenses: params.audit.overall.eligibleLenses,
      insufficientCoverageReason:
        score === null ? params.audit.overall.insufficientCoverageReason : null,
    },
    nodes,
    relationships: map.connections.map((relationship) => ({
      id: `${relationship.from}:${relationship.to}`,
      ...relationship,
    })),
    primaryPriority:
      firstBlocker && problems[0] ? { ...problems[0], lensIds: firstBlocker.lenses } : null,
    priorities: problems.map((entry, index) => ({
      ...entry,
      lensIds: synthesis.blockers[index]?.lenses ?? [],
    })),
    additionalPriorityCount: Math.max(0, problems.length - 1),
    recentChanges: history.changes,
    recentChangesUnavailableReason: history.unavailable,
    sourceCount: evidenceSources([...allEvidenceIds]).length,
    signalCount: map.signalCount,
    lastScanAt: params.lastScanAt,
    usedSignedInEvidence: params.usedSignedInEvidence ?? false,
  };
}

/** One thing the audit found working, as a founder reads it. */
export type BusinessStrength = {
  headline: string;
  /** Often absent on a strength, and never invented when it is. */
  whyItMatters: string | null;
};

/**
 * What is working, for a surface that wants to say so in two lines.
 *
 * A lookup rather than a judgement: the list arrives ordered by the model that
 * wrote it and already bounded at four, so choosing "the strongest" here would
 * be a second ranking of something already ranked — the same reasoning
 * `command-center.ts`'s `findingFrom` gives for taking `blockers[0]` rather
 * than scoring blockers again.
 *
 * A blank headline is skipped rather than rendered, because a strength with no
 * sentence is a card with an empty line where its point should be. The helper
 * exists so that a component never reaches into the audit document to do this
 * itself, which is how one surface ends up disagreeing with another about what
 * the audit said.
 */
export function strongestAreas(
  synthesis: { strengths: readonly { headline: string; whyItMatters: string | null }[] } | null,
  limit = 2,
): BusinessStrength[] {
  if (!synthesis) return [];

  return synthesis.strengths
    .filter((strength) => strength.headline.trim() !== "")
    .slice(0, limit)
    .map((strength) => ({ headline: strength.headline, whyItMatters: strength.whyItMatters }));
}
