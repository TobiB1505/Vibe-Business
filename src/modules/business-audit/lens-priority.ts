import {
  ACTIONABLE_MATERIALITY,
  type AuditSynthesis,
  type BusinessConclusion,
  type BusinessLens,
  type BusinessLensAssessment,
  type LensMateriality,
} from "./schema";

/**
 * Checking the audit's own prioritization (CORE-2a.3.1 §21, §45, §62).
 *
 * ## What this can and cannot do
 *
 * It cannot decide which three problems matter. That judgment needs the whole
 * business in view and it belongs to the model — a scoring formula over nine
 * enum values would be a worse audit wearing a determinism costume.
 *
 * What it *can* do is catch the model contradicting itself. The audit states,
 * per lens, when that area needs attention. If it then writes a top-three that
 * ignores a lens it called `now` in favour of one it called `later`, the
 * ranking disagrees with the reasoning that produced it — and no business
 * knowledge is needed to see that.
 *
 * That is exactly the failure this sprint exists to fix. The first nine-lens
 * dogfood found the right problems and ordered them wrong, and nothing in the
 * pipeline noticed. A note here is how the *next* miscalibration shows up in
 * the stored record instead of being found by reading an audit by hand.
 *
 * ## Why these are notes and never rejections
 *
 * Two reasons, one of them learned expensively.
 *
 * CORE-2a.2 made a flat blocklist that rejected an entire audit on one phrase.
 * Three real refreshes died on the same word, $0.25 of inference discarded, for
 * output a founder would have understood fine. Rejection is for output that
 * would mislead — not for output that could have been ordered better.
 *
 * And a rejection here would be wrong on the merits: an inversion is a strong
 * signal, not proof. Three slots and four `now` lenses is not a defect, and
 * there are real audits where a `later` blocker is the honest call. The model
 * is allowed to overrule this; it just has to leave a trace when it does.
 */

/**
 * Sort order for materiality. Lower sorts first.
 *
 * `unknown` sits last deliberately. It is not a middle value — it means the
 * audit could not judge, and something unjudged must never outrank something
 * the audit actually assessed.
 */
const MATERIALITY_RANK: Record<LensMateriality, number> = {
  now: 0,
  soon: 1,
  later: 2,
  not_material: 3,
  unknown: 4,
};

/** True when a lens is a legitimate candidate for the top three. */
export function isActionable(materiality: LensMateriality): boolean {
  return ACTIONABLE_MATERIALITY.includes(materiality);
}

/**
 * Lens assessments in the order the audit itself said they matter.
 *
 * Stable within a materiality band: the model's own ordering is preserved
 * rather than re-sorted by health, because sorting by health inside a band
 * would reintroduce exactly the severity-equals-priority conflation the schema
 * split apart.
 */
export function rankLenses(lenses: BusinessLensAssessment[]): BusinessLensAssessment[] {
  return [...lenses].sort(
    (a, b) => MATERIALITY_RANK[a.materiality] - MATERIALITY_RANK[b.materiality],
  );
}

function lensLabel(lens: BusinessLens): string {
  return lens.replace(/_/g, " ");
}

/** Blockers that cite at least one lens. Older conclusions may cite none. */
function withLenses(blockers: BusinessConclusion[]): BusinessConclusion[] {
  return blockers.filter((blocker) => blocker.lenses.length > 0);
}

/**
 * Where the top three disagree with the lens assessments behind them.
 *
 * Reports the pairing, never either half alone. An unrepresented `now` lens is
 * not by itself a problem — there are three slots and there may be four things
 * that matter. A blocker built on `later` lenses is not by itself a problem
 * either, if nothing more urgent exists. What is a problem is a `later` blocker
 * occupying a slot *while* something the audit called `now` was left out.
 */
export function findPriorityInversions(synthesis: AuditSynthesis): string[] {
  const { lenses, blockers } = synthesis;
  if (lenses.length === 0) return [];

  const materialityOf = new Map(lenses.map((entry) => [entry.lens, entry.materiality]));
  const grounded = withLenses(blockers);
  if (grounded.length === 0) return [];

  const representedLenses = new Set(grounded.flatMap((blocker) => blocker.lenses));
  const neglected = lenses
    .filter((entry) => entry.materiality === "now" && !representedLenses.has(entry.lens))
    .map((entry) => entry.lens);

  if (neglected.length === 0) return [];

  const premature = grounded.filter((blocker) =>
    blocker.lenses.every((lens) => {
      const materiality = materialityOf.get(lens);
      // A lens cited but never assessed cannot argue for the blocker's place.
      return materiality === undefined || !isActionable(materiality);
    }),
  );

  if (premature.length === 0) return [];

  return premature.map(
    (blocker) =>
      `Prioritization to review: "${blocker.headline}" rests only on areas the audit itself judged not to be immediate, ` +
      `while ${neglected.map(lensLabel).join(" and ")} was assessed as needing attention now and appears in no blocker.`,
  );
}

/**
 * The most urgent materiality any of a conclusion's lenses carries.
 *
 * A root problem spanning several lenses is as urgent as its most urgent part —
 * which is the correct reading of "the economics are not defined" resting on one
 * `now` lens and two `later` ones (§10).
 */
function urgencyOf(
  conclusion: BusinessConclusion,
  materialityOf: Map<BusinessLens, LensMateriality>,
): number {
  const ranks = conclusion.lenses
    .map((lens) => materialityOf.get(lens))
    .filter((materiality): materiality is LensMateriality => materiality !== undefined)
    .map((materiality) => MATERIALITY_RANK[materiality]);

  return ranks.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...ranks);
}

/**
 * Where the blocker order reverses the audit's own materiality (§9, §37, §48).
 *
 * Separate from `findPriorityInversions`, which asks whether the right problems
 * were *selected*. This asks whether they were *ordered* — the v4 dogfood
 * selected correctly and then listed a `soon` root problem above a `now` one
 * with nothing said about why.
 *
 * An override is permitted; the rubric names legitimate reasons. What is not
 * permitted is an override that leaves no trace, because "the audit had a
 * reason" and "the audit ignored itself" look identical from the outside. So
 * the note fires only when the conclusion's own `rootProblem` is silent — a
 * stated reason satisfies it, and this deliberately does not judge whether the
 * reason is a good one. That is a human's call on reading the audit.
 */
export function findOrderingOverrides(synthesis: AuditSynthesis): string[] {
  const { lenses, blockers } = synthesis;
  if (lenses.length === 0 || blockers.length < 2) return [];

  const materialityOf = new Map(lenses.map((entry) => [entry.lens, entry.materiality]));
  const notes: string[] = [];

  /*
   * The conclusion that needs to justify itself is the one that **jumped the
   * queue** — the less urgent problem placed higher — not the one it displaced.
   * Getting this backwards would ask the demoted problem to explain someone
   * else's promotion, and would accept a justification written in the wrong
   * place as if it settled the question.
   */
  for (let promoted = 0; promoted < blockers.length; promoted += 1) {
    const jumper = blockers[promoted]!;
    if (jumper.rootProblem.trim() !== "") continue;

    const displaced = blockers
      .slice(promoted + 1)
      .find((later) => urgencyOf(jumper, materialityOf) > urgencyOf(later, materialityOf));

    if (displaced === undefined) continue;

    notes.push(
      `Prioritization to review: "${jumper.headline}" is listed above "${displaced.headline}", ` +
        `which the audit judged more immediate, and no reason for the order was recorded.`,
    );
  }

  return notes;
}

/**
 * Blockers that assert a deficiency the audit said it could not assess (§31).
 *
 * The distinction the audit has to keep is between a problem the evidence
 * establishes and a decision only the founder can make. Both can matter; only
 * one is a finding. When every lens under a blocker came back
 * `blocked_by_missing_context`, the audit stated it could not judge that area —
 * so a conclusion asserting the business *lacks* something there is Vibe's own
 * blind spot dressed as a diagnosis. CLAUDE.md rule 44 in the synthesis layer.
 *
 * A note rather than a rejection, and the reason is that the fix is usually
 * wording. "Your unit economics don't work" and "what this costs you to run is
 * still an open question" can rest on identical evidence; the second is honest.
 * The hedging vocabulary below is the rubric's own, so a conclusion that took
 * the instruction passes without a human ever seeing this.
 */
const OPEN_QUESTION_PHRASES = [
  "open question",
  "couldn't see",
  "could not see",
  "couldn't find",
  "could not find",
  "haven't decided",
  "have not decided",
  "hasn't been decided",
  "you'll need to decide",
  "still unclear",
  "isn't clear",
  "is unclear",
  "unknown",
  "vibe hasn't",
  "vibe has not",
];

function readsAsOpenQuestion(conclusion: BusinessConclusion): boolean {
  const text =
    `${conclusion.headline} ${conclusion.explanation} ${conclusion.whyItMatters ?? ""}`.toLowerCase();
  return OPEN_QUESTION_PHRASES.some((phrase) => text.includes(phrase));
}

export function findUnconfirmedAssertions(synthesis: AuditSynthesis): string[] {
  const { lenses, blockers } = synthesis;
  if (lenses.length === 0) return [];

  const healthOf = new Map(lenses.map((entry) => [entry.lens, entry.health]));
  const notes: string[] = [];

  for (const blocker of blockers) {
    if (blocker.lenses.length === 0) continue;

    const allBlocked = blocker.lenses.every(
      (lens) => healthOf.get(lens) === "blocked_by_missing_context",
    );
    if (!allBlocked || readsAsOpenQuestion(blocker)) continue;

    notes.push(
      `Wording to improve: "${blocker.headline}" is stated as a confirmed problem, but every area behind it was one the audit could not assess — it is an open question rather than a finding.`,
    );
  }

  return notes;
}

/**
 * How many "no <something>" clauses a sentence contains.
 *
 * The proxy for evidence enumeration (§19–§21). The real dogfood explanation
 * that motivated this reads:
 *
 *   "There's no pricing shown anywhere, no way for anyone to pay, and no
 *    payment system built into the code"
 *
 * Three absences in one sentence, and a founder still has to work out what they
 * mean together. The business conclusion underneath — nobody has decided what
 * people pay for or how usage becomes a price — is a sentence with no absence
 * clauses in it at all, which is what makes the count a usable signal rather
 * than a stylistic preference.
 */
export function countAbsenceClauses(text: string): number {
  return (text.match(/\bno\s+[a-z]/gi) ?? []).length + (text.match(/\bnothing\b/gi) ?? []).length;
}

/**
 * Above this, an explanation is listing findings rather than stating a problem.
 *
 * Three, because one or two absences are how you honestly describe a gap, and
 * the third is where a sentence turns into an inventory. Deliberately generous:
 * this is a nudge in the record, so a false positive costs a line of text and a
 * missed one costs nothing that the dogfood would not also catch.
 */
export const MAX_ABSENCE_CLAUSES = 3;

/**
 * Conclusions whose explanation reads as a list of what was not found.
 *
 * Never applied to headlines — a headline is one sentence and rarely has room
 * to enumerate — and never a rejection, because a surface absence genuinely is
 * the business problem sometimes (§22, §49). A business with real demand, a
 * known model and a broken checkout should say "customers cannot complete a
 * purchase", and that sentence should not be penalised for being about a
 * missing thing.
 */
export function findEvidenceEnumeration(synthesis: AuditSynthesis): string[] {
  const notes: string[] = [];

  for (const conclusion of [...synthesis.blockers, ...synthesis.strengths]) {
    if (countAbsenceClauses(conclusion.explanation) >= MAX_ABSENCE_CLAUSES) {
      notes.push(
        `Wording to improve: "${conclusion.headline}" is explained by listing what is missing rather than by naming the underlying business problem.`,
      );
    }
  }

  return notes;
}
