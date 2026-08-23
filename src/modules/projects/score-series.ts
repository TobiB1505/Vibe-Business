import type { AuditReading } from "./dashboard";

/**
 * The Business Signal over time (CORE-6).
 *
 * ## The trap this module exists to close
 *
 * Vibe Business went 39, 43, 45 across three audits in two days, and the
 * product did not improve by six points. The *rubric* changed twice. A chart
 * that joined those three readings with one rising line would be the system
 * congratulating the user on its own upgrade — which is the failure
 * `auditScoresComparable` was written to name before any chart existed.
 *
 * So the series is not a list of numbers. It is a list of **segments**, and a
 * segment ends wherever the audit stopped being the same audit.
 *
 * ## What decides that, and why it is not `auditScoresComparable`
 *
 * That helper compares one `contractVersion`, which lives inside the audit's
 * JSONB document — a document the dashboard read model deliberately never
 * opens. `business_readiness_audits` already carries the finer answer as seven
 * `not null` columns, under its own comment in the schema:
 *
 * > Reproducibility set (Sprint 4 §18). An audit is only comparable to another
 * > if every one of these matches.
 *
 * That is the stricter rule and it breaks the line in the same places: a new
 * audit row only exists when `input_hash` changes, and `computeAuditInputHash`
 * is built from those very versions plus the snapshot ids. Two audits that
 * differ by a prompt bump were always going to be two audits; two that differ
 * only by fresh evidence share all seven and stay connected.
 *
 * Holding two comparability rules at once would mean two answers to one
 * question, so this module owns it and `auditScoresComparable` stays uncalled.
 *
 * ## Three properties, each of them a test
 *
 * 1. **A version change breaks the line** rather than joining across it.
 * 2. **A null score is a gap**, never a dip to zero — "we looked and could not
 *    say" is not a reading of zero (rule 44).
 * 3. **A delta needs two comparable readings.** No pair, no number.
 */

/** The seven columns that decide whether two audits may be compared. */
export type AuditContract = {
  schemaVersion: string;
  auditVersion: string;
  evidencePackVersion: string;
  promptVersion: string;
  rubricVersion: string;
  provider: string;
  model: string;
};

export type ScorePoint = {
  /** Null means coverage was too thin to score. It is a gap, not a zero. */
  score: number | null;
  recordedAt: string;
};

/** A run of readings produced under one unchanged audit contract. */
export type ScoreSegment = {
  /** Oldest first. */
  points: ScorePoint[];
};

export type ScoreSeries = {
  /** Oldest segment first; within a segment, oldest point first. */
  segments: ScoreSegment[];
  /** The newest score, or null when the newest audit could not be scored. */
  latest: number | null;
  /**
   * The newest score minus the one before it — only when both are scored and
   * were produced under the same contract. Null otherwise, and null is the
   * honest answer far more often than a chart would like.
   */
  delta: number | null;
  /** How many readings there are in total, across every segment. */
  readingCount: number;
  /**
   * How many times the contract changed inside this series. Zero means one
   * unbroken line; anything higher is what a break marker is drawn for.
   */
  breakCount: number;
};

/**
 * Every field of the reproducibility set, in one comparable value.
 *
 * `JSON.stringify` over a fixed tuple rather than a delimiter join: a
 * separator can be forged by field contents, and a version string is free
 * text. Two readings are comparable exactly when this matches.
 */
function contractKey(contract: AuditContract): string {
  return JSON.stringify([
    contract.schemaVersion,
    contract.auditVersion,
    contract.evidencePackVersion,
    contract.promptVersion,
    contract.rubricVersion,
    contract.provider,
    contract.model,
  ]);
}

const EMPTY: ScoreSeries = {
  segments: [],
  latest: null,
  delta: null,
  readingCount: 0,
  breakCount: 0,
};

/**
 * Turn one product's audit readings into a drawable series.
 *
 * The input may arrive in any order — the dashboard reads audits newest-first
 * across every project — so this sorts chronologically itself rather than
 * trusting a caller to remember. Two readings with the same timestamp keep
 * their relative input order, which `Array.prototype.sort` guarantees.
 */
export function buildScoreSeries(readings: AuditReading[]): ScoreSeries {
  if (readings.length === 0) return EMPTY;

  const chronological = readings
    .slice()
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));

  const segments: ScoreSegment[] = [];
  let previousKey: string | null = null;

  for (const reading of chronological) {
    const key = contractKey(reading.contract);
    if (key !== previousKey) {
      segments.push({ points: [] });
      previousKey = key;
    }
    segments[segments.length - 1].points.push({
      score: reading.score,
      recordedAt: reading.recordedAt,
    });
  }

  const newestSegment = segments[segments.length - 1];
  const newest = newestSegment.points[newestSegment.points.length - 1];

  return {
    segments,
    latest: newest.score,
    delta: deltaWithin(newestSegment),
    readingCount: chronological.length,
    breakCount: segments.length - 1,
  };
}

/**
 * The change against the previous comparable reading.
 *
 * Both ends must be scored, and both must be inside the same segment — a
 * number spanning a contract change is the one thing this module refuses to
 * produce. An unscored newest reading yields null rather than reaching further
 * back for a pair that would compare a reading against something that is not
 * its predecessor.
 */
function deltaWithin(segment: ScoreSegment): number | null {
  const points = segment.points;
  const newest = points[points.length - 1];
  const previous = points[points.length - 2];

  if (!previous) return null;
  if (newest.score === null || previous.score === null) return null;
  return newest.score - previous.score;
}
