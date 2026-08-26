import {
  type ExecutionInterrupt,
  type ExecutionInterruptAnswer,
  type ExecutionInterruptResponseSchema,
  type ExecutionInterruptType,
} from "./schema";

/**
 * The user-interrupt contract (EXECUTION CORE-3 §21, §22).
 *
 * ## What an interrupt is
 *
 * A future agent run stopping to ask the customer one bounded, structured
 * question — and stopping, rather than guessing. It is the execution-layer
 * equivalent of the audit's existing `needs_user` boundary: the old immutable
 * attempt records why it stopped, while a resolved founder input can inform a
 * fresh admission and a new execution attempt.
 *
 * ## What it is not
 *
 * It is not a chat. There is no message thread, no follow-up, no free-form
 * exchange between a customer and a model. §34 and Rule 43 forbid persisting
 * hidden reasoning, and a conversation is exactly where reasoning would end up.
 * So the situation type is closed, the runtime question is bounded and
 * normalized into the Founder Input domain, and the answer arrives as
 * structured data. The next resolution consumes the resulting durable project
 * context rather than an in-memory answer or a transcript.
 *
 * The operational interrupt and canonical Founder Input Request are created in
 * one database transition. They remain separate records because one explains
 * an execution attempt and the other owns reusable project context.
 */

/**
 * When a run **must** stop and ask (§22).
 *
 * All eight situations, restated as a policy constant so the trigger list has
 * one home rather than being re-derived by each future caller. Every one shares
 * a property: proceeding would mean Vibe choosing something the customer would
 * reasonably expect to choose, or spending something they did not authorize.
 */
export const MUST_INTERRUPT_SITUATIONS: readonly ExecutionInterruptType[] = [
  "business_decision_required",
  "founder_input_required",
  "materially_different_outcomes",
  "permission_semantics_unknown",
  "external_paid_service_required",
  "destructive_migration_required",
  "scope_expansion_required",
  "additional_credits_required",
  "consequential_action_approval_required",
] as const;

/**
 * Situations that must **not** produce an interrupt (§22).
 *
 * Expressed as a documented rule rather than an enum, because it is a rule
 * about everything else: if a choice can be inferred from the repository's own
 * existing patterns — naming, file layout, component conventions, test style —
 * the agent infers it. §22 asks for useful autonomy, and a product that stops
 * to ask which quote style to use has taught its customer to stop reading the
 * questions.
 */
export const INTERRUPT_ONLY_WHEN_THE_CUSTOMER_WOULD_EXPECT_TO_DECIDE = true;

/** Whether an answer actually satisfies the question that was asked. */
export function isValidInterruptAnswer(
  schema: ExecutionInterruptResponseSchema,
  answer: ExecutionInterruptAnswer,
): boolean {
  if (answer.kind === "founder_input_resolution") return false;
  if (schema.kind !== answer.kind) return false;

  switch (schema.kind) {
    case "single_choice":
      return (
        answer.kind === "single_choice" &&
        schema.options.some((option) => option.id === answer.optionId)
      );
    case "confirmation":
      return answer.kind === "confirmation";
    case "text":
      return (
        answer.kind === "text" &&
        answer.value.trim().length > 0 &&
        answer.value.length <= schema.maxLength
      );
  }
}

/**
 * Whether an interrupt is still holding execution.
 *
 * `open` is the only state that blocks. A cancelled or expired interrupt is
 * history — it explains why a run stopped, and it is not an instruction to keep
 * waiting.
 */
export function isInterruptBlocking(interrupt: Pick<ExecutionInterrupt, "status">): boolean {
  return interrupt.status === "open";
}

/**
 * The approved business decision an answered interrupt becomes (§28).
 *
 * The whole reason interrupts are structured: an answer is not filed away as a
 * note, it becomes a keyed decision that the next resolution reads and the next
 * spec hashes into its identity. A changed answer therefore produces a new
 * spec, which is §10 working exactly as intended.
 *
 * Returns null for an unanswered or invalidly answered interrupt rather than
 * inventing a decision — a half-answered question is not a decision.
 */
export function interruptToApprovedDecision(
  interrupt: ExecutionInterrupt,
): { key: string; stepOrder: number | null; decision: string } | null {
  if (interrupt.status !== "answered" || interrupt.answer === null) return null;
  if (interrupt.answer.kind === "founder_input_resolution") return null;
  if (!isValidInterruptAnswer(interrupt.responseSchema, interrupt.answer)) return null;

  const answer = interrupt.answer;
  const decision =
    answer.kind === "single_choice"
      ? (interrupt.responseSchema.kind === "single_choice"
          ? interrupt.responseSchema.options.find((option) => option.id === answer.optionId)?.label
          : undefined) ?? answer.optionId
      : answer.kind === "confirmation"
        ? answer.confirmed
          ? "confirmed"
          : "declined"
        : answer.value;

  return { key: `interrupt:${interrupt.id}`, stepOrder: null, decision };
}
