import type { AuditCreditGate } from "../business-audit/entitlement";
import type { OnboardingState } from "../onboarding/state";
import { NOVA_ACTION_META } from "./actions";
import type { NovaActionId } from "./actions";
import type { NovaChoiceOption, NovaEntry } from "./feed";

/**
 * The onboarding lane, once Nova's own two screens are behind us.
 *
 * `first-run.ts` covers the introduction; this covers the two positions where
 * Nova narrates work the product was already doing — reading the founder's
 * product, and showing them what it understood. The screens themselves are the
 * existing ones (`ProductScanExperience`, and the reveal card lifted out of the
 * onboarding page): Nova says the sentence above them and owns the control
 * below, and re-implements neither.
 *
 * `deriveOnboardingState` is still the authority on which position this is.
 * Nothing here re-derives it.
 */

export type NovaOnboardingPosition =
  /** Vibe is reading the product. Nothing is asked of the founder. */
  | "scanning"
  /** Vibe has read it, and the founder has not said whether it is right. */
  | "reveal"
  /** Some other onboarding state; Nova has nothing to add to it yet. */
  | "elsewhere";

export function deriveNovaOnboarding(state: OnboardingState): NovaOnboardingPosition {
  if (state === "product_scanning") return "scanning";
  if (state === "product_reveal") return "reveal";
  return "elsewhere";
}

/**
 * Which controls the reveal offers, and why there are two shapes (§O.3).
 *
 * The founder has been shown what Vibe read and is being asked one thing: *is
 * this right?* What may honestly ride along with the answer depends entirely on
 * what the next audit costs.
 *
 * **Free** — one control, and it says where it leads. Splitting a free
 * continuation into *"is this right?"* → *"shall I audit it?"* is two presses
 * for one decision, and it is the friction Nova exists to remove.
 *
 * **Priced** — confirming and auditing are two decisions and stay two presses.
 * Bundling here would make a paid operation the side effect of a question about
 * accuracy, which is precisely what rule 60 forbids; the audit is then offered
 * afterwards, with its price beside it.
 *
 * The branch needs no new state: `AuditCreditGate` already answers it
 * everywhere else in the product, and `not_applicable` is exactly "nothing is
 * owed" — the included first audit, or an audit Vibe owes as a refresh.
 */
export function novaRevealControls(gate: AuditCreditGate): NovaActionId[] {
  return gate.kind === "not_applicable"
    ? ["nova.confirm_product_and_audit"]
    : ["nova.confirm_product"];
}

/** Whether the audit rides along with the confirmation, for the copy above it. */
export function novaRevealBundlesAudit(gate: AuditCreditGate): boolean {
  return gate.kind === "not_applicable";
}

const SCANNING_MESSAGE = "I am reading your product now.";

const REVEAL_MESSAGE = "Here is what I understood about your product. Tell me if I have it wrong.";

function option(actionId: NovaActionId): NovaChoiceOption {
  const meta = NOVA_ACTION_META[actionId];
  return {
    actionId,
    control: meta.control,
    label: meta.label,
    price: meta.price,
    consequential: meta.consequential,
    requiresConfirmation: meta.requiresConfirmation,
    confirmationNote: meta.confirmationNote ?? null,
    subject: { kind: "project" },
  };
}

/**
 * What Nova says while the scan runs.
 *
 * A sentence and nothing else. The progress itself belongs to
 * `ProductScanExperience`, which already renders named stages from
 * `product_scan_events` — and there is no control, because there is nothing
 * for the founder to decide while Vibe reads.
 */
export function buildNovaScanFeed(): NovaEntry[] {
  return [
    {
      kind: "nova.message",
      id: "onboarding:scanning",
      text: SCANNING_MESSAGE,
      emphasis: "primary",
    },
  ];
}

/**
 * What Nova says at the reveal, and the one control under it.
 *
 * The card showing *what* was understood is the existing one; this is the
 * sentence above it and the answer below it. Correcting is not an option here
 * for the same reason a question is not a choice in `feed.ts`: the correction
 * form is a bounded, allowlisted set of fields that its own component owns,
 * and Nova restating them would be a second copy of the one place that knows
 * which fields are editable.
 */
export function buildNovaRevealFeed(gate: AuditCreditGate): NovaEntry[] {
  return [
    {
      kind: "nova.message",
      id: "onboarding:reveal",
      text: REVEAL_MESSAGE,
      emphasis: "primary",
    },
    {
      kind: "nova.choice",
      id: "onboarding:reveal:choice",
      prompt: "",
      options: novaRevealControls(gate).map(option),
    },
  ];
}
