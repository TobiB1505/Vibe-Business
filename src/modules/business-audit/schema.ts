/**
 * Versioned Business Readiness Audit schema (Sprint 4 §8).
 *
 * Diagnostic only. This layer answers "how business-ready is this product,
 * on the evidence available?" It does not produce Opportunities, actions,
 * or code changes — that boundary belongs to Sprint 5's Opportunity Engine,
 * and blurring it here would make both harder to evaluate (Sprint 4 §31).
 *
 * The dimensions are exactly the five in PRODUCT.md §10. They are not
 * extended casually.
 */

export const BUSINESS_AUDIT_SCHEMA_VERSION = "business-readiness-audit.v1" as const;

/** Bumped when the audit's structure or scoring rules change materially. */
export const BUSINESS_AUDIT_VERSION = "business-audit-v1" as const;

export const AUDIT_DIMENSIONS = [
  "product",
  "monetization",
  "distribution",
  "conversion",
  "retention",
] as const;

export type AuditDimensionId = (typeof AUDIT_DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<AuditDimensionId, string> = {
  product: "Product",
  monetization: "Monetization",
  distribution: "Distribution",
  conversion: "Conversion",
  retention: "Retention",
};

/**
 * The same five dimensions, phrased as the question each one answers
 * (Sprint UI-3.5).
 *
 * "Monetization: 28" is a category and a number. "Making money from it is
 * still unclear" is the same finding said to someone who has to decide what to
 * do about it — and this product's audience built something with an AI tool
 * and is now trying to build a business, not read an analyst report.
 *
 * The ids, the scoring and the stored payload are untouched: this is a label
 * table, and `DIMENSION_LABELS` above is still what technical views show.
 */
export const DIMENSION_QUESTIONS: Record<AuditDimensionId, string> = {
  product: "Do people understand what you built?",
  monetization: "Can you make money from it?",
  distribution: "Can people discover you?",
  conversion: "Do visitors become customers?",
  retention: "Do people come back?",
};

/**
 * The same five dimensions as **noun phrases**, for use inside a sentence.
 *
 * `DIMENSION_QUESTIONS` reads correctly as a standalone label above a meter and
 * is wrong everywhere else. The first dogfood put one inside a sentence and got:
 *
 *   "Where you're strongest: do people understand what you built? Where you're
 *    weakest: can you make money from it?"
 *
 * — a question mark mid-clause and a sentence that parses as nothing. The unit
 * test asserted that exact string, so the test enforced the defect rather than
 * catching it.
 *
 * Two label sets rather than one clever transformation: there is no rule that
 * turns "Do people come back?" into "keeping people coming back" reliably, and
 * a regex that tried would fail differently for each new dimension.
 */
export const DIMENSION_TOPICS: Record<AuditDimensionId, string> = {
  product: "explaining what you built",
  monetization: "making money from it",
  distribution: "helping people discover you",
  conversion: "turning visitors into customers",
  retention: "bringing people back",
};

/**
 * How much of a dimension the available evidence could actually support.
 *
 * `insufficient_evidence` is a legitimate, useful outcome — not a failure
 * and never a low score. See `scoring.ts` for why this distinction is
 * enforced in code rather than trusted to the model.
 */
export type AssessmentStatus = "assessable" | "partial" | "insufficient_evidence";

export type Confidence = "high" | "medium" | "low";

export type DimensionAssessment = {
  id: AuditDimensionId;
  label: string;
  assessmentStatus: AssessmentStatus;
  /** 0–100, or null when the evidence cannot support a score. */
  score: number | null;
  confidence: Confidence;
  summary: string;
  strengths: string[];
  gaps: string[];
  /** What could not be determined — stated, not silently omitted. */
  unknowns: string[];
  /** Evidence ids justifying this assessment. Validated against the pack. */
  evidenceIds: string[];
};

export type OverallReadiness = {
  /** Deterministically computed by the application, never by the model. */
  score: number | null;
  assessedDimensions: number;
  totalDimensions: number;
  /** Why `score` is null, when it is. */
  insufficientCoverageReason: string | null;
};

export type KeyFinding = {
  finding: string;
  evidenceIds: string[];
};

// ---------------------------------------------------------------------
// Business reasoning lenses (CORE-2a.3)
// ---------------------------------------------------------------------

/**
 * The nine lenses the audit reasons through before it concludes anything.
 *
 * ## Why these exist on top of the five dimensions
 *
 * The five dimensions are the *scored* layer and are unchanged — they are
 * PRODUCT.md §10's contract and every stored score means what it always meant.
 * What they are not is a complete way to think about a business, and the audit
 * had drifted toward answering the question its scanners could answer most
 * easily: *which business-related product features are missing?*
 *
 * That produced honest, useless conclusions. "No pricing page", "no checkout",
 * "no analytics" are three observations about surfaces. The question a founder
 * actually needs answered is *what does this product still need in order to
 * become a functioning business?* — and "we have not decided how value becomes
 * revenue" is a different problem from "the pricing page is missing", with a
 * different fix, even though the same scanner evidence sits underneath both.
 *
 * ## What they are not
 *
 * Not UI cards, not scores, not nine mandatory findings. They are an internal
 * reasoning pass whose output is a handful of synthesized conclusions. A single
 * blocker routinely spans several lenses — an unclear path from usage to
 * revenue is offer, revenue and scalability at once — and forcing it into one
 * would be the artificial taxonomy this framework exists to avoid.
 *
 * ## Why they are universal
 *
 * Nine lenses, one framework, every product type. There is deliberately no
 * `SaaSAudit` or `MarketplaceAudit`: a portfolio site and a marketplace both
 * have an offer, an audience and economics, and what differs is which lenses
 * *matter* — which is `materiality`, a property of the assessment rather than
 * of the framework.
 */
export const BUSINESS_LENSES = [
  /** Why should anyone want this? Value, promise, differentiation. */
  "offer",
  /** Who cares enough about this problem to act or pay? */
  "audience",
  /** How does the value created become sustainable revenue — including cost to serve? */
  "revenue_economics",
  /** How do the right people discover it? Every channel, not just search. */
  "acquisition",
  /** How does someone move from interest to value, and to paying? */
  "conversion",
  /** Why would anyone come back, keep using it, or keep paying? */
  "retention",
  /** Can the founder tell what users do and what is actually working? */
  "measurement",
  /** What still prevents this operating credibly as a real business? */
  "business_readiness",
  /** What happens to costs, margin and operations if this grows? */
  "scalability",
] as const;

export type BusinessLens = (typeof BUSINESS_LENSES)[number];

/**
 * How healthy this area of the business is — and **only** that.
 *
 * ## Why `weak` had to exist (CORE-2a.3.1 §29)
 *
 * The first version of this enum was `strong | adequate | unclear |
 * not_material | blocked_by_missing_context`. It had no way to say *"this is
 * genuinely poor"*. The real dogfood shows what that cost: business readiness
 * — no privacy policy, no terms, no contact route, nothing found across three
 * independent sources — came back as `unclear`, which is false. Nothing about
 * it was unclear.
 *
 * The model wanted to express severity and the only lever left was
 * `materiality: high`. That is how a compliance checklist displaced the
 * business problems underneath it: **severity leaked into priority because
 * health had no severity axis.** The fix is a vocabulary that lets a lens be
 * bad and unimportant at the same time.
 *
 * `not_material` is gone from here on purpose. "This does not matter for this
 * product" was never a statement about health — it is a priority judgment, and
 * it now lives in `LENS_MATERIALITY` where it belongs.
 */
export const LENS_HEALTH = [
  "strong",
  "adequate",
  /** Real, assessed, and poor. Says nothing about whether it matters yet. */
  "weak",
  /** The evidence genuinely does not settle it. Not a polite word for weak. */
  "unclear",
  "blocked_by_missing_context",
] as const;
export type LensHealth = (typeof LENS_HEALTH)[number];

/**
 * When this area needs attention — a judgment about *time*, not about quality.
 *
 * Deliberately temporal rather than `high | medium | low`. A severity scale
 * invites the reading "low means it is fine", which is exactly wrong: a lens is
 * routinely `weak` and `later` at the same time, and that pairing is the most
 * useful thing this audit can say to an early founder. "Not set up yet, and too
 * early to be one of your biggest problems" is intelligent advice (§31); "low"
 * is a shrug that could mean either.
 *
 * `not_material` sits here now: a one-off digital product has nothing to
 * retain, and that is a permanent property of the business model rather than a
 * stage it will grow out of — which is precisely what separates it from
 * `later`.
 */
export const LENS_MATERIALITY = [
  /** Blocks the next meaningful business milestone. */
  "now",
  /** Becomes material once the current milestone is reached. */
  "soon",
  /** Real, but a later stage's problem. Its prerequisites do not exist yet. */
  "later",
  /** Does not apply to this kind of business, and will not. */
  "not_material",
  /** Cannot be judged without something only the founder knows. */
  "unknown",
] as const;
export type LensMateriality = (typeof LENS_MATERIALITY)[number];

/**
 * Materiality values that mean "this is a candidate for the top three".
 *
 * Exported so ranking, question selection and tests share one definition of
 * "matters now" rather than each re-deriving it from string comparisons.
 */
export const ACTIONABLE_MATERIALITY: readonly LensMateriality[] = ["now", "soon"] as const;

/**
 * One lens, assessed.
 *
 * Internal. This never reaches the customer-facing screen — it is the audit's
 * working-out, and the reason it is structured rather than left in the model's
 * head is that "did the audit actually consider economics?" should be a
 * question a test can answer.
 */
export type BusinessLensAssessment = {
  lens: BusinessLens;
  /** How this area of the business actually looks. Never a priority claim. */
  health: LensHealth;
  /**
   * When it needs attention.
   *
   * Independent of `health` by design (§3, §5). A lens may be `weak` and
   * `later`, or `adequate` and `now` — the second is how a decent-but-vague
   * audience becomes the thing to fix before anything else works.
   */
  materiality: LensMateriality;
  /** Internal prose. May be technical; it is not shown to the founder. */
  summary: string;
  evidenceIds: string[];
  /**
   * What only the founder could tell us, when the lens is blocked on it.
   *
   * Feeds adaptive question selection: a question is worth asking exactly when
   * a material lens cannot be assessed without it (CORE-2a.3 §23).
   */
  missingContext: string[];
};

// ---------------------------------------------------------------------
// Business synthesis (CORE-2a.1)
// ---------------------------------------------------------------------

/**
 * The synthesis contract, versioned **separately** from the evidence pack
 * (CORE-2a.1 §20).
 *
 * The two answer different questions and moved for different reasons.
 * `business-evidence.v3` is about what the model was *told*; this is about what
 * it is asked to *conclude*. Evidence quality improving and judgment quality
 * improving are independent events, and an audit has to be able to say which
 * of them it carries.
 */
export const AUDIT_SYNTHESIS_VERSION = "business-audit-synthesis-v3" as const;

/**
 * The **audit contract** version (CORE-2a.2 §21–§23).
 *
 * One identifier for "what a stored audit means", distinct from every version
 * already tracked because none of them answers the question on its own:
 *
 * - `evidencePackVersion` says what the model was *told*. CORE-2a.1 changed the
 *   contract while leaving the pack at v3, so this is provably not it (§22).
 * - `promptVersion` and `rubricVersion` move for wording changes that do not
 *   change what a result means.
 * - `schemaVersion` describes the payload's shape, not its semantics.
 *
 * This is bumped only when a stored audit stops being an acceptable answer to
 * "what does Vibe currently think about this business?" — which is exactly the
 * question the refresh decision asks.
 */
export const AUDIT_CONTRACT_VERSION = "business-audit-contract-v4" as const;

/**
 * The oldest contract still treated as current.
 *
 * Separate from `AUDIT_CONTRACT_VERSION` so a bump does not automatically
 * obsolete every stored audit: a change that adds something without
 * invalidating older results can raise the current version and leave the
 * minimum alone. Today they are equal, and v4 is the second time that has been
 * the right call: a v3 audit ranked a lens's importance on a scale that no
 * longer exists, so its "these are your three biggest problems" is not an
 * answer this contract would give. The findings were fine; the ordering was
 * the product.
 */
export const MIN_SUPPORTED_AUDIT_CONTRACT_VERSION = "business-audit-contract-v4" as const;

/**
 * How a conclusion reads, not how severe it is.
 *
 * `positive` is what the product already has; `attention` and `critical` are
 * both things holding it back, separated only so the UI can weight them. The
 * split into strengths and blockers is derived from this rather than being a
 * second field the model could contradict.
 */
export const CONCLUSION_TONES = ["positive", "attention", "critical"] as const;
export type ConclusionTone = (typeof CONCLUSION_TONES)[number];

/**
 * One business-level conclusion drawn from several pieces of evidence.
 *
 * This is the layer CORE-2a.1 exists to add. The dimensions below it answer
 * *"how does this business area look?"*; a conclusion answers *"what do these
 * observations mean together?"* — which is the level a founder should read
 * first, and the level the previous audit never produced.
 *
 * The real dogfood is the argument. It emitted, as five separate gaps: no
 * monetization model stated, no pricing surface, no checkout surface, no
 * payment capability, no paying journey stage. Those are five observations of
 * **one** business problem — *people still don't have a clear path to paying
 * you* — and listing them five times is enumeration wearing the costume
 * of thoroughness.
 *
 * `dimensions` is a list on purpose (§12). A buying path that is unclear spans
 * monetization, conversion and the customer journey, and forcing it into one
 * scored dimension would be an artificial taxonomy boundary. Dimension scores
 * stay separate and unchanged.
 */
export type BusinessConclusion = {
  /** The sentence a founder reads. Plain language, no product jargon. */
  headline: string;
  /** One or two sentences on what Vibe actually found. */
  explanation: string;
  /**
   * Why this matters commercially. Usually present on a blocker and often
   * absent on a strength, which is why it is nullable rather than required
   * (§28) — a strength that needs a paragraph of justification is usually not
   * a strength.
   */
  whyItMatters: string | null;
  /** At least one, validated against the pack. Never empty (§10). */
  evidenceIds: string[];
  /** Which scored dimensions this conclusion touches. May be several (§12). */
  dimensions: AuditDimensionId[];
  /**
   * Which reasoning lenses this conclusion came from (CORE-2a.3 §40).
   *
   * Routinely more than one. "You have not turned usage into revenue" is
   * offer, revenue and scalability together, and recording that is what lets a
   * later reader see *why* it was judged a root problem rather than a symptom.
   */
  lenses: BusinessLens[];
  tone: ConclusionTone;
  confidence: Confidence;
};

/**
 * The concise judgment layer of an audit.
 *
 * Bounded by the contract rather than by the UI: these are few because the
 * model chose the ones that matter, not because React hides the rest
 * (DoD 8). Everything not chosen remains in the dimension assessments and in
 * the evidence pack, both untouched.
 */
export type AuditSynthesis = {
  version: typeof AUDIT_SYNTHESIS_VERSION;
  /**
   * The reasoning behind the conclusions (CORE-2a.3 §38).
   *
   * Kept with the synthesis rather than beside it, because the conclusions are
   * only defensible in terms of the lenses that produced them. Empty on audits
   * written before this framework existed.
   */
  lenses: BusinessLensAssessment[];
  /**
   * One sentence about the business as a whole, grounded in the assessment
   * below it — never generic encouragement (§25).
   */
  overall: string;
  /** 2–4 when the evidence supports them; fewer when it does not (§6). */
  strengths: BusinessConclusion[];
  /** At most 3 (§6, §36). Fewer is a valid and common answer. */
  blockers: BusinessConclusion[];
};

export type BusinessReadinessAudit = {
  schemaVersion: typeof BUSINESS_AUDIT_SCHEMA_VERSION;
  auditVersion: typeof BUSINESS_AUDIT_VERSION;
  /**
   * Which audit contract produced this (CORE-2a.2 §24).
   *
   * Absent on every audit written before CORE-2a.2, which is what makes them
   * correctly obsolete without a back-fill: an audit that cannot say which
   * contract it followed did not follow this one.
   */
  contractVersion?: string;
  evidencePackVersion: string;
  promptVersion: string;
  rubricVersion: string;
  provider: string;
  model: string;
  dimensions: DimensionAssessment[];
  overall: OverallReadiness;
  /**
   * The business-level judgment (CORE-2a.1).
   *
   * Null on every audit written before this contract existed. Those rows keep
   * their per-dimension findings and their `keyFindings`, and the renderer has
   * a legacy path for them (§21) — back-filling a synthesis by re-reading old
   * prose would be inventing a conclusion nobody's model actually drew.
   */
  synthesis: AuditSynthesis | null;
  /**
   * Historical. Superseded by `synthesis` for audits that carry one: a key
   * finding *was* a cross-cutting conclusion, just without the grounding,
   * cardinality or language rules the synthesis contract imposes. New audits
   * leave this empty rather than producing the same judgment twice.
   */
  keyFindings: KeyFinding[];
  /** What this audit could not assess, and why. */
  limitations: string[];
  /** Integrity notes from output validation, e.g. dropped evidence ids. */
  validationNotes: string[];
  generatedAt: string;
};
