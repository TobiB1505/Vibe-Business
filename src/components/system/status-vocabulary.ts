import type { StatusGlyphName, StatusTone } from "@/components/ui/status-pill";
import type { NovaFocusTier } from "@/modules/nova/focus";
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
 */

export type StatusPresentation = {
  tone: StatusTone;
  glyph: StatusGlyphName;
  /** What a founder reads. Always rendered — a state never depends on colour. */
  word: string;
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
  idle: { tone: "neutral", glyph: "pending", word: "Ready" },
  working: { tone: "active", glyph: "running", word: "Working" },
  /*
   * The one that must never read as activity. "Waiting for you" names who is
   * holding the work, which is the fact the founder needs in order to act.
   */
  waiting_user: { tone: "waiting", glyph: "unknown", word: "Waiting for you" },
  /*
   * Amber rather than coral. A stall is inferred from a clock, not observed —
   * the run may yet be alive — so it is a waiting state with an honest word,
   * not a failure the product cannot actually claim.
   */
  stalled: { tone: "waiting", glyph: "expired", word: "Stalled" },
  settled: { tone: "neutral", glyph: "confirmed", word: "Finished" },

  blocked: { tone: "waiting", glyph: "unseen", word: "Blocked" },
  decision: { tone: "waiting", glyph: "unknown", word: "Needs a decision" },
  ready: { tone: "active", glyph: "pending", word: "Ready" },
  setup: { tone: "neutral", glyph: "pending", word: "Worth doing" },
  /*
   * Neutral, and the word is a full sentence's worth of meaning: nothing is
   * wrong, and nothing is owed. Rendering this as a success would congratulate
   * the founder for a state they did not reach by doing anything.
   */
  nothing_to_do: { tone: "neutral", glyph: "confirmed", word: "Nothing to do" },

  completed: { tone: "success", glyph: "confirmed", word: "Completed" },
  failed: { tone: "problem", glyph: "refused", word: "Failed" },
  /* Vibe's problem, not the product's. Amber, and it says whose it is. */
  could_not_check: { tone: "waiting", glyph: "unknown", word: "Could not check" },
  never_reached: { tone: "neutral", glyph: "skipped", word: "Never reached" },
  /*
   * A phrase rather than a state word. The audit flagged "Not applicable" as
   * an internal enum wearing a label; a founder reads why it does not apply.
   */
  not_applicable: { tone: "neutral", glyph: "skipped", word: "Not needed here" },
};

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
