import {
  DIMENSION_QUESTIONS,
  DIMENSION_TOPICS,
  type AuditDimensionId,
  type BusinessReadinessAudit,
  type DimensionAssessment,
} from "./schema";

/**
 * The human-first reading of an audit (CORE-2 §14).
 *
 * ## What this changes, and why it is a view and not a new engine
 *
 * The audit's stored payload is unchanged. What changed is the order it is
 * read in. Before CORE-2 the screen opened with a number out of 100 and five
 * category meters; a founder who built something with an AI tool and is now
 * trying to build a business does not need a score first, they need to know
 * what is wrong and what to do.
 *
 * So this module answers four questions in order — what's working, what's
 * holding you back, why it matters, where to start — and the score becomes
 * something you can still see rather than the first thing you meet. There is
 * no second audit engine here and no second set of conclusions: every sentence
 * below is already in the stored audit, re-ordered.
 *
 * ## The rule that shapes all of it
 *
 * **Missing evidence is never a weakness.** CLAUDE.md rule 44 and CORE-2 §11.
 * An unassessed dimension contributes nothing to "what's holding you back" —
 * not a low score, not a gap, not a bullet. It contributes to *"what Vibe
 * couldn't see"*, which is a different section with a different meaning, and
 * the difference is enforced here rather than requested of a model.
 *
 * ## Where I'd start
 *
 * Deliberately **not** computed here. CORE-2 §18 requires next moves to come
 * from the existing Opportunity Engine, so this module reports whether moves
 * exist and lets the caller link to them. An audit that invented its own
 * recommendations would be the second recommendation engine §18 forbids.
 */

/** A dimension the evidence could actually support a judgement on. */
function isAssessed(dimension: DimensionAssessment): boolean {
  return dimension.score !== null && dimension.assessmentStatus !== "insufficient_evidence";
}

/**
 * A parenthetical made entirely of evidence ids, which the model sometimes
 * appends to its own prose.
 *
 * The first dogfood surfaced this on the real audit:
 *
 *   "Authenticated area reached with Dashboard, Integrations, and Project
 *    workspace surfaces present (auth.area.reached, auth.surface.dashboard,
 *    auth.surface.integrations, auth.surface.project_workspace)"
 *
 * Every id in it is real and already resolved, in the founder's own language,
 * by the "Why?" disclosure directly underneath. Printing them inline as well
 * puts machine identifiers in the first sentence a person reads, which is the
 * opposite of "answer first, evidence second, tech last".
 *
 * Matched conservatively: only a trailing parenthetical whose entire contents
 * are dotted identifiers. A parenthetical containing a real sentence is left
 * alone, because it is the model saying something rather than citing.
 */
const TRAILING_EVIDENCE_CITATION = /\s*\((?:[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)(?:\s*,\s*(?:[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+))*\)\s*$/i;

/** Strips a trailing id-only citation, leaving the sentence intact. */
export function withoutInlineEvidenceIds(text: string): string {
  return text.replace(TRAILING_EVIDENCE_CITATION, "").trimEnd();
}

export type AuditHighlight = {
  /** The dimension this came from, so the UI can group or link. */
  dimension: AuditDimensionId;
  /** The question that dimension answers, in the founder's language. */
  question: string;
  text: string;
  evidenceIds: string[];
};

/**
 * What is already working.
 *
 * Strongest first, because this section exists to be read quickly and then
 * left. Only assessed dimensions contribute: a strength Vibe could not
 * establish is not a strength.
 */
export function strengthsFrom(audit: BusinessReadinessAudit): AuditHighlight[] {
  return audit.dimensions
    .filter(isAssessed)
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .flatMap((dimension) =>
      dimension.strengths.map((text) => ({
        dimension: dimension.id,
        question: DIMENSION_QUESTIONS[dimension.id] ?? dimension.label,
        text: withoutInlineEvidenceIds(text),
        evidenceIds: dimension.evidenceIds,
      })),
    );
}

/**
 * What is holding the business back.
 *
 * Weakest assessed dimension first — that ordering *is* the prioritization
 * this section offers, and it is deterministic rather than asked of a model.
 *
 * An unassessed dimension is absent entirely. That is the rule this function
 * exists to hold: "Vibe could not tell whether people come back" must never
 * appear in a list titled *what's holding you back*, because a founder would
 * reasonably read it as a finding about their product rather than about the
 * evidence.
 */
export function blockersFrom(audit: BusinessReadinessAudit): AuditHighlight[] {
  return audit.dimensions
    .filter(isAssessed)
    .slice()
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .flatMap((dimension) =>
      dimension.gaps.map((text) => ({
        dimension: dimension.id,
        question: DIMENSION_QUESTIONS[dimension.id] ?? dimension.label,
        text: withoutInlineEvidenceIds(text),
        evidenceIds: dimension.evidenceIds,
      })),
    );
}

/**
 * What Vibe could not see.
 *
 * Its own section, phrased as a limit on the analysis rather than on the
 * product. Combines the dimensions that could not be assessed with the
 * audit's own stated limitations.
 */
export type AuditBlindSpots = {
  /** Questions the evidence could not answer, in the founder's language. */
  unansweredQuestions: string[];
  /** The audit's own limitation notes. */
  limitations: string[];
};

export function blindSpotsFrom(audit: BusinessReadinessAudit): AuditBlindSpots {
  const unansweredQuestions = audit.dimensions
    .filter((dimension) => !isAssessed(dimension))
    .map((dimension) => DIMENSION_QUESTIONS[dimension.id] ?? dimension.label);

  return { unansweredQuestions, limitations: audit.limitations };
}

/**
 * The headline conclusion.
 *
 * Composed from what the audit already established rather than generated:
 * the strongest and weakest assessed dimensions, phrased as one sentence.
 * When coverage is too thin to say anything, it says that instead of
 * manufacturing a verdict.
 */
export function conclusionFor(audit: BusinessReadinessAudit): string {
  const assessed = audit.dimensions.filter(isAssessed);

  if (assessed.length === 0) {
    return "There isn't enough evidence yet for Vibe to judge how ready this is as a business.";
  }

  const ordered = assessed.slice().sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  const weakest = ordered[0]!;
  const strongest = ordered[ordered.length - 1]!;

  // Topics, not questions. A question reads correctly as a standalone label and
  // becomes nonsense inside a sentence — see `DIMENSION_TOPICS`.
  const weakestTopic = DIMENSION_TOPICS[weakest.id] ?? weakest.label;

  if (assessed.length === 1 || weakest.id === strongest.id) {
    return `The clearest thing Vibe can say right now is that ${weakestTopic} is where this is weakest.`;
  }

  const strongestTopic = DIMENSION_TOPICS[strongest.id] ?? strongest.label;
  return `You're strongest at ${strongestTopic}. Where this is weakest is ${weakestTopic}.`;
}

/**
 * The complete human-first reading.
 *
 * `score` and `coverage` are carried through so the UI can keep them visible —
 * CORE-2 §14 says the score stays *secondary*, not that it disappears. Hiding a
 * number the product computed would be its own kind of dishonesty.
 */
export type HumanAuditView = {
  conclusion: string;
  working: AuditHighlight[];
  blockers: AuditHighlight[];
  whyItMatters: BusinessReadinessAudit["keyFindings"];
  blindSpots: AuditBlindSpots;
  score: number | null;
  assessedDimensions: number;
  totalDimensions: number;
  insufficientCoverageReason: string | null;
};

export function buildHumanAuditView(audit: BusinessReadinessAudit): HumanAuditView {
  return {
    conclusion: conclusionFor(audit),
    working: strengthsFrom(audit),
    blockers: blockersFrom(audit),
    whyItMatters: audit.keyFindings.map((finding) => ({
      ...finding,
      finding: withoutInlineEvidenceIds(finding.finding),
    })),
    blindSpots: blindSpotsFrom(audit),
    score: audit.overall.score,
    assessedDimensions: audit.overall.assessedDimensions,
    totalDimensions: audit.overall.totalDimensions,
    insufficientCoverageReason: audit.overall.insufficientCoverageReason,
  };
}
