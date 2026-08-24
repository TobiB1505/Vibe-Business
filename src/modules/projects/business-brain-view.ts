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
  summary: string | null;
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
  };
  nodes: BusinessBrainNode[];
  relationships: BusinessBrainRelationship[];
  primaryPriority: BusinessBrainPriority | null;
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

  const nodes = map.nodes.map((node): BusinessBrainNode => ({
    id: node.lens,
    label: node.label,
    score: node.score ?? null,
    health: node.health,
    healthLabel: HEALTH_LABELS[node.health],
    priority: node.materiality,
    priorityLabel: MATERIALITY_LABELS[node.materiality],
    ring: node.ring,
    angle: node.angle,
    summary: node.summary || null,
    blockerRank: node.blockerRank,
    connectedNodeIds: node.relatedLenses,
    missingContext: node.missingContext,
    evidence: evidence(node.evidenceIds),
    sourceCount: evidenceSources(node.evidenceIds).length,
    problem: blockerByLens.get(node.lens) ?? null,
  }));

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
    },
    nodes,
    relationships: map.connections.map((relationship) => ({
      id: `${relationship.from}:${relationship.to}`,
      ...relationship,
    })),
    primaryPriority:
      firstBlocker && problems[0]
        ? { ...problems[0], lensIds: firstBlocker.lenses }
        : null,
    additionalPriorityCount: Math.max(0, problems.length - 1),
    recentChanges: history.changes,
    recentChangesUnavailableReason: history.unavailable,
    sourceCount: evidenceSources([...allEvidenceIds]).length,
    signalCount: map.signalCount,
    lastScanAt: params.lastScanAt,
    usedSignedInEvidence: params.usedSignedInEvidence ?? false,
  };
}
