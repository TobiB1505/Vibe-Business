import type { ScoreTone } from "@/components/ui/score-display";
import type { StatusGlyphName, StatusTone } from "@/components/ui/status-pill";
import type { FocusCandidateKind, NovaFocusTier } from "@/modules/nova/focus";
import type { OperationPollPhase } from "@/modules/operations/view";

/**
 * One state vocabulary for the whole product (UI Sourcing Spec §8.1, C9).
 *
 * ## What this replaces
 *
 * Four parallel `Record<SomeState, "text-mint" | …>` tables and eleven
 * hand-rolled pills. The audit found the same English word carrying different
 * colours on adjacent panels, and different words carrying the same state —
 * which is not drift anyone chose, it is what happens when every screen maps
 * its own enum to its own pixels.
 *
 * ## What it is, and what it must never become
 *
 * A **total** map from a domain state to `{ tone, glyph, word }`. It decides
 * presentation only. It never re-decides what state something is in: every
 * input here is a value some other module derived under its own authority —
 * `operationPollPhase` from the operations view, `NovaFocusTier` from
 * `deriveNovaFocus` — and this file has nothing to invent one from.
 *
 * A component that needs a colour for a state asks here. A component that
 * writes its own table is the bug this file exists to make unnecessary, and
 * `status-vocabulary.test.ts` asserts that Nova's components contain none.
 *
 * ## The two distinctions the words must keep
 *
 * **Waiting is never Working.** `needs_user` is a person's turn, and the
 * product has been explicit since the operations view that it renders as
 * waiting rather than as activity. A single "in progress" for both would tell
 * a founder that Vibe is busy when in fact Vibe is blocked on them.
 *
 * **"Could not check" is never "Failed".** One is a statement about Vibe and
 * the other about the customer's product. The split is a product claim, so the
 * vocabulary keeps two words for it rather than one.
 *
 * ## Why a candidate has its own word and a tier is not enough
 *
 * `statusForFocusTier` was the only way to label one of Nova's moments, and it
 * put the word **"Blocked"** over all ten candidates in that tier. Four of
 * them are runs that errored, three are runs nobody can account for, one is a
 * disconnected source, one is a validation that returned non-zero, and exactly
 * one — a merge a branch rule refused — is actually blocked. A founder read
 * the same word for all ten and learned nothing from any of them.
 *
 * So `statusForCandidate` maps the twenty-one kinds individually. The tier
 * function stays for callers that genuinely only hold a tier; a caller with a
 * kind must use the kind, and `status-vocabulary.test.ts` holds the line.
 */

export type StatusPresentation = {
  tone: StatusTone;
  glyph: StatusGlyphName;
  /** What a founder reads. Always rendered — a state never depends on colour. */
  word: string;
  /**
   * Whether a loop is still hanging here.
   *
   * `true` means nothing has concluded: a run in flight, a run nobody can
   * account for, a question suspending one. `false` means this is a settled
   * fact, whatever else it is — a failure is settled, a change awaiting review
   * is settled, a refused merge is settled.
   *
   * A second axis rather than a shade of the first, because *how bad* and
   * *whether it is over* are different questions and the product kept
   * answering the second with the first. A stall was drawn amber-instead-of-
   * coral, which reads as **less bad** when the domain was saying **less
   * certain**. Here it is coral and unclosed, which is both halves.
   *
   * Presentation reads it as a contour: unclosed states are drawn dashed.
   */
  open: boolean;
};

/**
 * Every state this vocabulary can be asked about, named once.
 *
 * A union rather than a string so that a caller cannot ask for a state that
 * does not exist, and so adding a state to the product fails the build here
 * until somebody decides what it says.
 */
export type StatusKey =
  /* An operation, as `operationPollPhase` reads it. */
  | "idle"
  | "working"
  | "waiting_user"
  | "stalled"
  | "settled"
  /* A focus tier, as `deriveNovaFocus` ranks it. */
  | "blocked"
  | "decision"
  | "ready"
  | "setup"
  | "nothing_to_do"
  /* States a Nova candidate needs and a tier could not express. */
  | "disconnected"
  | "overdue"
  | "needs_answer"
  | "needs_choice"
  | "out_of_date"
  | "did_not_pass"
  | "not_settled"
  /* Outcomes, shared by validation, merge and outcome checks. */
  | "completed"
  | "failed"
  | "could_not_check"
  | "never_reached"
  | "not_applicable";

const STATUS: Record<StatusKey, StatusPresentation> = {
  /*
   * `idle` is neutral and says "Ready" rather than "Idle": the founder is
   * being told the product is available to them, not that it is doing nothing.
   */
  idle: { tone: "neutral", glyph: "pending", word: "Ready", open: false },
  working: { tone: "active", glyph: "running", word: "Working", open: true },
  /*
   * The one that must never read as activity. "Waiting for you" names who is
   * holding the work, which is the fact the founder needs in order to act.
   */
  waiting_user: { tone: "waiting", glyph: "unknown", word: "Waiting for you", open: true },
  /*
   * Amber rather than coral. A stall is inferred from a clock, not observed —
   * the run may yet be alive — so it is a waiting state with an honest word,
   * not a failure the product cannot actually claim.
   */
  stalled: { tone: "waiting", glyph: "expired", word: "Stalled", open: true },
  settled: { tone: "neutral", glyph: "confirmed", word: "Finished", open: false },

  blocked: { tone: "waiting", glyph: "unseen", word: "Blocked", open: false },
  decision: { tone: "waiting", glyph: "unknown", word: "Needs a decision", open: false },
  ready: { tone: "active", glyph: "pending", word: "Ready", open: false },
  setup: { tone: "neutral", glyph: "pending", word: "Worth doing", open: false },
  /*
   * Neutral, and the word is a full sentence's worth of meaning: nothing is
   * wrong, and nothing is owed. Rendering this as a success would congratulate
   * the founder for a state they did not reach by doing anything.
   */
  nothing_to_do: { tone: "neutral", glyph: "confirmed", word: "Nothing to do", open: false },

  completed: { tone: "success", glyph: "confirmed", word: "Completed", open: false },
  failed: { tone: "problem", glyph: "refused", word: "Failed", open: false },
  /* Vibe's problem, not the product's. Amber, and it says whose it is. */
  could_not_check: { tone: "waiting", glyph: "unknown", word: "Could not check", open: false },
  never_reached: { tone: "neutral", glyph: "skipped", word: "Never reached", open: false },
  /*
   * A phrase rather than a state word. The audit flagged "Not applicable" as
   * an internal enum wearing a label; a founder reads why it does not apply.
   */
  not_applicable: { tone: "neutral", glyph: "skipped", word: "Not needed here", open: false },

  /*
   * The seven a tier could not say.
   *
   * `blocked` above keeps its word and now carries exactly one candidate — a
   * merge a branch rule refused, which is the only one of the ten where
   * "Blocked" was ever the true sentence.
   */
  disconnected: { tone: "problem", glyph: "refused", word: "Disconnected", open: false },
  /*
   * A run nobody can account for. Coral because something *is* wrong — it
   * should have finished and did not — and open because it may yet be alive,
   * which is the half the old amber-instead-of-coral was carrying alone and
   * carrying badly. "Overdue" says both without claiming a failure the product
   * never observed, which is the line `Failed` would cross.
   */
  overdue: { tone: "problem", glyph: "expired", word: "Overdue", open: true },
  /*
   * A live run suspended on a person. Open, because the loop is hanging — and
   * that is what separates it from a change awaiting review, which is a
   * finished thing sitting there whether anybody looks at it or not.
   */
  needs_answer: { tone: "waiting", glyph: "unknown", word: "Needs your answer", open: true },
  needs_choice: { tone: "waiting", glyph: "unknown", word: "Needs your choice", open: true },
  /* Not wrong and not urgent: what is on screen rests on a stale reading. */
  out_of_date: { tone: "waiting", glyph: "expired", word: "Out of date", open: false },
  /*
   * A validation that ran and returned non-zero. Settled — the checks have an
   * answer — and deliberately not "Failed": that word is Vibe's for its own
   * machinery, and this is the customer's code speaking.
   */
  did_not_pass: { tone: "problem", glyph: "refused", word: "Did not pass", open: false },
  /* The branch moved and no outcome has been read back yet. */
  not_settled: { tone: "neutral", glyph: "pending", word: "Not settled yet", open: true },
};

/**
 * One word per moment Nova can raise.
 *
 * Read the two axes rather than the twenty-one rows. **Tone** says what kind
 * of thing this is; **`open`** says whether anything is still hanging. Four of
 * the six combinations are in use, and each is a different appearance —
 * "something errored" and "something is unaccounted for" are no longer the
 * same coral, and "a change is waiting" and "a run is waiting on your answer"
 * are no longer the same amber.
 */
const CANDIDATE_STATUS: Record<FocusCandidateKind, StatusKey> = {
  source_disconnected: "disconnected",
  agent_failed: "failed",
  scan_failed: "failed",
  audit_failed: "failed",
  agent_stalled: "overdue",
  scan_stalled: "overdue",
  audit_stalled: "overdue",
  validation_failed: "did_not_pass",
  /* The one that really is blocked: a rule the repository owner set refused it. */
  merge_blocked: "blocked",
  repository_read_outdated: "out_of_date",
  agent_question: "needs_answer",
  founder_input_required: "needs_answer",
  workspace_choice_required: "needs_choice",
  /* A finished thing sitting there. Settled, however much it wants a person. */
  review_change: "decision",
  merge_ready: "decision",
  execution_offered: "ready",
  outcome_pending: "not_settled",
  plan_offered: "ready",
  next_move_available: "ready",
  audit_outdated: "out_of_date",
  nothing_to_do: "nothing_to_do",
};

/**
 * What one of Nova's moments says about itself.
 *
 * Prefer this over `statusForFocusTier` wherever a candidate kind is in hand.
 * The tier is a ranking decision and was never a description: it put "Blocked"
 * over a crashed run, a run nobody can account for, a disconnected source and
 * a refused merge alike.
 */
export function statusForCandidate(kind: FocusCandidateKind): StatusPresentation {
  return STATUS[CANDIDATE_STATUS[kind]];
}

export function statusPresentation(key: StatusKey): StatusPresentation {
  return STATUS[key];
}

/**
 * An operation's phase, as the operations view already decided it.
 *
 * A pass-through rather than a mapping: `OperationPollPhase` and the first
 * five `StatusKey`s are the same five words on purpose, so that adding a
 * phase to the operations module fails to compile here.
 */
export function statusForOperationPhase(phase: OperationPollPhase): StatusPresentation {
  return STATUS[phase];
}

/**
 * A focus tier, as `deriveNovaFocus` ranked it.
 *
 * `settled` is the tier Nova adds past the account surface's four, and it maps
 * to `nothing_to_do` rather than to `settled` — the operation word — because
 * they are different facts. An operation that settled finished doing
 * something; a settled focus means there was nothing to do in the first place.
 */
export function statusForFocusTier(tier: NovaFocusTier): StatusPresentation {
  return tier === "settled" ? STATUS.nothing_to_do : STATUS[tier];
}

/**
 * Which state Nova's mark stands in (`components/nova/nova-presence.tsx`).
 *
 * ## Why this is derived and not a prop somebody picks
 *
 * The prototype this avatar comes from sets a presence per scene, which is
 * right for a prototype and wrong for the product: a mark a caller can set to
 * `working` is a mark that can claim activity nobody observed, which is the
 * one thing `DESIGN.md` calls a lie rather than a style. So the state is a
 * function of what the domain already decided, and this is the only place that
 * function exists.
 *
 * ## The four readings
 *
 * - **`working`** — and *only* when an operation the product recorded is
 *   genuinely running. Not "a run exists", not "something is blocked": the
 *   operations view's own `working` phase and nothing else turns the frame.
 * - **`listening`** — the work is with the founder. Either an operation paused
 *   on them, or the ranking's top item is a decision they have to make. The
 *   iris is open because Nova is waiting on a person, not on a machine.
 * - **`settled`** — nothing needs them. The widest, brightest state, and still.
 * - **`idle`** — something is true and none of the above: blocked, stalled,
 *   ready to start. Dim and still, because Nova is not doing anything about it.
 *
 * A stall is deliberately **not** `working`. It is inferred from a clock rather
 * than observed, and a turning frame over a run that may already be dead is
 * exactly the animated claim this mapping exists to prevent.
 */
export function novaPresenceState(input: {
  tier: NovaFocusTier;
  phase: OperationPollPhase;
}): "idle" | "listening" | "working" | "settled" {
  if (input.phase === "working") return "working";
  if (input.phase === "waiting_user" || input.tier === "decision") return "listening";
  if (input.tier === "settled") return "settled";
  return "idle";
}

/**
 * A score band as a status tone.
 *
 * Three components carried this as a private `SCORE_TONE` map — the product
 * card, the products-index row and the dashboard's signal card — all four
 * lines identical in each. That is the table this module exists to make
 * unnecessary, and three copies is how the same band starts rendering in two
 * colours on adjacent screens.
 *
 * `unscored` is `neutral` and deliberately not `problem`: a product nothing
 * could be measured on has not scored badly, and colouring it as failure is
 * rule 44 in pixels.
 */
export function statusForScoreTone(tone: ScoreTone): StatusTone {
  switch (tone) {
    case "strong":
      return "success";
    case "partial":
      return "waiting";
    case "weak":
      return "problem";
    case "unscored":
      return "neutral";
  }
}
