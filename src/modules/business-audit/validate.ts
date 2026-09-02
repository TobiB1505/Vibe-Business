import { checkCustomerLanguage } from "./customer-language";
import {
  findEvidenceEnumeration,
  findOrderingOverrides,
  findPriorityInversions,
  findUnconfirmedAssertions,
} from "./lens-priority";
import {
  AUDIT_SYNTHESIS_VERSION,
  BUSINESS_LENSES,
  LENS_HEALTH,
  LENS_MATERIALITY,
  CONCLUSION_TONES,
  type AuditSynthesis,
  type BusinessConclusion,
  type BusinessLens,
  type BusinessLensAssessment,
  type LensHealth,
  type LensMateriality,
  type ConclusionTone,
  type Confidence,
  type KeyFinding,
} from "./schema";

/**
 * Validation and sanitization of model output (Sprint 4 §20).
 *
 * Structured outputs guarantee the *shape* of the response. They guarantee
 * nothing about its *truthfulness*, so this layer enforces the invariants
 * the product depends on:
 *
 *  1. **Evidence must exist.** Every cited id is checked against the pack.
 *     Unknown ids are dropped and recorded — a citation that cannot be
 *     resolved is worse than no citation, because the UI would render it as
 *     proof.
 *  2. **Unknown stays unknown.** A lens score with no surviving evidence, or
 *     one that contradicts its own health band, is forced to null. The model
 *     is asked to respect this; the application guarantees it.
 *  3. **Ranges hold.** Scores are integers in 0–100, and list lengths are
 *     capped, because the JSON Schema subset used by structured outputs
 *     cannot express either.
 */

export type ValidationFailure = "structured_output_schema_invalid";

/**
 * Why our post-validation rejected the model's JSON, as a bounded code.
 *
 * These name only schema field names — never model content — so they are
 * safe to persist and log. A bounded enum rather than a free-text sentence
 * because the value is stored: prose would eventually carry a fragment of
 * whatever the model returned.
 */
export type ValidationReason =
  | "response_not_object"
  /**
   * A customer-facing conclusion used our vocabulary instead of the founder's
   * (CORE-2a.2 §12).
   *
   * A *rejection*, not a repair. The alternatives were both worse: silently
   * rendering it is what this contract exists to stop, and a second model call
   * to rewrite the prose would be the summarizer pipeline §13 forbids — it
   * would also double the cost of every audit to fix a rare presentation
   * defect.
   *
   * The cost of a rejection is one wasted audit, borne by us: a failed audit
   * never consumes the free entitlement (CORE-2 §17). That is affordable only
   * because the real fix is at the *input* — the model is no longer shown the
   * vocabulary — so this should approach never firing. If it starts firing
   * regularly, the input boundary has a hole and that is the thing to fix.
   */
  | "customer_language_violation";

export type ValidatedAudit = {
  /** Null when the model returned nothing usable at this layer. */
  synthesis: AuditSynthesis | null;
  keyFindings: KeyFinding[];
  limitations: string[];
  /** Integrity observations worth surfacing, e.g. dropped evidence ids. */
  notes: string[];
};

export type ValidateResult =
  | { ok: true; audit: ValidatedAudit }
  | {
      ok: false;
      error: ValidationFailure;
      reason: ValidationReason;
      /** Which internal terms leaked, for `customer_language_violation` only. */
      terms?: string[];
    };

/**
 * The synthesis cardinality (CORE-2a.1 §6, §36, §37).
 *
 * Enforced here as a ceiling, never as a quota. The rubric asks the model to
 * return fewer when fewer are justified, and nothing below manufactures a
 * conclusion to reach a number — a padded blocker would be exactly the
 * invented judgment this layer exists to prevent.
 */
export const MAX_SYNTHESIZED_STRENGTHS = 4;
export const MAX_SYNTHESIZED_BLOCKERS = 3;

/**
 * How much evidence overlap makes two conclusions the same root problem
 * (§40).
 *
 * Deliberately not a semantic comparison. Two conclusions describing one
 * underlying problem cite substantially the same evidence, because that is what
 * "the same problem" means here — so set overlap answers it without a second
 * model call or an embedding index. A conclusion that genuinely stands alone
 * cites its own evidence and survives.
 */
const DUPLICATE_EVIDENCE_OVERLAP = 0.6;

const MAX_LIST_ITEMS = 4;
const MAX_KEY_FINDINGS = 5;
const MAX_LIMITATIONS = 5;
const MAX_TEXT_LENGTH = 600;

const CONFIDENCES: Confidence[] = ["high", "medium", "low"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}…` : collapsed;
}

function cleanStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const entry of value) {
    const text = cleanText(entry, 240);
    if (text !== null) items.push(text);
    if (items.length >= maxItems) break;
  }
  return items;
}

/** Keeps only ids that genuinely exist in the pack; reports the rest. */
function filterEvidenceIds(
  value: unknown,
  known: Set<string>,
  dropped: Set<string>,
): string[] {
  if (!Array.isArray(value)) return [];
  const kept: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (id === "") continue;
    if (known.has(id)) {
      if (!kept.includes(id)) kept.push(id);
    } else {
      dropped.add(id.slice(0, 80));
    }
  }
  return kept;
}

const TONES: ConclusionTone[] = [...CONCLUSION_TONES];

function cleanLensList(value: unknown): BusinessLens[] {
  if (!Array.isArray(value)) return [];
  const kept: BusinessLens[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const id = entry.trim() as BusinessLens;
    if (BUSINESS_LENSES.includes(id) && !kept.includes(id)) kept.push(id);
  }
  return kept;
}

/**
 * The lens assessments (CORE-2a.3 §38).
 *
 * Kept whole rather than filtered down: this is the audit's reasoning, and a
 * lens the model marked `not_material` or `blocked_by_missing_context` is a
 * *result*, not a gap to drop. Keeping the ones that did not become blockers is
 * also what makes the re-audit loop work (CORE-2a.3.1 §36): a real gap ranked
 * `later` today has to still be here when the problems ahead of it are solved.
 * An unknown lens name is discarded — the closed
 * vocabulary is the point — and a duplicate keeps the first, because reporting
 * one lens twice says nothing the first entry did not.
 *
 * Unlike a conclusion, a lens with no surviving evidence is **not** discarded.
 * "Vibe could not assess this and here is what it would need" is a legitimate,
 * useful outcome that by definition cites nothing.
 */
function validateLenses(value: unknown, known: Set<string>, dropped: Set<string>): BusinessLensAssessment[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<BusinessLens>();
  const assessments: BusinessLensAssessment[] = [];

  for (const raw of value) {
    if (!isRecord(raw)) continue;

    const lens = typeof raw.lens === "string" ? (raw.lens.trim() as BusinessLens) : null;
    if (lens === null || !BUSINESS_LENSES.includes(lens) || seen.has(lens)) continue;
    seen.add(lens);

    const health = LENS_HEALTH.includes(raw.health as LensHealth)
      ? (raw.health as LensHealth)
      : "unclear";
    const evidenceIds = filterEvidenceIds(raw.evidenceIds, known, dropped);
    const numericScore =
      typeof raw.score === "number" && Number.isFinite(raw.score)
        ? Math.max(0, Math.min(100, Math.round(raw.score)))
        : null;
    const scoreMatchesHealth =
      numericScore !== null &&
      ((health === "strong" && numericScore >= 70) ||
        (health === "adequate" && numericScore >= 50 && numericScore <= 69) ||
        (health === "weak" && numericScore <= 49));

    assessments.push({
      lens,
      health,
      // A contradictory number is less trustworthy than an explicit absence.
      // Old audits omit the field and therefore land here as null as well.
      score: evidenceIds.length > 0 && scoreMatchesHealth ? numericScore : null,
      // `unknown`, not a middle value. A materiality we could not read is a
      // materiality we do not know, and defaulting it to something plausible
      // would let an unparsed lens silently compete for a top-three slot.
      materiality: LENS_MATERIALITY.includes(raw.materiality as LensMateriality)
        ? (raw.materiality as LensMateriality)
        : "unknown",
      summary: cleanText(raw.summary, 400) ?? "No reasoning was recorded for this lens.",
      evidenceIds,
      missingContext: cleanStringList(raw.missingContext, MAX_LIST_ITEMS),
    });
  }

  return assessments;
}

/** Proportion of the smaller evidence set that the two conclusions share. */
function evidenceOverlap(a: string[], b: string[]): number {
  const smaller = Math.min(a.length, b.length);
  if (smaller === 0) return 0;
  const other = new Set(b);
  const shared = a.filter((id) => other.has(id)).length;
  return shared / smaller;
}

function parseConclusion(
  raw: unknown,
  known: Set<string>,
  dropped: Set<string>,
): BusinessConclusion | null {
  if (!isRecord(raw)) return null;

  const headline = cleanText(raw.headline, 200);
  const explanation = cleanText(raw.explanation, 400);
  if (headline === null || explanation === null) return null;

  // Grounding (§10, §39). A business judgment with nothing behind it is exactly
  // the hallucination this layer exists to catch, so it is dropped rather than
  // shown — the UI would otherwise render it as a conclusion Vibe stands behind.
  const evidenceIds = filterEvidenceIds(raw.evidenceIds, known, dropped);
  if (evidenceIds.length === 0) return null;

  return {
    // Internal and never rendered, so an absent one degrades to empty rather
    // than discarding an otherwise grounded conclusion. Audits written before
    // this contract have none at all.
    rootProblem: cleanText(raw.rootProblem, 400) ?? "",
    headline,
    explanation,
    whyItMatters: cleanText(raw.whyItMatters, 400),
    evidenceIds,
    lenses: cleanLensList(raw.lenses),
    tone: TONES.includes(raw.tone as ConclusionTone) ? (raw.tone as ConclusionTone) : "attention",
    confidence: CONFIDENCES.includes(raw.confidence as Confidence)
      ? (raw.confidence as Confidence)
      : "low",
  };
}

/**
 * Drops conclusions that restate a problem already reported.
 *
 * Order is authority: the model returns its most important conclusion first, so
 * the first of a duplicate pair is kept. Only same-tone pairs are compared — a
 * strength and a blocker citing the same evidence are usually two honest
 * readings of one fact ("accounts exist" / "nothing brings people back to
 * them"), not a duplicate.
 */
function withoutDuplicateRootProblems(
  conclusions: BusinessConclusion[],
  notes: string[],
): BusinessConclusion[] {
  const kept: BusinessConclusion[] = [];
  let duplicates = 0;

  for (const candidate of conclusions) {
    const duplicate = kept.some(
      (existing) =>
        existing.tone === candidate.tone &&
        evidenceOverlap(existing.evidenceIds, candidate.evidenceIds) >= DUPLICATE_EVIDENCE_OVERLAP,
    );
    if (duplicate) {
      duplicates += 1;
      continue;
    }
    kept.push(candidate);
  }

  if (duplicates > 0) {
    notes.push(
      `${duplicates} conclusion(s) restated a problem already reported and were merged into it.`,
    );
  }
  return kept;
}

/**
 * The synthesis layer (CORE-2a.1).
 *
 * Returns null rather than an empty shell when the model produced nothing
 * usable here: a synthesis with no conclusions is not a synthesis, and the
 * renderer needs to tell "this audit predates the contract" from "this audit
 * tried and failed" — both fall back to the dimension view, but only the second
 * is a defect worth seeing in the notes.
 */
function validateSynthesis(
  data: Record<string, unknown>,
  known: Set<string>,
  dropped: Set<string>,
  notes: string[],
): AuditSynthesis | null {
  const overall = cleanText(data.overallConclusion, 400);
  if (!Array.isArray(data.conclusions)) return null;

  const parsed: BusinessConclusion[] = [];
  let ungrounded = 0;
  for (const entry of data.conclusions) {
    const conclusion = parseConclusion(entry, known, dropped);
    if (conclusion === null) {
      ungrounded += 1;
      continue;
    }
    parsed.push(conclusion);
  }

  if (ungrounded > 0) {
    notes.push(
      `${ungrounded} business conclusion(s) cited no evidence that exists and were discarded.`,
    );
  }

  const deduped = withoutDuplicateRootProblems(parsed, notes);

  // The ceiling is applied after de-duplication, so a duplicate never displaces
  // a distinct conclusion that would otherwise have been shown.
  const strengths = deduped
    .filter((entry) => entry.tone === "positive")
    .slice(0, MAX_SYNTHESIZED_STRENGTHS);
  const blockers = deduped
    .filter((entry) => entry.tone !== "positive")
    .slice(0, MAX_SYNTHESIZED_BLOCKERS);

  const lenses = validateLenses(data.lenses, known, dropped);
  if (overall === null && strengths.length === 0 && blockers.length === 0 && lenses.length === 0) {
    return null;
  }

  return {
    version: AUDIT_SYNTHESIS_VERSION,
    lenses,
    overall: overall ?? "",
    strengths,
    blockers,
  };
}

export function validateAuditOutput(data: unknown, knownEvidenceIds: Set<string>): ValidateResult {
  if (!isRecord(data)) {
    return { ok: false, error: "structured_output_schema_invalid", reason: "response_not_object" };
  }
  const dropped = new Set<string>();
  const notes: string[] = [];

  // A v8 audit is its synthesis: the nine lenses, the overall conclusion and
  // the ranked problems. There is no dimension layer to walk — the invariants
  // that used to guard it (unknown stays unscored; a claim with no surviving
  // evidence is not a claim) live on in `validateLenses`, which nulls a lens
  // score that lacks cited evidence or contradicts its own health band.
  const synthesis = validateSynthesis(data, knownEvidenceIds, dropped, notes);

  // The customer-language boundary, applied ONLY to the synthesis (§11, §16).
  // Dimension summaries, strengths, gaps, limitations and evidence labels are
  // the technical record and are supposed to say "canonical URL".
  if (synthesis !== null) {
    const language = checkCustomerLanguage(synthesis);

    if (!language.ok) {
      return {
        ok: false,
        error: "structured_output_schema_invalid",
        reason: "customer_language_violation",
        // Our own closed vocabulary, so it is safe to persist and log —
        // unlike the model prose that contained it.
        terms: language.blocking,
      };
    }

    // Corporate but comprehensible. Recorded rather than thrown away: three
    // real refreshes were discarded over exactly these words while the
    // reasoning underneath them was good. The note is what stops that being
    // silent — if it appears constantly, the rubric is not teaching well
    // enough.
    if (language.discouraged.length > 0) {
      notes.push(
        `Wording to improve: ${language.discouraged.join(", ")}. The audit says this in Vibe's words rather than the founder's.`,
      );
    }

    // Whether the top three agree with the audit's own lens assessments
    // (CORE-2a.3.1 §62), and whether a conclusion states a problem or lists
    // findings (§21). Both are notes for the same reason as the wording above:
    // they are strong signals about quality, not proof of a defect, and an
    // audit that reasons well is worth keeping even when it ranks imperfectly.
    notes.push(
      ...findPriorityInversions(synthesis),
      ...findOrderingOverrides(synthesis),
      ...findUnconfirmedAssertions(synthesis),
      ...findEvidenceEnumeration(synthesis),
    );
  }

  const keyFindings: KeyFinding[] = [];
  if (Array.isArray(data.keyFindings)) {
    for (const entry of data.keyFindings) {
      if (!isRecord(entry)) continue;
      const finding = cleanText(entry.finding, 400);
      if (finding === null) continue;
      const evidenceIds = filterEvidenceIds(entry.evidenceIds, knownEvidenceIds, dropped);
      // A cross-cutting finding with nothing left to stand on is dropped
      // rather than shown as an unsupported assertion.
      if (evidenceIds.length === 0) continue;
      keyFindings.push({ finding, evidenceIds });
      if (keyFindings.length >= MAX_KEY_FINDINGS) break;
    }
  }

  if (dropped.size > 0) {
    notes.push(
      `${dropped.size} cited evidence reference(s) did not exist in the evidence pack and were discarded.`,
    );
  }

  return {
    ok: true,
    audit: {
      synthesis,
      keyFindings,
      limitations: cleanStringList(data.limitations, MAX_LIMITATIONS),
      notes,
    },
  };
}
