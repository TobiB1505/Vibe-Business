import { classifyStep } from "./classify";
import type { CapabilityMatchContext } from "./capability-registry";
import { repairDependencies } from "./sequence";
import {
  MAX_PLAN_STEPS,
  MIN_PLAN_STEPS,
  PLAN_INFLATION_THRESHOLD,
  STEP_ACTORS,
  STEP_CHANGE_KINDS,
  type ActionPlanStep,
  type StepActor,
  type StepChangeKind,
} from "./schema";
import type { WirePlan, WirePlanStep } from "./wire-schema";

/**
 * Domain validation of a billed plan (CORE-2b §63–§67).
 *
 * Schema compliance is not usefulness. The provider guarantees the shape; this
 * layer decides whether the content is a plan, and it is willing to discard
 * parts of a response we already paid for.
 *
 * ## Repair versus reject
 *
 * - **Repaired** — an unverifiable evidence id, a duplicate step, a plan longer
 *   than the ceiling, a prerequisite pointing at nothing, a dependency loop, a
 *   strategic decision assigned to Vibe. In each case the intent is
 *   unambiguous and discarding the whole plan would waste sound reasoning.
 * - **Rejected** — a step with no title or no completion criterion, a plan with
 *   no goal, a plan left with fewer than two usable steps. We cannot know what
 *   was meant, and a one-step "plan" is not a path.
 *
 * ## Notes are not the same as findings
 *
 * `notes` is prose for a human reading the plan. `findings` is a closed set of
 * codes, so "did validation notice the plan was a consulting checklist?" is a
 * question a test — and a later screen — can ask without matching on English.
 * Both are persisted; neither is ever shown as an excuse for a bad plan.
 *
 * ## The two judgment validators
 *
 * `checklist_shaped_plan` and `no_changed_state` are the planner's equivalent
 * of the audit's abstraction check (§64, §65). They are structural, not a
 * phrase blacklist: a step is vague when its completion criterion carries no
 * information beyond its own title, which catches "Improve positioning →
 * positioning is improved" without needing to know the word "improve".
 */

export type PlanValidationFailure = "structured_output_schema_invalid";

export type PlanValidationReason =
  | "no_valid_steps"
  | "plan_too_thin"
  | "missing_plan_goal"
  | "missing_root_problem_link";

/** Everything validation can notice, as codes rather than prose (§63). */
export const PLAN_VALIDATION_FINDINGS = [
  /** Cited evidence ids that do not exist in the pack were removed (§45). */
  "unverified_evidence_dropped",
  /** A step was dropped because required fields were missing or invalid. */
  "step_discarded",
  /** Two steps claimed the same changed state (§80). */
  "duplicate_step_removed",
  /** The plan exceeded the step ceiling and was cut (§30). */
  "plan_truncated",
  /** A prerequisite pointed at a step that is not in the plan (§21). */
  "dependency_removed",
  /** Prerequisites formed a loop and were broken (§79). */
  "dependency_cycle_broken",
  /** A strategic decision was assigned to Vibe and was reassigned (§22, §63). */
  "founder_decision_reassigned",
  /** A completion criterion restated its own title (§20, §65). */
  "vague_completion_criteria",
  /** Most of the plan is vague — it reads as a checklist, not a path (§32, §81). */
  "checklist_shaped_plan",
  /** Nothing in the plan decides anything or changes anything (§64). */
  "no_changed_state",
  /** More steps than a Move of this shape should need (§29, §30). */
  "plan_inflation",
  /**
   * A plan-level narrative field was cut to fit its length ceiling
   * (CORE-2b MINI VERIFICATION §1.4).
   *
   * The real dogfood's `whyNow` proved this can fire: two sentences of
   * legitimate reasoning were cut mid-word because `whyNow` shared its length
   * ceiling with `completionCriteria` — a compact, single-purpose field — by
   * accident of both calling the same helper with the same second argument,
   * not by any deliberate contract choice. `MAX_NARRATIVE` (below) is
   * generous enough that this is not expected to fire in practice; when it
   * does, the plan says so instead of silently losing the tail of a sentence.
   */
  "narrative_field_truncated",
] as const;
export type PlanValidationFinding = (typeof PLAN_VALIDATION_FINDINGS)[number];

export type ValidatedPlan = {
  goal: string;
  whyNow: string;
  expectedOutcome: string;
  addressesRootProblem: string;
  assumptions: string[];
  steps: ActionPlanStep[];
  notes: string[];
  findings: PlanValidationFinding[];
};

export type PlanValidateResult =
  | { ok: true; result: ValidatedPlan }
  | { ok: false; error: PlanValidationFailure; reason: PlanValidationReason };

const MAX_TITLE = 120;
const MAX_PROSE = 600;
const MAX_CRITERIA = 400;
/**
 * Plan-level narrative fields — `whyNow`, `expectedOutcome`,
 * `addressesRootProblem` — get their own ceiling rather than sharing
 * `MAX_CRITERIA` with per-step `purpose`/`completionCriteria`.
 *
 * Those step fields are deliberately compact: a completion criterion is one
 * observable state, not a paragraph (§20). A plan's `whyNow` is explanatory
 * business reasoning carried from the audit — routinely two or three
 * sentences — and the real dogfood's response proved the shared 400-char
 * limit was too small for it: legitimate content was cut mid-word the moment
 * it was normalized, before it ever reached the database.
 *
 * 600 matches the Opportunity Engine's own `whyNow` field
 * (`opportunities/validate.ts`'s `MAX_TEXT_LENGTH`), which already carries
 * the same kind of content under the same "why this, now" framing — so this
 * is consistency with an existing sibling contract, not a new number picked
 * to fit one observed string.
 *
 * Still a hard ceiling, not its removal (Rule 27): a pathological response is
 * still capped. What changed is that ordinary prose no longer collides with
 * it, and `narrativeField` below records it in `notes`/`findings` on the rare
 * run where it still fires, rather than losing the fact silently.
 */
const MAX_NARRATIVE = 600;
const MAX_EVIDENCE_IDS = 4;
const MAX_DEPENDENCIES = 4;
const MAX_ASSUMPTIONS = 4;

/**
 * The shortest completion criterion that can carry a state.
 *
 * Not a style rule. "Done." and "Complete" are the two things this catches, and
 * both are the absence of a criterion wearing the shape of one.
 */
const MIN_CRITERIA_LENGTH = 24;

function text(value: unknown, maxLength = MAX_PROSE): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}…` : collapsed;
}

/**
 * Reads a plan-level narrative field, and records it if `MAX_NARRATIVE` (a
 * safety net, not an expected ceiling — see its comment) actually fires.
 *
 * Everywhere else a repair happens silently in this file *except* where the
 * repair changes what a field means to a reader — dropping an unverifiable
 * evidence id is invisible because the sentence around it still reads
 * correctly; cutting a sentence in half is not. So this is `text()` plus the
 * one thing `text()` cannot do on its own: say when it had to act.
 */
function narrativeField(
  value: unknown,
  field: string,
  notes: string[],
  findings: Set<PlanValidationFinding>,
): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  if (collapsed.length <= MAX_NARRATIVE) return collapsed;

  notes.push(
    `"${field}" was ${collapsed.length} characters and was cut to fit the ${MAX_NARRATIVE}-character limit.`,
  );
  findings.add("narrative_field_truncated");
  return `${collapsed.slice(0, MAX_NARRATIVE)}…`;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function stringList(value: unknown, cap: number, maxLength = 200): string[] {
  if (!Array.isArray(value)) return [];
  const kept: string[] = [];
  for (const entry of value) {
    const item = text(entry, maxLength);
    if (item !== null && !kept.includes(item)) kept.push(item);
    if (kept.length >= cap) break;
  }
  return kept;
}

function integerList(value: unknown, cap: number): number[] {
  if (!Array.isArray(value)) return [];
  const kept: number[] = [];
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isInteger(entry)) continue;
    if (!kept.includes(entry)) kept.push(entry);
    if (kept.length >= cap) break;
  }
  return kept;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalize(value).split(" ").filter(Boolean);
}

function slug(value: string): string {
  return normalize(value).replace(/ /g, "-").slice(0, 48);
}

/**
 * Words that carry no state on their own (§65).
 *
 * Not a blacklist of bad plans — these words are perfectly good inside a real
 * criterion. They are excluded only when deciding whether a criterion says
 * *anything* its title did not already say.
 */
const FILLER = new Set([
  "is",
  "are",
  "was",
  "has",
  "have",
  "been",
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "for",
  "with",
  "this",
  "that",
  "it",
  "step",
  "task",
  "done",
  "complete",
  "completed",
  "finished",
  "successfully",
  "properly",
  "improved",
  "updated",
  "better",
]);

/**
 * True when the criterion adds nothing to the title (§20, §65).
 *
 * Structural rather than lexical: strip filler, and ask whether any word
 * survives that the title did not already contain. "Improve positioning" with
 * "Positioning is improved" survives nothing and is caught; "Rewrite the main
 * promise" with "The homepage's first sentence names the confirmed segment" is
 * full of new words and is not.
 */
function isVagueCriterion(title: string, criteria: string): boolean {
  if (criteria.length < MIN_CRITERIA_LENGTH) return true;

  const titleWords = new Set(tokens(title));
  const informative = tokens(criteria).filter((word) => !FILLER.has(word) && !titleWords.has(word));
  return informative.length === 0;
}

type Candidate = {
  order: number;
  step: Omit<ActionPlanStep, "id" | "order" | "executionSupport" | "capability" | "requiresApproval">;
};

function readStep(
  entry: WirePlanStep,
  knownEvidenceIds: Set<string>,
  notes: string[],
  findings: Set<PlanValidationFinding>,
): Candidate | null {
  const title = text(entry.title, MAX_TITLE);
  const description = text(entry.description);
  const purpose = text(entry.purpose, MAX_CRITERIA);
  const completionCriteria = text(entry.completionCriteria, MAX_CRITERIA);
  const actor = oneOf<StepActor>(entry.actor, STEP_ACTORS);
  const changeKind = oneOf<StepChangeKind>(entry.changeKind, STEP_CHANGE_KINDS);

  if (
    title === null ||
    description === null ||
    purpose === null ||
    completionCriteria === null ||
    actor === null ||
    changeKind === null
  ) {
    notes.push("A plan step was discarded because required fields were missing or invalid.");
    findings.add("step_discarded");
    return null;
  }

  const citedIds = stringList(entry.evidenceIds, MAX_EVIDENCE_IDS);
  const evidenceIds = citedIds.filter((id) => knownEvidenceIds.has(id));
  if (evidenceIds.length !== citedIds.length) {
    notes.push(
      `${citedIds.length - evidenceIds.length} cited evidence id(s) did not exist in the evidence pack and were removed from "${title}".`,
    );
    findings.add("unverified_evidence_dropped");
  }

  /*
   * A strategic decision assigned to Vibe (§22, §63, §75).
   *
   * Repaired rather than rejected, because the step itself is usually right and
   * only its ownership is wrong — and getting ownership wrong in this direction
   * is the single most consequential mistake this contract can make. "Vibe
   * decides who your first customer is" is not a smaller version of a good
   * plan; it is Vibe taking a decision that is not ours.
   */
  let resolvedActor = actor;
  if (actor === "vibe" && changeKind === "decision") {
    resolvedActor = "founder_decision";
    notes.push(
      `"${title}" was a strategic decision assigned to Vibe; it is the founder's to make and was reassigned.`,
    );
    findings.add("founder_decision_reassigned");
  }

  if (isVagueCriterion(title, completionCriteria)) {
    notes.push(`"${title}" does not say what would be different once it is done.`);
    findings.add("vague_completion_criteria");
  }

  const order =
    typeof entry.order === "number" && Number.isInteger(entry.order)
      ? entry.order
      : Number.MAX_SAFE_INTEGER;

  return {
    order,
    step: {
      title,
      description,
      purpose,
      actor: resolvedActor,
      changeKind,
      completionCriteria,
      dependsOn: integerList(entry.dependsOn, MAX_DEPENDENCIES),
      evidenceIds,
    },
  };
}

export function validateActionPlanOutput(
  wire: WirePlan,
  knownEvidenceIds: Set<string>,
  context: CapabilityMatchContext,
): PlanValidateResult {
  const notes: string[] = [];
  const findings = new Set<PlanValidationFinding>();

  const goal = text(wire.goal, 300);
  const whyNow = narrativeField(wire.whyNow, "whyNow", notes, findings);
  const expectedOutcome = narrativeField(wire.expectedOutcome, "expectedOutcome", notes, findings);
  const addressesRootProblem = narrativeField(
    wire.addressesRootProblem,
    "addressesRootProblem",
    notes,
    findings,
  );

  // A plan without a goal is a list. Rejected rather than repaired: there is
  // nothing to infer a goal from that would not be us writing the plan.
  if (goal === null || whyNow === null || expectedOutcome === null) {
    return { ok: false, error: "structured_output_schema_invalid", reason: "missing_plan_goal" };
  }

  // §37, §64: the plan must say how its outcome moves the source problem. This
  // is the planner's abstraction check, and it is a rejection rather than a
  // note because a plan that cannot state the link is answering a different
  // question than the one it was asked.
  if (addressesRootProblem === null) {
    return {
      ok: false,
      error: "structured_output_schema_invalid",
      reason: "missing_root_problem_link",
    };
  }

  const candidates = wire.steps
    .map((entry) => readStep(entry, knownEvidenceIds, notes, findings))
    .filter((candidate): candidate is Candidate => candidate !== null);

  if (candidates.length === 0) {
    return { ok: false, error: "structured_output_schema_invalid", reason: "no_valid_steps" };
  }

  // The model's ordering is authoritative; ties break by original position so
  // an identical response always produces an identical plan.
  const ordered = [...candidates].sort(
    (a, b) => a.order - b.order || candidates.indexOf(a) - candidates.indexOf(b),
  );

  /*
   * Duplicate detection keyed on the **changed state**, not on the title (§80).
   *
   * "Define your audience", "choose your audience" and "finalize your audience"
   * are three titles for one outcome, and a title-only key would keep all
   * three. Two steps that claim the same completion criterion are the same
   * step; two that claim different ones are different work, however similar
   * they read.
   */
  const seenCriteria = new Set<string>();
  const seenTitles = new Set<string>();
  const deduped: Candidate[] = [];
  for (const candidate of ordered) {
    const criteriaKey = normalize(candidate.step.completionCriteria);
    const titleKey = normalize(candidate.step.title);
    if (seenCriteria.has(criteriaKey) || seenTitles.has(titleKey)) {
      notes.push(
        `"${candidate.step.title}" was removed: it claims the same finished state as an earlier step.`,
      );
      findings.add("duplicate_step_removed");
      continue;
    }
    seenCriteria.add(criteriaKey);
    seenTitles.add(titleKey);
    deduped.push(candidate);
  }

  const capped = deduped.slice(0, MAX_PLAN_STEPS);
  if (deduped.length > MAX_PLAN_STEPS) {
    notes.push(
      `The plan had ${deduped.length} steps; the last ${deduped.length - MAX_PLAN_STEPS} were dropped to keep it a path rather than a backlog.`,
    );
    findings.add("plan_truncated");
  }

  // A single step is not a plan. Two is the floor, and it is a rejection
  // because there is no repair that turns one step into a path (§30).
  if (capped.length < MIN_PLAN_STEPS) {
    return { ok: false, error: "structured_output_schema_invalid", reason: "plan_too_thin" };
  }

  if (capped.length > PLAN_INFLATION_THRESHOLD) {
    notes.push(
      `This plan has ${capped.length} steps. A Move usually needs three to five; check the steps are business actions rather than implementation detail.`,
    );
    findings.add("plan_inflation");
  }

  /*
   * Orders are reassigned rather than trusted: after discarding, deduplication
   * and capping the model's numbering is stale by construction. Dependencies
   * are remapped through the same table, and an edge whose target did not
   * survive is dropped rather than guessed at.
   */
  const remap = new Map<number, number>();
  capped.forEach((candidate, index) => remap.set(candidate.order, index + 1));

  const renumbered = capped.map((candidate, index) => {
    const dependsOn: number[] = [];
    for (const target of candidate.step.dependsOn) {
      const mapped = remap.get(target);
      if (mapped === undefined) {
        notes.push(
          `"${candidate.step.title}" listed a prerequisite that is not in the final plan; it was removed.`,
        );
        findings.add("dependency_removed");
        continue;
      }
      if (mapped !== index + 1) dependsOn.push(mapped);
    }

    const classification = classifyStep(
      {
        actor: candidate.step.actor,
        changeKind: candidate.step.changeKind,
        evidenceIds: candidate.step.evidenceIds,
      },
      context,
    );

    const step: ActionPlanStep = {
      ...candidate.step,
      id: `${index + 1}-${candidate.step.changeKind}-${slug(candidate.step.title)}`,
      order: index + 1,
      dependsOn,
      executionSupport: classification.executionSupport,
      capability: classification.capability,
      requiresApproval: classification.requiresApproval,
    };
    return step;
  });

  // The repair reports what it did as flags rather than as prose, so this
  // layer never has to read the other's English to classify its own findings.
  const repaired = repairDependencies(renumbered);
  notes.push(...repaired.notes);
  if (repaired.removedDanglingEdge) findings.add("dependency_removed");
  if (repaired.brokeCycle) findings.add("dependency_cycle_broken");
  const steps = repaired.steps;

  /*
   * Root-problem fidelity, structurally (§64).
   *
   * A plan made entirely of analysis decides nothing and changes nothing: at
   * the end of it the business is in exactly the state it started in, better
   * described. That is a research memo, not a plan, and it is the failure mode
   * §29 and §32 describe from opposite directions.
   *
   * A note rather than a rejection — the analysis may be genuinely good and the
   * founder can still act on it — but a loud one, because the plan does not
   * do what a plan is for.
   */
  const movesSomething = steps.some(
    (step) => step.changeKind !== "analysis" && step.changeKind !== "research",
  );
  if (!movesSomething) {
    notes.push(
      "Every step in this plan produces analysis. Nothing here decides or changes anything, so the business problem would be unchanged at the end of it.",
    );
    findings.add("no_changed_state");
  }

  const vague = steps.filter((step) => isVagueCriterion(step.title, step.completionCriteria));
  if (vague.length * 2 >= steps.length) {
    notes.push(
      "Most steps in this plan do not say what would be different once they are done. This reads as a checklist rather than a path.",
    );
    findings.add("checklist_shaped_plan");
  }

  return {
    ok: true,
    result: {
      goal,
      whyNow,
      expectedOutcome,
      addressesRootProblem,
      assumptions: stringList(wire.assumptions, MAX_ASSUMPTIONS, 300),
      steps,
      notes,
      findings: [...findings],
    },
  };
}
